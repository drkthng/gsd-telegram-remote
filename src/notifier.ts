/**
 * notifier.ts — Pure notification logic for GSD auto-mode state transitions
 * and tool result events.
 *
 * All functions are side-effect-free so they can be unit tested without
 * mocking the GSD runtime or Telegram API.
 */

export interface GsdAutoState {
  phase: string;
  mid: string;
  sliceId: string;
  taskId: string;
  blockers: string[];
  isActive: boolean;
  isPaused: boolean;
}

export const EMPTY_STATE: GsdAutoState = {
  phase: '',
  mid: '',
  sliceId: '',
  taskId: '',
  blockers: [],
  isActive: false,
  isPaused: false,
};

/**
 * Given the previous and current GSD auto-mode state, returns zero or more
 * HTML-formatted Telegram notification strings for status transitions only:
 *   - Auto started/stopped/paused
 *   - Blocked
 *
 * Task/slice/milestone completions are handled by formatToolResultNotification()
 * via the tool_result event — that's 100% reliable and doesn't depend on
 * deriveState() or state diffing.
 */
export function computeNotifications(
  prev: GsdAutoState,
  curr: GsdAutoState,
  projectName?: string,
): string[] {
  const msgs: string[] = [];
  const prefix = projectName ? `[${projectName}] ` : '';

  // Auto started (first time we see isActive after it was off)
  if (curr.isActive && !prev.isActive) {
    msgs.push(`${prefix}▶️ Auto-mode started — <b>${curr.mid}/${curr.sliceId}/${curr.taskId}</b>`);
  }

  // Blocked
  if (curr.phase === 'blocked' && prev.phase !== 'blocked') {
    msgs.push(`${prefix}🚫 <b>Blocked:</b> ${curr.blockers.join(', ') || 'unknown'}`);
  }

  // Auto stopped
  if (prev.isActive && !curr.isActive && !curr.isPaused) {
    msgs.push(`${prefix}⏹️ Auto-mode stopped.`);
  }

  // Auto paused
  if (prev.isActive && !curr.isActive && curr.isPaused) {
    msgs.push(`${prefix}⏸️ Auto-mode paused — send /auto to resume.`);
  }

  return msgs;
}

// ── GSD tool names that map to lifecycle completions ──────────────────────

const TASK_COMPLETE_TOOLS = new Set(['gsd_task_complete', 'gsd_complete_task']);
const SLICE_COMPLETE_TOOLS = new Set(['gsd_slice_complete', 'gsd_complete_slice']);
const MILESTONE_COMPLETE_TOOLS = new Set(['gsd_milestone_complete', 'gsd_complete_milestone']);

/**
 * Lightweight input bag — only the fields we actually read from tool_result.input.
 * Avoids coupling to full GSD parameter types.
 */
export interface ToolResultInput {
  milestoneId?: string;
  sliceId?: string;
  taskId?: string;
  oneLiner?: string;
  sliceTitle?: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * Format a GSD lifecycle tool_result event into a Telegram notification.
 *
 * Returns null if the tool is not a lifecycle tool or if the tool errored.
 * This replaces the fragile deriveState() + state-diff approach with a
 * direct event-based mechanism that fires 100% of the time.
 */
export function formatToolResultNotification(
  toolName: string,
  input: ToolResultInput,
  isError: boolean,
  projectName?: string,
): string | null {
  if (isError) return null;

  const prefix = projectName ? `[${projectName}] ` : '';
  const mid = input.milestoneId ?? '';
  const sid = input.sliceId ?? '';
  const tid = input.taskId ?? '';

  if (TASK_COMPLETE_TOOLS.has(toolName)) {
    const detail = input.oneLiner ? ` — ${input.oneLiner}` : '';
    return `${prefix}✅ Task <b>${mid}/${sid}/${tid}</b> complete${detail}`;
  }

  if (SLICE_COMPLETE_TOOLS.has(toolName)) {
    const detail = input.sliceTitle ? ` — ${input.sliceTitle}` : '';
    return `${prefix}🔷 Slice <b>${mid}/${sid}</b> complete${detail}`;
  }

  if (MILESTONE_COMPLETE_TOOLS.has(toolName)) {
    const detail = input.title ? ` — ${input.title}` : '';
    return `${prefix}🏁 Milestone <b>${mid}</b> complete!${detail}`;
  }

  return null;
}

/**
 * Check whether a tool name is a GSD lifecycle completion tool.
 * Useful for fast-path filtering before calling formatToolResultNotification.
 */
export function isLifecycleTool(toolName: string): boolean {
  return TASK_COMPLETE_TOOLS.has(toolName)
    || SLICE_COMPLETE_TOOLS.has(toolName)
    || MILESTONE_COMPLETE_TOOLS.has(toolName);
}

/**
 * Helper: Determine the budget alert level for a given percentage.
 * @private — internal use only
 */
function getBudgetAlertLevelLocal(pct: number): 0 | 75 | 80 | 90 | 100 {
  if (pct >= 100) return 100;
  if (pct >= 90) return 90;
  if (pct >= 80) return 80;
  if (pct >= 75) return 75;
  return 0;
}

/**
 * Returns a Telegram notification string if the budget level has crossed a new threshold,
 * or null if no new threshold was crossed or ceiling is undefined/zero.
 *
 * An optional projectName prefixes the message as "[projectName]".
 *
 * @param prevLevel   - previous alert level (0 | 75 | 80 | 90 | 100)
 * @param cost        - current dollar cost
 * @param ceiling     - budget ceiling in dollars (undefined = feature disabled)
 * @param projectName - optional project name prefix
 * @returns { message, newLevel } or null
 */
export function computeBudgetAlert(
  prevLevel: number,
  cost: number,
  ceiling: number | undefined,
  projectName?: string,
): { message: string; newLevel: number } | null {
  if (!ceiling) return null;
  const pct = (cost / ceiling) * 100;
  const newLevel = getBudgetAlertLevelLocal(pct);
  if (newLevel === prevLevel || newLevel === 0) return null;
  const prefix = projectName ? `[${projectName}] ` : '';
  const emoji = newLevel >= 100 ? '🚨' : '⚠️';
  const msg = `${prefix}${emoji} Budget ${newLevel}%: $${cost.toFixed(2)} / $${ceiling.toFixed(2)}`;
  return { message: msg, newLevel };
}
