/**
 * ask-user-bridge.ts — Full round-trip for ask_user_questions via Telegram.
 *
 * Sends the question(s) to Telegram as a formatted message with inline keyboard
 * buttons (for single-question prompts) or numbered options (for multi-question).
 * Polls for the user's answer via callback_query (button press) or text reply.
 * Returns the structured answer that pi expects from ask_user_questions.
 *
 * Design decisions:
 * - Single question with options → inline keyboard (one button per option + "None of the above")
 * - Multi-question or free-form → numbered text, user replies with numbers or free text
 * - Timeout after 5 minutes (configurable) — returns cancelled result
 * - Uses a separate short-poll loop (not the main command poller) to avoid conflicts
 */

import type { TelegramApiResponse } from "./types.js";
import { isAllowedUser } from "./auth.js";

const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ANSWER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const ANSWER_POLL_INTERVAL_MS = 2_000;

// ── Types ────────────────────────────────────────────────────────────────────

/** Shape of a question from ask_user_questions args */
export interface AskUserQuestion {
  id: string;
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  allowMultiple?: boolean;
}

/** The structured answer pi expects */
export interface AskUserResult {
  response?: {
    answers: Record<string, { selected: string | string[]; notes?: string }>;
  };
  cancelled?: boolean;
}

/** Telegram inline keyboard button */
interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

/** Telegram callback query from button press */
interface TelegramCallbackQuery {
  id: string;
  from: { id: number; is_bot: boolean; first_name: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

/** Telegram update with callback_query support */
interface FullTelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean; first_name: string };
    chat: { id: number; type: string };
    reply_to_message?: { message_id: number };
    text?: string;
    date: number;
  };
  callback_query?: TelegramCallbackQuery;
}

interface BridgeConfig {
  botToken: string;
  chatId: string;
  allowedUserIds: number[];
  timeoutMs?: number;
}

// ── HTML escaping ────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Format question for Telegram ─────────────────────────────────────────────

function formatQuestionMessage(
  questions: AskUserQuestion[],
  promptId: string,
): { text: string; reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } } {
  const isSingle = questions.length === 1;
  const q = questions[0];

  if (isSingle && q.options && q.options.length > 0 && !q.allowMultiple) {
    // Single-select with options → inline keyboard
    const lines: string[] = [
      `<b>🤔 GSD needs your input</b>`,
      ``,
      `<b>${escapeHtml(q.header ?? q.id)}</b>`,
      escapeHtml(q.question),
    ];

    const keyboard: InlineKeyboardButton[][] = q.options.map((opt, idx) => [{
      text: `${idx + 1}. ${opt.label}`,
      callback_data: `auq:${promptId}:${idx}`,
    }]);

    // "None of the above" as free-text option
    keyboard.push([{
      text: "✏️ None of the above (reply with text)",
      callback_data: `auq:${promptId}:nota`,
    }]);

    return {
      text: lines.join("\n"),
      reply_markup: { inline_keyboard: keyboard },
    };
  }

  if (isSingle && q.options && q.options.length > 0 && q.allowMultiple) {
    // Multi-select → show numbered list, user replies with comma-separated numbers
    const lines: string[] = [
      `<b>🤔 GSD needs your input</b>`,
      ``,
      `<b>${escapeHtml(q.header ?? q.id)}</b>`,
      escapeHtml(q.question),
      ``,
    ];
    q.options.forEach((opt, idx) => {
      const desc = opt.description ? ` — ${escapeHtml(opt.description)}` : "";
      lines.push(`${idx + 1}. ${escapeHtml(opt.label)}${desc}`);
    });
    lines.push(``, `<i>Reply with numbers separated by commas (e.g. "1,3") or type your own answer.</i>`);
    return { text: lines.join("\n") };
  }

  // Multi-question or no-options → text format
  const lines: string[] = [
    `<b>🤔 GSD needs your input</b>`,
    ``,
  ];

  questions.forEach((question, qIdx) => {
    const prefix = questions.length > 1 ? `(${qIdx + 1}/${questions.length}) ` : "";
    lines.push(`<b>${prefix}${escapeHtml(question.header ?? question.id)}</b>`);
    lines.push(escapeHtml(question.question));

    if (question.options && question.options.length > 0) {
      lines.push(``);
      question.options.forEach((opt, idx) => {
        const desc = opt.description ? ` — ${escapeHtml(opt.description)}` : "";
        lines.push(`${idx + 1}. ${escapeHtml(opt.label)}${desc}`);
      });
    }
    lines.push(``);
  });

  if (questions.length > 1) {
    lines.push(`<i>Reply with one answer per line, or use semicolons: "1;2;custom text"</i>`);
  } else {
    lines.push(`<i>Reply with a number to select an option, or type your own answer.</i>`);
  }

  return { text: lines.join("\n") };
}

// ── Parse user's answer ──────────────────────────────────────────────────────

function parseCallbackAnswer(
  callbackData: string,
  questions: AskUserQuestion[],
  promptId: string,
): AskUserResult | null {
  // Format: "auq:<promptId>:<optionIndex>" or "auq:<promptId>:nota"
  const prefix = `auq:${promptId}:`;
  if (!callbackData.startsWith(prefix)) return null;

  const payload = callbackData.slice(prefix.length);

  if (payload === "nota") {
    // User clicked "None of the above" — they need to send a text reply
    return null; // signal: wait for text
  }

  const idx = parseInt(payload, 10);
  const q = questions[0];
  if (!q?.options || isNaN(idx) || idx < 0 || idx >= q.options.length) return null;

  return {
    response: {
      answers: {
        [q.id]: { selected: q.options[idx].label },
      },
    },
  };
}

function parseTextAnswer(
  text: string,
  questions: AskUserQuestion[],
): AskUserResult {
  const answers: Record<string, { selected: string | string[]; notes?: string }> = {};

  if (questions.length === 1) {
    const q = questions[0];
    const trimmed = text.trim();

    if (q.allowMultiple && q.options) {
      // Multi-select: parse comma-separated numbers
      const parts = trimmed.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const selected: string[] = [];
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num >= 1 && num <= q.options.length) {
          selected.push(q.options[num - 1].label);
        }
      }
      if (selected.length > 0) {
        answers[q.id] = { selected };
      } else {
        // Treat as free-text
        answers[q.id] = { selected: "None of the above", notes: trimmed };
      }
    } else if (q.options && q.options.length > 0) {
      // Single-select with options
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= q.options.length) {
        answers[q.id] = { selected: q.options[num - 1].label };
      } else {
        // Free-text / "None of the above"
        answers[q.id] = { selected: "None of the above", notes: trimmed };
      }
    } else {
      // No options — pure free text
      answers[q.id] = { selected: trimmed };
    }
  } else {
    // Multi-question: split by semicolons or newlines
    const parts = text.includes(";") ? text.split(";") : text.split("\n");
    questions.forEach((q, idx) => {
      const part = (parts[idx] ?? "").trim();
      if (!part) {
        answers[q.id] = { selected: "", notes: "(no answer)" };
        return;
      }
      if (q.options && q.options.length > 0) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num >= 1 && num <= q.options.length) {
          answers[q.id] = { selected: q.options[num - 1].label };
        } else {
          answers[q.id] = { selected: "None of the above", notes: part };
        }
      } else {
        answers[q.id] = { selected: part };
      }
    });
  }

  return { response: { answers } };
}

// ── Telegram API helpers ─────────────────────────────────────────────────────

async function sendQuestion(
  botToken: string,
  chatId: string,
  payload: { text: string; reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } },
): Promise<number | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: payload.text,
        parse_mode: "HTML",
        ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = (await res.json()) as TelegramApiResponse<{ message_id: number }>;
    if (!body.ok || !body.result) {
      console.error(`[ask-user-bridge] sendMessage failed: ${body.description}`);
      return null;
    }
    return body.result.message_id;
  } catch (err) {
    console.error(`[ask-user-bridge] sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ?? "✅ Received",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // non-fatal
  }
}

async function editMessageReplyMarkup(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}/bot${botToken}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // non-fatal
  }
}

async function sendConfirmation(botToken: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // non-fatal
  }
}

// ── Poll for answer ──────────────────────────────────────────────────────────

/**
 * Poll Telegram for the user's answer to a question.
 * Uses its own short-poll offset tracking, completely independent of the main PollLoop.
 *
 * Listens for:
 * - callback_query with matching promptId (inline keyboard button press)
 * - text message that is a reply to the question message
 * - text message (non-reply) — treated as direct answer if it's the only pending question
 */
async function pollForAnswer(
  config: BridgeConfig,
  questions: AskUserQuestion[],
  promptId: string,
  questionMessageId: number,
  signal: AbortSignal | undefined,
): Promise<AskUserResult> {
  const deadline = Date.now() + (config.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS);
  let pollOffset = 0;
  let waitingForText = false; // true after "None of the above" button click

  while (Date.now() < deadline) {
    if (signal?.aborted) return { cancelled: true };

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${config.botToken}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: pollOffset === 0 ? undefined : pollOffset,
          timeout: 2,
          allowed_updates: ["message", "callback_query"],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const body = (await res.json()) as TelegramApiResponse<FullTelegramUpdate[]>;
      if (!body.ok || !Array.isArray(body.result)) {
        await sleep(ANSWER_POLL_INTERVAL_MS);
        continue;
      }

      for (const update of body.result) {
        if (update.update_id >= pollOffset) {
          pollOffset = update.update_id + 1;
        }

        // Check callback_query (button press)
        if (update.callback_query) {
          const cb = update.callback_query;
          const senderId = cb.from.id;

          if (!isAllowedUser(senderId, config.allowedUserIds)) continue;

          if (cb.data?.startsWith(`auq:${promptId}:`)) {
            await answerCallbackQuery(config.botToken, cb.id);

            const result = parseCallbackAnswer(cb.data, questions, promptId);
            if (result === null) {
              // "None of the above" — wait for text reply
              waitingForText = true;
              await sendConfirmation(config.botToken, config.chatId,
                `<i>Type your answer below:</i>`);
              continue;
            }

            // Remove inline keyboard
            await editMessageReplyMarkup(config.botToken, config.chatId, questionMessageId);
            await sendConfirmation(config.botToken, config.chatId, `✅ Got it.`);
            return result;
          }
        }

        // Check text message
        if (update.message?.text) {
          const msg = update.message;
          const senderId = msg.from?.id;

          if (String(msg.chat.id) !== config.chatId) continue;
          if (senderId == null || !isAllowedUser(senderId, config.allowedUserIds)) continue;

          // Accept: reply to our question message, or any text when waiting for text, or non-reply text
          const isReplyToQuestion = msg.reply_to_message?.message_id === questionMessageId;
          const isDirectText = !msg.reply_to_message;

          if (isReplyToQuestion || waitingForText || isDirectText) {
            // Remove inline keyboard if present
            await editMessageReplyMarkup(config.botToken, config.chatId, questionMessageId);

            const result = parseTextAnswer(msg.text!, questions);
            await sendConfirmation(config.botToken, config.chatId, `✅ Got it.`);
            return result;
          }
        }
      }
    } catch (err) {
      console.error(`[ask-user-bridge] poll error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await sleep(ANSWER_POLL_INTERVAL_MS);
  }

  // Timeout
  await sendConfirmation(config.botToken, config.chatId,
    `⏰ Question timed out after ${Math.round((config.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS) / 60_000)} minutes. Auto-selecting default.`);
  return { cancelled: true };
}

// ── Main bridge function ─────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Send ask_user_questions to Telegram and wait for the answer.
 * Returns the structured result that pi expects.
 */
export async function askUserViaTelegram(
  config: BridgeConfig,
  questions: AskUserQuestion[],
  signal?: AbortSignal,
): Promise<AskUserResult> {
  if (questions.length === 0) return { cancelled: true };

  const promptId = `p${Date.now().toString(36)}${(++_idCounter).toString(36)}`;

  // Format and send
  const payload = formatQuestionMessage(questions, promptId);
  const messageId = await sendQuestion(config.botToken, config.chatId, payload);
  if (messageId === null) {
    return { cancelled: true };
  }

  // Poll for answer
  return pollForAnswer(config, questions, promptId, messageId, signal);
}

// ── Exports for testing ──────────────────────────────────────────────────────

export { formatQuestionMessage, parseCallbackAnswer, parseTextAnswer };

// ── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
