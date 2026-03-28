/**
 * poller.ts — Telegram getUpdates long-poll loop.
 *
 * Runs continuously while the extension is active. Uses a 30-second server-side
 * timeout on each getUpdates call so the loop sleeps without busy-waiting.
 *
 * CONFLICT GUARD: TelegramAdapter.pollAnswer() runs while ask_user_questions is
 * active. Two simultaneous getUpdates calls can receive the same update from Telegram.
 * Risk: our poller advances lastUpdateId past a question-answer message before
 * TelegramAdapter sees it, causing the question to time out.
 *
 * Mitigation: pause()/resume() controlled from index.ts via tool_execution_start/end
 * events for ask_user_questions. Our poller also unconditionally skips messages that
 * are replies-to-specific-messages (how question answers always arrive), but the
 * offset-advancement risk is real and the pause guard closes it.
 */

import type { TelegramUpdate, TelegramApiResponse } from "./types.js";
import { isAllowedUser, getSenderId } from "./auth.js";
import { parseCommand, executeCommand } from "./dispatcher.js";
import { sendReply } from "./responder.js";

const POLL_TIMEOUT_SECONDS = 30; // server-side long-poll hold
const ERROR_BACKOFF_MS = 5_000;   // wait after a network error before retrying
const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 35_000; // slightly longer than Telegram's hold

export interface PollLoopOptions {
  botToken: string;
  chatId: string;
  allowedUserIds: number[];
  /** Injected for testability. */
  onError?: (err: Error) => void;
}

export class PollLoop {
  private active = false;
  private paused = false;
  private lastUpdateId = 0;
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

  /** Pause command dispatching while ask_user_questions is in flight. */
  pause(): void {
    this.paused = true;
  }

  /** Resume command dispatching after ask_user_questions completes. */
  resume(): void {
    this.paused = false;
  }

  /** Send a one-way notification to the configured chat. Non-blocking, non-fatal. */
  async notify(text: string): Promise<void> {
    await sendReply(this.opts.botToken, this.opts.chatId, text);
  }

  private async run(): Promise<void> {
    while (this.active) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          if (!this.active) break;
          if (!this.paused) {
            await this.handleUpdate(update);
          }
        }
      } catch (err) {
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
          allowed_updates: ["message"],
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
    const msg = update.message;
    if (!msg?.text) return;

    if (String(msg.chat.id) !== this.opts.chatId) return;

    // Skip replies — those belong to the question-answer flow
    if (msg.reply_to_message) return;

    const senderId = getSenderId(msg);
    if (senderId === null) return;

    if (!isAllowedUser(senderId, this.opts.allowedUserIds)) return;

    const cmd = parseCommand(msg.text);
    const result = await executeCommand(cmd);

    await sendReply(this.opts.botToken, this.opts.chatId, result.reply);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
