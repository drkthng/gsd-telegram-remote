/**
 * dispatcher.ts — Parse incoming Telegram text into RemoteCommands and execute them.
 *
 * Commands are executed via pi.sendUserMessage(), which routes through the exact same
 * path as the user typing them in the terminal. This means:
 *  - All GSD edge-case handling (already running, no milestones, etc.) is inherited
 *  - The response appears in the GSD terminal so the user sees what happened
 *  - No direct dependency on GSD internal modules (startAuto, stopAuto, etc.)
 *  - pi is process-scoped and safe to store from activate()
 *
 * Status queries read GSD state functions directly (isAutoActive, isAutoPaused)
 * since those are pure reads with no session dependency.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import type { RemoteCommand, DispatchResult } from "./types.js";

export interface GsdStatusApi {
  isAutoActive: () => boolean;
  isAutoPaused: () => boolean;
}

let _pi: ExtensionAPI | null = null;
let _statusApi: GsdStatusApi | null = null;

export function injectDeps(pi: ExtensionAPI, statusApi: GsdStatusApi | null): void {
  _pi = pi;
  _statusApi = statusApi;
}

/** Parse the raw message text into a typed command. */
export function parseCommand(text: string): RemoteCommand {
  const clean = text.trim().toLowerCase();

  if (clean === "/auto" || clean === "/gsd auto" || clean === "auto") return { type: "auto" };
  if (clean === "/stop" || clean === "/gsd stop" || clean === "stop") return { type: "stop" };
  if (clean === "/pause" || clean === "/gsd pause" || clean === "pause") return { type: "pause" };
  if (clean === "/status" || clean === "/gsd status" || clean === "status") return { type: "status" };
  if (clean === "/help" || clean === "help") return { type: "help" };

  return { type: "unknown", raw: text };
}

/** Execute a parsed command. Returns a reply string for Telegram. */
export async function executeCommand(cmd: RemoteCommand): Promise<DispatchResult> {
  if (!_pi) {
    return { reply: "⚠️ Extension not initialized.", stateChanged: false };
  }

  switch (cmd.type) {
    case "auto": {
      _pi.sendUserMessage("/gsd auto");
      return { reply: "▶️ Sent <code>/gsd auto</code> — check terminal for progress.", stateChanged: true };
    }

    case "stop": {
      _pi.sendUserMessage("/gsd stop");
      return { reply: "⏹️ Sent <code>/gsd stop</code>.", stateChanged: true };
    }

    case "pause": {
      _pi.sendUserMessage("/gsd pause");
      return { reply: "⏸️ Sent <code>/gsd pause</code>. Send /auto to resume.", stateChanged: true };
    }

    case "status": {
      if (_statusApi) {
        const active = _statusApi.isAutoActive();
        const paused = _statusApi.isAutoPaused();
        if (active) return { reply: "🟢 Auto-mode: <b>running</b>", stateChanged: false };
        if (paused) return { reply: "🟡 Auto-mode: <b>paused</b> — send /auto to resume", stateChanged: false };
        return { reply: "⚫ Auto-mode: <b>idle</b>", stateChanged: false };
      }
      // Status API not available — fall back to triggering the GSD status command
      _pi.sendUserMessage("/gsd auto status");
      return { reply: "ℹ️ Status requested — check terminal.", stateChanged: false };
    }

    case "help":
      return {
        reply: [
          "<b>GSD Remote Commands</b>",
          "",
          "/auto — Start or resume auto-mode",
          "/stop — Stop auto-mode",
          "/pause — Pause auto-mode",
          "/status — Show current state",
          "/help — This message",
        ].join("\n"),
        stateChanged: false,
      };

    case "unknown":
      return {
        reply: `❓ Unknown command: <code>${cmd.raw.slice(0, 50)}</code>\n\nSend /help for available commands.`,
        stateChanged: false,
      };
  }
}
