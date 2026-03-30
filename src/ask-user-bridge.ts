/**
 * ask-user-bridge.ts — Full round-trip for ask_user_questions via Telegram.
 *
 * Sends the question(s) to Telegram as a formatted message with inline keyboard
 * buttons (for single-question prompts) or numbered options (for multi-question).
 *
 * Answer routing goes through the main PollLoop via registerAnswerHandler().
 * There is NO separate getUpdates loop here — that was the original bug.
 * One loop, one offset, no races.
 *
 * Design:
 * - Single-select with options → inline keyboard + "None of the above"
 * - Multi-select → numbered text list, comma-separated reply
 * - Multi-question → numbered sections, semicolon/newline reply
 * - 5-minute timeout → cancelled result
 * - Commands (/stop etc.) always dispatched even while question is pending
 */

import type { TelegramUpdate } from "./types.js";
import type { PollLoop } from "./poller.js";
import { isAllowedUser } from "./auth.js";

const DEFAULT_ANSWER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Types ────────────────────────────────────────────────────────────────────

export interface AskUserQuestion {
  id: string;
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  allowMultiple?: boolean;
}

export interface AskUserResult {
  response?: {
    answers: Record<string, { selected: string | string[]; notes?: string }>;
  };
  cancelled?: boolean;
}

export interface BridgeConfig {
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

export function formatQuestionMessage(
  questions: AskUserQuestion[],
  promptId: string,
): { text: string; parse_mode: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const isSingle = questions.length === 1;
  const q = questions[0];

  if (isSingle && q.options && q.options.length > 0 && !q.allowMultiple) {
    // Single-select → inline keyboard
    const lines = [
      `<b>🤔 GSD needs your input</b>`,
      ``,
      `<b>${escapeHtml(q.header ?? q.id)}</b>`,
      escapeHtml(q.question),
    ];

    const keyboard = q.options.map((opt, idx) => [{
      text: `${idx + 1}. ${opt.label}`,
      callback_data: `auq:${promptId}:${idx}`,
    }]);
    keyboard.push([{ text: "✏️ Other (reply with text)", callback_data: `auq:${promptId}:nota` }]);

    return { text: lines.join("\n"), parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } };
  }

  if (isSingle && q.options && q.options.length > 0 && q.allowMultiple) {
    // Multi-select → numbered list, comma-separated reply
    const lines = [
      `<b>🤔 GSD needs your input</b>`,
      ``,
      `<b>${escapeHtml(q.header ?? q.id)}</b>`,
      escapeHtml(q.question),
      ``,
      ...q.options.map((opt, idx) => {
        const desc = opt.description ? ` — ${escapeHtml(opt.description)}` : "";
        return `${idx + 1}. ${escapeHtml(opt.label)}${desc}`;
      }),
      ``,
      `<i>Reply with comma-separated numbers (e.g. "1,3") or type your own answer.</i>`,
    ];
    return { text: lines.join("\n"), parse_mode: "HTML" };
  }

  // Multi-question or no options → text format
  const lines = [`<b>🤔 GSD needs your input</b>`, ``];
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
    lines.push(`<i>Reply with one answer per line or semicolons: "1;2"</i>`);
  } else {
    lines.push(`<i>Reply with a number to select, or type your own answer.</i>`);
  }

  return { text: lines.join("\n"), parse_mode: "HTML" };
}

// ── Parse answers ─────────────────────────────────────────────────────────────

export function parseCallbackAnswer(
  callbackData: string,
  questions: AskUserQuestion[],
  promptId: string,
): AskUserResult | null {
  const prefix = `auq:${promptId}:`;
  if (!callbackData.startsWith(prefix)) return null;

  const payload = callbackData.slice(prefix.length);
  if (payload === "nota") return null; // signal: wait for text

  const idx = parseInt(payload, 10);
  const q = questions[0];
  if (!q?.options || isNaN(idx) || idx < 0 || idx >= q.options.length) return null;

  return { response: { answers: { [q.id]: { selected: q.options[idx].label } } } };
}

export function parseTextAnswer(text: string, questions: AskUserQuestion[]): AskUserResult {
  const answers: Record<string, { selected: string | string[]; notes?: string }> = {};

  if (questions.length === 1) {
    const q = questions[0];
    const trimmed = text.trim();

    if (q.allowMultiple && q.options) {
      const parts = trimmed.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const selected: string[] = [];
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num >= 1 && num <= q.options.length) {
          selected.push(q.options[num - 1].label);
        }
      }
      answers[q.id] = selected.length > 0
        ? { selected }
        : { selected: "None of the above", notes: trimmed };
    } else if (q.options && q.options.length > 0) {
      const num = parseInt(trimmed, 10);
      answers[q.id] = (!isNaN(num) && num >= 1 && num <= q.options.length)
        ? { selected: q.options[num - 1].label }
        : { selected: "None of the above", notes: trimmed };
    } else {
      answers[q.id] = { selected: trimmed };
    }
  } else {
    const parts = text.includes(";") ? text.split(";") : text.split("\n");
    questions.forEach((q, idx) => {
      const part = (parts[idx] ?? "").trim();
      if (q.options && q.options.length > 0) {
        const num = parseInt(part, 10);
        answers[q.id] = (!isNaN(num) && num >= 1 && num <= q.options.length)
          ? { selected: q.options[num - 1].label }
          : { selected: "None of the above", notes: part || "(no answer)" };
      } else {
        answers[q.id] = { selected: part || "(no answer)" };
      }
    });
  }

  return { response: { answers } };
}

// ── Main bridge function ─────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Send ask_user_questions to Telegram and wait for the answer.
 *
 * Uses loop.registerAnswerHandler() so all updates go through the single
 * main PollLoop — no second getUpdates call, no offset races.
 */
export async function askUserViaTelegram(
  loop: PollLoop,
  config: BridgeConfig,
  questions: AskUserQuestion[],
  signal?: AbortSignal,
): Promise<AskUserResult> {
  if (questions.length === 0) return { cancelled: true };

  const promptId = `p${Date.now().toString(36)}${(++_idCounter).toString(36)}`;
  const timeout = config.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS;

  // Send the question
  const payload = formatQuestionMessage(questions, promptId);
  const messageId = await loop.sendMessage(payload);
  if (messageId === null) return { cancelled: true };

  // Wait for answer via the main loop's handler
  return new Promise<AskUserResult>((resolve) => {
    let waitingForText = false;
    const deadline = setTimeout(async () => {
      loop.clearAnswerHandler();
      await loop.sendMessage({ text: `⏰ No response after ${Math.round(timeout / 60_000)} min. Defaulting to first option.`, parse_mode: "HTML" });
      resolve({ cancelled: true });
    }, timeout);

    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(deadline);
        loop.clearAnswerHandler();
        resolve({ cancelled: true });
      }, { once: true });
    }

    loop.registerAnswerHandler((update: TelegramUpdate): boolean => {
      // ── callback_query (button press) ──────────────────────────────────
      const cb = update.callback_query;
      if (cb) {
        if (!isAllowedUser(cb.from.id, config.allowedUserIds)) return false;
        if (!cb.data?.startsWith(`auq:${promptId}:`)) return false;

        void loop.answerCallbackQuery(cb.id);

        const result = parseCallbackAnswer(cb.data, questions, promptId);
        if (result === null) {
          // "Other" button — wait for text reply
          waitingForText = true;
          void loop.sendMessage({ text: `<i>Type your answer:</i>`, parse_mode: "HTML" });
          return true; // consumed
        }

        clearTimeout(deadline);
        loop.clearAnswerHandler();
        void loop.clearInlineKeyboard(messageId);
        void loop.sendMessage({ text: `✅ Got it.`, parse_mode: "HTML" });
        resolve(result);
        return true;
      }

      // ── text message ───────────────────────────────────────────────────
      const msg = update.message;
      if (!msg?.text) return false;
      if (String(msg.chat.id) !== config.chatId) return false;
      if (!isAllowedUser(msg.from?.id ?? 0, config.allowedUserIds)) return false;

      // Accept: reply-to-question, waiting for text after "Other", or any direct text
      const isReplyToQuestion = msg.reply_to_message?.message_id === messageId;
      const isDirectText = !msg.reply_to_message;

      if (!isReplyToQuestion && !waitingForText && !isDirectText) return false;

      // Don't consume slash commands — let them dispatch normally
      if (msg.text.startsWith("/") && !waitingForText) return false;

      clearTimeout(deadline);
      loop.clearAnswerHandler();
      void loop.clearInlineKeyboard(messageId);
      void loop.sendMessage({ text: `✅ Got it.`, parse_mode: "HTML" });
      resolve(parseTextAnswer(msg.text, questions));
      return true;
    });
  });
}
