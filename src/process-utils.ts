/**
 * process-utils.ts — Cross-platform process liveness check.
 *
 * On Windows, process.kill(pid, 0) gives false positives for dead PIDs.
 * Use tasklist instead, which reliably reports actual running processes.
 * On Unix, process.kill(pid, 0) works correctly (signal 0 = existence check).
 */

import { execSync } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

export function isProcessAlive(pid: number): boolean {
  if (IS_WINDOWS) {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf-8",
        timeout: 3000,
        windowsHide: true,
      });
      // tasklist prints the process row if found, or "INFO: No tasks..." if not
      return out.includes(String(pid));
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
