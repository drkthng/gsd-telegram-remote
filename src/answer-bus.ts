/**
 * answer-bus.ts — Cross-session answer relay for ask_user_questions.
 *
 * PROBLEM:
 * Only one session owns the Telegram poll loop (poll lock). Other sessions
 * (secondary projects) have a loop that never receives updates. When a
 * secondary session sends a question with inline keyboard buttons, the
 * callback_query arrives at the master loop — which has no handler for it
 * and discards it silently.
 *
 * SOLUTION:
 * A shared filesystem directory under ~/.gsd/telegram-remote-answers/.
 *
 * Session flow (non-master asking a question):
 *   1. Bridge writes a .pending file: <pid>-<promptId>.pending (JSON)
 *   2. Bridge polls for <pid>-<promptId>.answer
 *   3. Master loop sees auq:<promptId>:* update, scans .pending files,
 *      finds the match, writes .answer (JSON), acknowledges callback
 *   4. Bridge reads .answer, deletes both files, resolves with the answer
 *
 * Master session (owns poll lock):
 *   - Registers its own answer handler directly on the loop as before.
 *   - Also calls routeToAnswerBus() on every update to handle other sessions.
 *
 * Files are atomic (write .tmp → rename). Cleanup on resolve or timeout.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TelegramUpdate } from "./types.js";

const BUS_DIR = join(homedir(), ".gsd", "telegram-remote-answers");
const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const TELEGRAM_API = "https://api.telegram.org";

function ensureBusDir(): void {
  if (!existsSync(BUS_DIR)) {
    mkdirSync(BUS_DIR, { recursive: true });
  }
}

function pendingPath(pid: number, promptId: string): string {
  return join(BUS_DIR, `${pid}-${promptId}.pending`);
}

function answerPath(pid: number, promptId: string): string {
  return join(BUS_DIR, `${pid}-${promptId}.answer`);
}

function atomicWrite(filePath: string, data: object): void {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data), "utf-8");
  renameSync(tmp, filePath);
}

// ── Pending question registry (writer side — non-master sessions) ────────────

export interface PendingQuestion {
  pid: number;
  promptId: string;
  chatId: string;
  /** Message ID of the sent question, for clearing keyboard */
  messageId: number;
}

/**
 * Register a pending question so the master loop can route answers to it.
 */
export function registerPending(q: PendingQuestion): void {
  ensureBusDir();
  atomicWrite(pendingPath(q.pid, q.promptId), q);
}

/**
 * Remove the pending registration (cleanup on resolve or timeout).
 */
export function clearPending(pid: number, promptId: string): void {
  try { unlinkSync(pendingPath(pid, promptId)); } catch { /* already gone */ }
  try { unlinkSync(answerPath(pid, promptId)); } catch { /* already gone */ }
}

// ── Answer polling (reader side — non-master sessions) ───────────────────────

export interface BusAnswer {
  promptId: string;
  callbackData?: string;  // raw callback_data value
  text?: string;          // raw text message
}

/**
 * Poll for an answer file. Returns the answer when it arrives, or null on timeout.
 * Cleans up both .pending and .answer files on return.
 */
export async function waitForBusAnswer(
  pid: number,
  promptId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BusAnswer | null> {
  const deadline = Date.now() + timeoutMs;
  const aPath = answerPath(pid, promptId);

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      clearPending(pid, promptId);
      return null;
    }

    if (existsSync(aPath)) {
      try {
        const raw = readFileSync(aPath, "utf-8");
        const answer = JSON.parse(raw) as BusAnswer;
        clearPending(pid, promptId);
        return answer;
      } catch {
        // Partial write — wait for next cycle
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  clearPending(pid, promptId);
  return null;
}

// ── Master loop routing (writer side — master session) ───────────────────────

/**
 * Called by the master loop for every incoming update.
 * If the update is an auq:* callback_query or a text reply that matches a
 * pending question from another session, writes the answer file and returns true.
 * Returns false if no pending question matched (caller should handle normally).
 */
export async function routeToAnswerBus(
  update: TelegramUpdate,
  botToken: string,
): Promise<boolean> {
  if (!existsSync(BUS_DIR)) return false;

  const cb = update.callback_query;
  const msg = update.message;

  // Only handle auq:* callback_queries and text messages
  const isAuqCallback = cb?.data?.startsWith("auq:");
  const isTextMsg = !!msg?.text;
  if (!isAuqCallback && !isTextMsg) return false;

  let promptId: string | null = null;

  if (isAuqCallback && cb?.data) {
    // Extract promptId from "auq:<promptId>:<payload>"
    const parts = cb.data.split(":");
    promptId = parts[1] ?? null;
  }

  // Scan for matching .pending file
  let files: string[];
  try {
    files = readdirSync(BUS_DIR).filter(f => f.endsWith(".pending"));
  } catch {
    return false;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(BUS_DIR, file), "utf-8");
      const pending = JSON.parse(raw) as PendingQuestion;

      // Match by promptId (callback) or chatId (text — accept any text when pending)
      const matchesCallback = promptId !== null && pending.promptId === promptId;
      const matchesText = isTextMsg && msg && String(msg.chat.id) === pending.chatId;

      if (!matchesCallback && !matchesText) continue;

      // Write answer
      const answer: BusAnswer = cb?.data
        ? { promptId: pending.promptId, callbackData: cb.data }
        : { promptId: pending.promptId, text: msg!.text ?? "" };

      atomicWrite(answerPath(pending.pid, pending.promptId), answer);

      // Acknowledge callback to remove button spinner
      if (cb) {
        await answerCallbackQuery(botToken, cb.id);
      }

      return true;
    } catch {
      // Malformed pending file — skip
    }
  }

  return false;
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: "✅ Received" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch { /* non-fatal */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
