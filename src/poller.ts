/**
 * poller.ts — Telegram getUpdates long-poll loop.
 *
 * Single source of truth for all incoming Telegram updates. Commands are
 * dispatched via the dispatcher module.
 *
 * PAUSE/RESUME:
 * When the built-in ask_user_questions tool fires, index.ts calls pause()
 * to let GSD's TelegramAdapter take over polling. resume() restarts our
 * loop once the tool completes. pause() is atomic: it waits for any
 * in-flight getUpdates to complete before resolving.
 */

import type { TelegramUpdate, TelegramCallbackQuery, TelegramApiResponse } from "./types.js";
import { isAllowedUser, getSenderId } from "./auth.js";
import { parseCommand, executeCommand } from "./dispatcher.js";
import { sendReply } from "./responder.js";

const POLL_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 5_000;
const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 35_000;

export interface PollLoopOptions {
  botToken: string;
  chatId: string;
  allowedUserIds: number[];
  onError?: (err: Error) => void;
}

export class PollLoop {
  private active = false;
  private lastUpdateId = 0;
  private paused = false;
  private pauseResolver: (() => void) | null = null;
  private readonly opts: PollLoopOptions;

  constructor(opts: PollLoopOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.run();
  }

  stop(): void {
    this.active = false;
  }

  /**
   * Pause the poll loop. Returns a promise that resolves after the current
   * in-flight getUpdates cycle completes — safe to hand off polling to
   * another consumer (e.g. GSD TelegramAdapter for ask_user_questions).
   */
  pause(): Promise<void> {
    if (this.paused) return Promise.resolve();
    this.paused = true;
    console.log("[gsd-telegram-remote] PollLoop paused (ask_user_questions)");
    return new Promise<void>((resolve) => {
      this.pauseResolver = resolve;
    });
  }

  /** Resume the poll loop after a pause. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseResolver?.();
    this.pauseResolver = null;
    console.log("[gsd-telegram-remote] PollLoop resumed");
  }

  /** Send a one-way notification to the configured chat. Non-blocking, non-fatal. */
  async notify(text: string): Promise<void> {
    await sendReply(this.opts.botToken, this.opts.chatId, text);
  }

  /** Send a message with an optional inline keyboard. Returns the message_id or null. */
  async sendMessage(payload: {
    text: string;
    parse_mode?: string;
    reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  }): Promise<number | null> {
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.opts.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.opts.chatId, ...payload }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await res.json()) as TelegramApiResponse<{ message_id: number }>;
      if (!body.ok || !body.result) {
        console.error(`[gsd-telegram-remote] sendMessage failed: ${body.description}`);
        return null;
      }
      return body.result.message_id;
    } catch (err) {
      console.error(`[gsd-telegram-remote] sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Answer a callback query (removes the spinner from the button). */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await fetch(`${TELEGRAM_API}/bot${this.opts.botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: text ?? "✅ Received" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { /* non-fatal */ }
  }

  /** Remove inline keyboard buttons from a previously sent message. */
  async clearInlineKeyboard(messageId: number): Promise<void> {
    try {
      await fetch(`${TELEGRAM_API}/bot${this.opts.botToken}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.opts.chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { /* non-fatal */ }
  }

  private async run(): Promise<void> {
    while (this.active) {
      try {
        const updates = await this.getUpdates();

        // If paused during getUpdates, resolve the pause promise (caller knows
        // the in-flight request finished) and wait until resumed.
        if (this.paused) {
          this.pauseResolver?.();
          this.pauseResolver = null;
          await new Promise<void>((resolve) => {
            const check = (): void => {
              if (!this.paused || !this.active) { resolve(); return; }
              setTimeout(check, 50);
            };
            check();
          });
          if (!this.active) break;
        }

        for (const update of updates) {
          if (!this.active) break;
          await this.handleUpdate(update);
        }
      } catch (err) {
        // Timeout/abort during long-polling is expected (network hiccup,
        // system sleep, etc.) — retry silently without alarming the user.
        if (
          err instanceof DOMException && err.name === "AbortError" ||
          err instanceof DOMException && err.name === "TimeoutError"
        ) {
          continue;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        this.opts.onError?.(error);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const res = await fetch(
      `${TELEGRAM_API}/bot${this.opts.botToken}/getUpdates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: this.lastUpdateId + 1,
          timeout: POLL_TIMEOUT_SECONDS,
          allowed_updates: ["message", "callback_query"],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    const body = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>;
    if (!body.ok || !Array.isArray(body.result)) return [];

    for (const u of body.result) {
      if (u.update_id > this.lastUpdateId) {
        this.lastUpdateId = u.update_id;
      }
    }

    return body.result;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    // Normal command dispatch — text messages only.
    const msg = update.message;
    if (!msg?.text) return;

    if (String(msg.chat.id) !== this.opts.chatId) return;

    const senderId = getSenderId(msg);
    if (senderId === null) return;
    if (!isAllowedUser(senderId, this.opts.allowedUserIds)) return;

    // Skip plain replies — they're free-text answers when no handler caught them
    // (e.g. a reply sent before the handler was registered).
    if (msg.reply_to_message) return;

    const cmd = parseCommand(msg.text);
    const result = await executeCommand(cmd);
    await sendReply(this.opts.botToken, this.opts.chatId, result.reply);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
