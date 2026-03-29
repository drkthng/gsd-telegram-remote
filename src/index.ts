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
import { type GsdAutoState, EMPTY_STATE, computeNotifications, computeBudgetAlert } from "./notifier.js";

let loop: PollLoop | null = null;

/** Cached active detail — updated after each agent_end; read synchronously by statusApi.getActiveDetail(). */
let cachedActiveDetail: { mid: string; sliceId: string; taskId: string; phase: string } | null = null;

export default async function activate(pi: ExtensionAPI): Promise<void> {
  let prefs: Record<string, unknown> | null = null;
  let resolveRemoteConfig: (() => { token: string; channelId: string } | null) | null = null;
  let statusApi: {
    isAutoActive: () => boolean;
    isAutoPaused: () => boolean;
    getActiveDetail?: () => { mid: string; sliceId: string; taskId: string; phase: string } | null;
  } | null = null;

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
        // Returns the last GSD state snapshot synchronously from the module-level cache.
        // The cache is refreshed on every agent_end event so it stays current without
        // making this call-site async (which would require changing the dispatcher interface).
        getActiveDetail: () => cachedActiveDetail,
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
  // Single handler reads GSD state after each unit completes and delegates all
  // transition logic to computeNotifications() in src/notifier.ts (pure, testable).
  // Also refreshes cachedActiveDetail so /status can report the current unit.

  let prevState: GsdAutoState = EMPTY_STATE;
  let prevBudgetLevel = 0;

  pi.on('agent_end', async () => {
    if (!loop) return;
    try {
      const { importExtensionModule } = await import('@gsd/pi-coding-agent');
      const stateModule = await importExtensionModule(import.meta.url, '../gsd/state.js').catch(() => null) as any;
      const rawState = stateModule?.deriveState ? await stateModule.deriveState(process.cwd()).catch(() => null) : null;

      // Refresh cached active detail for synchronous getActiveDetail() reads
      cachedActiveDetail = rawState
        ? {
            mid: rawState.activeMilestone?.id ?? "",
            sliceId: rawState.activeSlice?.id ?? "",
            taskId: rawState.activeTask?.id ?? "",
            phase: rawState.phase ?? "",
          }
        : null;

      const curr: GsdAutoState = {
        phase: rawState?.phase ?? '',
        mid: rawState?.activeMilestone?.id ?? '',
        sliceId: rawState?.activeSlice?.id ?? '',
        taskId: rawState?.activeTask?.id ?? '',
        blockers: rawState?.blockers ?? [],
        isActive: statusApi?.isAutoActive() ?? false,
        isPaused: statusApi?.isAutoPaused() ?? false,
      };
      const msgs = computeNotifications(prevState, curr);
      prevState = curr;
      for (const msg of msgs) {
        await loop.notify(msg);
      }

      // Budget alert
      const ceiling = typeof prefs?.budget_ceiling === 'number' ? prefs.budget_ceiling : undefined;
      if (ceiling) {
        try {
          const metricsModule = await importExtensionModule(import.meta.url, '../gsd/metrics.js').catch(() => null) as any;
          if (metricsModule?.getLedger && metricsModule?.getProjectTotals) {
            const ledger = metricsModule.getLedger();
            if (ledger) {
              const totals = metricsModule.getProjectTotals(ledger.units);
              const cost: number = totals.cost ?? 0;
              const alert = computeBudgetAlert(prevBudgetLevel, cost, ceiling);
              if (alert) {
                prevBudgetLevel = alert.newLevel;
                await loop.notify(alert.message);
              }
            }
          }
        } catch { /* non-fatal */ }
      }
    } catch {
      // Non-fatal — notification failures must not affect the main loop
    }
  });

  // Shutdown: stop poll loop cleanly
  pi.on("session_shutdown", () => {
    loop?.stop();
    loop = null;
  });

  loop.start();
  console.log("[gsd-telegram-remote] Telegram remote control active.");
}
