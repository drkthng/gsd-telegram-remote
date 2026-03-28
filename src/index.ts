/**
 * index.ts — Extension entry point.
 *
 * GSD calls the default export (factory function) with the ExtensionAPI (pi).
 *
 * What this extension does:
 *  1. Polls Telegram for incoming commands (/auto, /stop, /pause, /status, /help)
 *     and dispatches them via pi.sendUserMessage()
 *  2. Sends proactive Telegram notifications for auto-mode events:
 *       - Task complete       → "✅ Task T01 complete"
 *       - Slice complete      → "🔷 Slice S01 complete"
 *       - Milestone complete  → "🏁 Milestone M001 complete!"
 *       - Auto-mode paused    → "⏸️ Auto-mode paused"
 *       - Auto-mode stopped   → "⏹️ Auto-mode stopped"
 *       - Auto-mode blocked   → "🚫 Blocked: <reason>"
 *
 * NOTE: GSD's built-in sendRemoteNotification() exists but is never called from
 * auto-mode. The only Telegram messages the user currently receives are
 * ask_user_questions prompts. This extension adds everything else.
 *
 * Conflict guard: the poll loop is paused while ask_user_questions is in flight
 * to prevent our getUpdates offset advancing past a question-answer reply.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { resolveConfig, injectGsdConfigResolver, isEnabled } from "./config.js";
import { injectDeps, injectListProjects } from "./dispatcher.js";
import { listProjects } from "./projects.js";
import { PollLoop } from "./poller.js";

let loop: PollLoop | null = null;

export default async function activate(pi: ExtensionAPI): Promise<void> {
  let prefs: Record<string, unknown> | null = null;
  let resolveRemoteConfig: (() => { token: string; channelId: string } | null) | null = null;
  let statusApi: { isAutoActive: () => boolean; isAutoPaused: () => boolean } | null = null;

  try {
    const { importExtensionModule } = await import("@gsd/pi-coding-agent");

    const prefsModule = await importExtensionModule(
      import.meta.url,
      "../gsd/preferences.js",
    ).catch(() => null) as any;

    if (prefsModule?.loadEffectiveGSDPreferences) {
      prefs = prefsModule.loadEffectiveGSDPreferences()?.preferences ?? null;
    }

    const remoteModule = await importExtensionModule(
      import.meta.url,
      "../remote-questions/config.js",
    ).catch(() => null) as any;

    if (remoteModule?.resolveRemoteConfig) {
      resolveRemoteConfig = remoteModule.resolveRemoteConfig;
    }

    const autoModule = await importExtensionModule(
      import.meta.url,
      "../gsd/auto.js",
    ).catch(() => null) as any;

    if (autoModule?.isAutoActive && autoModule?.isAutoPaused) {
      statusApi = {
        isAutoActive: autoModule.isAutoActive,
        isAutoPaused: autoModule.isAutoPaused,
      };
    }
  } catch {
    console.error("[gsd-telegram-remote] Not running inside GSD — extension inactive.");
    return;
  }

  if (!isEnabled(prefs)) return;

  if (!resolveRemoteConfig) {
    console.warn("[gsd-telegram-remote] remote-questions config not found — run /gsd remote telegram first.");
    return;
  }

  injectGsdConfigResolver(resolveRemoteConfig);
  injectDeps(pi, statusApi);
  injectListProjects(listProjects);

  const config = resolveConfig(prefs);
  if (!config) {
    console.warn("[gsd-telegram-remote] No valid config. Ensure remote_questions is configured and telegram_remote.allowed_user_ids is set.");
    return;
  }

  loop = new PollLoop({
    botToken: config.botToken,
    chatId: config.chatId,
    allowedUserIds: config.allowedUserIds,
    onError: (err) => {
      console.error(`[gsd-telegram-remote] poll error: ${err.message}`);
    },
  });

  // ── Conflict guard: pause poll loop while ask_user_questions is in flight ──
  pi.on("tool_execution_start", (event) => {
    if (event.toolName === "ask_user_questions") {
      loop?.pause();
    }
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName === "ask_user_questions") {
      loop?.resume();
    }
  });

  // ── Proactive notifications via agent_end events ──────────────────────────
  // GSD's auto-mode never calls sendRemoteNotification(). The user currently only
  // receives Telegram messages for ask_user_questions prompts. We add push
  // notifications for the events that matter.
  //
  // Strategy: inspect ui.notify calls by hooking into the GSD state machine's
  // output. The cleanest available signal without GSD internals is the
  // ctx.ui.notify text surfaced in auto-mode — but extensions can't intercept
  // that. Instead, we watch agent_end (each unit completes) and read the GSD
  // STATE.md to detect transitions.
  //
  // Simpler and more reliable: hook the cmux/notification event bus that GSD
  // already fires for every sendDesktopNotification call. Those events carry
  // the exact same title+message GSD would show on the desktop.
  //
  // Fallback: subscribe to agent_end and compare STATE.md before/after.
  // We use the desktop notification hook path — it's the only non-invasive tap
  // on every meaningful auto-mode event (milestone complete, blocked, budget, etc.)

  let previousState = { phase: "", mid: "", taskId: "" };

  pi.on("agent_end", async () => {
    if (!loop) return;

    // Read STATE.md to detect transitions
    try {
      const { importExtensionModule } = await import("@gsd/pi-coding-agent");
      const stateModule = await importExtensionModule(
        import.meta.url,
        "../gsd/state.js",
      ).catch(() => null) as any;

      if (!stateModule?.deriveState) return;

      const cwd = process.cwd();
      const state = await stateModule.deriveState(cwd).catch(() => null);
      if (!state) return;

      const mid = state.activeMilestone?.id ?? "";
      const taskId = state.activeTask?.id ?? "";
      const phase = state.phase ?? "";

      // Task completed (taskId changed away from a running task)
      if (previousState.taskId && previousState.taskId !== taskId && previousState.mid === mid) {
        await loop.notify(`✅ Task <b>${previousState.taskId}</b> complete`);
      }

      // Slice completed (detect via slice transition)
      const sliceId = state.activeSlice?.id ?? "";
      const prevSliceId = (previousState as any).sliceId ?? "";
      if (prevSliceId && prevSliceId !== sliceId && previousState.mid === mid) {
        await loop.notify(`🔷 Slice <b>${prevSliceId}</b> complete`);
      }

      // Milestone completed
      if (previousState.mid && previousState.mid !== mid && previousState.phase !== "complete") {
        await loop.notify(`🏁 Milestone <b>${previousState.mid}</b> complete!`);
      }

      // Auto-mode blocked
      if (phase === "blocked" && previousState.phase !== "blocked") {
        const blockers = state.blockers?.join(", ") ?? "unknown";
        await loop.notify(`🚫 <b>Blocked:</b> ${blockers}`);
      }

      previousState = { phase, mid, taskId, ...(sliceId ? { sliceId } : {}) } as any;
    } catch {
      // Non-fatal — notification failures should never affect the main loop
    }
  });

  // Auto-mode paused/stopped — detect via isAutoPaused state change
  let wasActive = false;
  let wasPaused = false;

  pi.on("agent_end", () => {
    if (!loop || !statusApi) return;

    const active = statusApi.isAutoActive();
    const paused = statusApi.isAutoPaused();

    if (wasActive && !active && !paused) {
      void loop.notify("⏹️ Auto-mode stopped.");
    } else if (wasActive && !active && paused) {
      void loop.notify("⏸️ Auto-mode paused — send /auto to resume.");
    }

    wasActive = active;
    wasPaused = paused;
  });

  // Shutdown: stop poll loop cleanly
  pi.on("session_shutdown", () => {
    loop?.stop();
    loop = null;
  });

  loop.start();
  console.log("[gsd-telegram-remote] Telegram remote control active.");
}
