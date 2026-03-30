/**
 * poll-lock.ts — Cross-session lock so only one GSD session polls for commands.
 *
 * Multiple GSD sessions (one per project terminal) each load the extension and
 * would each start a poll loop. Without coordination, all sessions receive the
 * same Telegram message and reply multiple times.
 *
 * Fix: a lockfile at ~/.gsd/telegram-remote-poll.lock containing the owning PID.
 * The first session to acquire the lock runs the poll loop; others run in
 * notifications-only mode (can still call loop.notify() for proactive messages).
 *
 * The lock is advisory — if the owning process dies without cleanup, the stale
 * lock is detected by checking whether the PID is still alive.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOCK_FILE = join(homedir(), ".gsd", "telegram-remote-poll.lock");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to acquire the poll lock. Returns true if this process now owns it.
 * If a stale lock exists (dead PID), it's overwritten.
 */
export function acquirePollLock(): boolean {
  const myPid = process.pid;

  if (existsSync(LOCK_FILE)) {
    try {
      const content = readFileSync(LOCK_FILE, "utf-8").trim();
      const ownerPid = parseInt(content, 10);
      if (Number.isFinite(ownerPid) && ownerPid !== myPid && isProcessAlive(ownerPid)) {
        // Another live session owns the lock
        return false;
      }
      // Stale lock (dead PID) or our own PID — overwrite
    } catch {
      // Corrupt lock file — overwrite
    }
  }

  try {
    writeFileSync(LOCK_FILE, String(myPid), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the poll lock if this process owns it.
 */
export function releasePollLock(): void {
  try {
    if (!existsSync(LOCK_FILE)) return;
    const content = readFileSync(LOCK_FILE, "utf-8").trim();
    const ownerPid = parseInt(content, 10);
    if (ownerPid === process.pid) {
      unlinkSync(LOCK_FILE);
    }
  } catch {
    // Best-effort cleanup
  }
}
