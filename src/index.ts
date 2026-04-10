/**
 * index.ts — Extension entry point.
 *
 * GSD calls the default export (factory function) with the ExtensionAPI (pi).
 *
 * What this extension does:
 *  1. Polls Telegram for incoming commands (/auto, /stop, /pause, /status, /help)
 *     and dispatches them via pi.sendUserMessage()
 *  2. Sends proactive Telegram notifications for auto-mode events:
 *       - Task complete       → "[project] ✅ Task M001/S01/T01 complete"
 *       - Slice complete      → "[project] 🔷 Slice M001/S01 complete"
 *       - Milestone complete  → "[project] 🏁 Milestone M001 complete!"
 *       - Auto-mode paused    → "[project] ⏸️ Auto-mode paused"
 *       - Auto-mode stopped   → "[project] ⏹️ Auto-mode stopped"
 *       - Auto-mode blocked   → "[project] 🚫 Blocked: <reason>"
 *  3. Pauses the poll loop when the built-in ask_user_questions fires
 *     (via tool_execution_start/end events) so GSD's TelegramAdapter can
 *     take over polling without offset conflicts.
 */

import path from "node:path";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { importExtensionModule } from "@gsd/pi-coding-agent";
import { resolveConfig, isEnabled } from "./config.js";
import { injectDeps, injectListProjects, injectBus, injectGsdCommandDispatcher, setCachedCtx, executeCommand, consumeLocalAutoDispatched } from "./dispatcher.js";
import { listProjects } from "./projects.js";
import { PollLoop } from "./poller.js";
import { CommandBus } from "./command-bus.js";
import { acquirePollLock, releasePollLock } from "./poll-lock.js";
import { type GsdAutoState, EMPTY_STATE, computeNotifications, computeBudgetAlert, formatToolResultNotification, isLifecycleTool, type ToolResultInput } from "./notifier.js";

let loop: PollLoop | null = null;

/** Cached active detail — updated after each agent_end; read synchronously by statusApi.getActiveDetail(). */
let cachedActiveDetail: { mid: string; sliceId: string; taskId: string; phase: string } | null = null;

export default async function activate(pi: ExtensionAPI): Promise<void> {
  let prefs: Record<string, unknown> | null = null;
  let statusApi: {
    isAutoActive: () => boolean;
    isAutoPaused: () => boolean;
    getActiveDetail?: () => { mid: string; sliceId: string; taskId: string; phase: string } | null;
  } | null = null;

  const prefsModule = await importExtensionModule(
    import.meta.url,
    "../../gsd/preferences.ts",
  ).catch((e: unknown) => {
    console.warn(`[gsd-telegram-remote] failed to import gsd/preferences.ts: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }) as any;

  if (prefsModule?.loadEffectiveGSDPreferences) {
    prefs = prefsModule.loadEffectiveGSDPreferences()?.preferences ?? null;
  }

  const autoModule = await importExtensionModule(
    import.meta.url,
    "../../gsd/auto.ts",
  ).catch((e: unknown) => {
    console.warn(`[gsd-telegram-remote] failed to import gsd/auto.ts: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }) as any;

  if (autoModule?.isAutoActive && autoModule?.isAutoPaused) {
    statusApi = {
      isAutoActive: autoModule.isAutoActive,
      isAutoPaused: autoModule.isAutoPaused,
      getActiveDetail: () => cachedActiveDetail,
    };
  }

  // Import GSD's command dispatcher so we can invoke /gsd auto|stop|pause
  // with the real ctx (which includes modelRegistry etc) instead of sendUserMessage
  // which bypasses the slash command handler.
  const gsdCommandsModule = await importExtensionModule(
    import.meta.url,
    "../../gsd/commands/dispatcher.ts",
  ).catch(() => null) as any;

  if (gsdCommandsModule?.handleGSDCommand) {
    injectGsdCommandDispatcher(gsdCommandsModule.handleGSDCommand);
  }

  if (!isEnabled(prefs)) return;

  injectDeps(pi, statusApi);
  injectListProjects(listProjects);

  const config = resolveConfig(prefs);
  if (!config) {
    console.warn("[gsd-telegram-remote] No valid config. Set TELEGRAM_BOT_TOKEN, telegram_remote.chat_id, and telegram_remote.allowed_user_ids in preferences.");
    return;
  }

  // Derive project name from the working directory (folder basename)
  const projectName = path.basename(process.cwd());

  const bus = new CommandBus({ projectName });
  injectBus(bus, projectName);

  loop = new PollLoop({
    botToken: config.botToken,
    chatId: config.chatId,
    allowedUserIds: config.allowedUserIds,
    onError: (err) => {
      console.error(`[gsd-telegram-remote] poll error: ${err.message}`);
    },
  });

  // Acquire poll lock before registering the tool so isPollOwner is known.
  bus.startListening(async (cmd) => executeCommand(cmd));
  const ownsPolling = acquirePollLock();
  if (ownsPolling) {
    loop.start();
    console.log(`[gsd-telegram-remote] Telegram remote control active (polling).`);
  } else {
    console.log(`[gsd-telegram-remote] Notifications only — another session owns command polling.`);
  }

  // ── Pause poll loop during built-in ask_user_questions ────────────────────
  // GSD's TelegramAdapter handles the Q&A round-trip. We just need to get out
  // of the way so there's no offset conflict on getUpdates.

  pi.on('tool_execution_start', (event: any) => {
    if (event.toolName === 'ask_user_questions') {
      loop?.pause();
    }
  });

  pi.on('tool_execution_end', (event: any) => {
    if (event.toolName === 'ask_user_questions') {
      loop?.resume();
    }
  });

  // ── Lifecycle notifications via tool_result events ────────────────────────
  // Fires a Telegram notification whenever a GSD lifecycle tool succeeds:
  //   gsd_task_complete / gsd_complete_task   → ✅ Task M001/S01/T01 complete
  //   gsd_slice_complete / gsd_complete_slice → 🔷 Slice M001/S01 complete
  //   gsd_milestone_complete / gsd_complete_milestone → 🏁 Milestone M001 complete!
  //
  // This is 100% reliable — every tool call produces a tool_result event with
  // toolName, input params, and isError. No state diffing, no deriveState(),
  // no dynamic imports of GSD internals. It just works.

  pi.on('tool_result', async (event: any) => {
    if (!loop) return;
    if (!isLifecycleTool(event.toolName)) return;
    const msg = formatToolResultNotification(
      event.toolName,
      (event.input ?? {}) as ToolResultInput,
      !!event.isError,
      projectName,
    );
    if (msg) {
      await loop.notify(msg).catch((err: unknown) => {
        console.error('[gsd-telegram-remote] tool_result notify failed:', err);
      });
    }
  });

  // ── Status notifications via agent_end events ─────────────────────────────
  // Detects auto-mode status transitions (started, stopped, paused, blocked).
  // Also refreshes cachedActiveDetail for /status and handles budget alerts.

  let prevState: GsdAutoState = EMPTY_STATE;
  let prevBudgetLevel = 0;

  pi.on('agent_end', async (_event, ctx) => {
    // Capture the real ctx so dispatcher can invoke /gsd commands with it
    if (ctx) setCachedCtx(ctx);
    if (!loop) return;
    try {
      const stateModule = await importExtensionModule(import.meta.url, '../../gsd/state.ts').catch((e: unknown) => {
        console.error('[gsd-telegram-remote] agent_end: failed to import state.ts:', e);
        return null;
      }) as any;
      if (!stateModule?.deriveState) return;
      const rawState = await stateModule.deriveState(process.cwd()).catch(() => null);

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
      const msgs = computeNotifications(prevState, curr, projectName);
      prevState = curr;
      for (const msg of msgs) {
        await loop.notify(msg);
      }

      // Nothing-to-run notification: /auto was dispatched locally but auto-mode
      // never became active (phase stayed complete — no pending milestones).
      if (consumeLocalAutoDispatched() && !curr.isActive && !curr.isPaused && curr.phase === 'complete') {
        await loop.notify(`[${projectName}] ℹ️ <b>/gsd auto</b> — no pending milestones. Queue a new one with /gsd queue.`);
      }

      // Budget alert
      const ceiling = typeof prefs?.budget_ceiling === 'number' ? prefs.budget_ceiling : undefined;
      if (ceiling) {
        try {
          const metricsModule = await importExtensionModule(import.meta.url, '../../gsd/metrics.ts').catch(() => null) as any;
          if (metricsModule?.getLedger && metricsModule?.getProjectTotals) {
            const ledger = metricsModule.getLedger();
            if (ledger) {
              const totals = metricsModule.getProjectTotals(ledger.units);
              const cost: number = totals.cost ?? 0;
              const alert = computeBudgetAlert(prevBudgetLevel, cost, ceiling, projectName);
              if (alert) {
                prevBudgetLevel = alert.newLevel;
                await loop.notify(alert.message);
              }
            }
          }
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      console.error('[gsd-telegram-remote] agent_end handler threw:', e);
    }
  });

  // Shutdown: stop poll loop and release lock
  pi.on("session_shutdown", () => {
    bus.stopListening();
    loop?.stop();
    loop = null;
    releasePollLock();
  });
}
