/**
 * responder.ts — Send replies back to Telegram.
 *
 * Thin wrapper around sendMessage. All replies go to the same chat ID
 * that GSD is configured to use (i.e. your private chat or group).
 */

import type { TelegramApiResponse } from "./types.js";

const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 15_000;

export async function sendReply(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = (await res.json()) as TelegramApiResponse<unknown>;
    if (!body.ok) {
      // Non-fatal: log to stderr but don't throw — a failed reply shouldn't
      // crash the poll loop.
      console.error(`[gsd-telegram-remote] sendMessage failed: ${body.description}`);
    }
  } catch (err) {
    // Network errors, timeouts — non-fatal
    console.error(`[gsd-telegram-remote] sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
