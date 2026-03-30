/**
 * notifier.ts — Pure notification logic for GSD auto-mode state transitions.
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
 * HTML-formatted Telegram notification strings for every relevant transition.
 *
 * An optional projectName prefixes every message as "[projectName]" so the
 * user can tell which project sent the notification when multiple projects
 * are running.
 *
 * Rules (evaluated in order — all that match are returned):
 *   Task complete     : prev.taskId non-empty AND curr.taskId !== prev.taskId AND curr.mid === prev.mid
 *   Slice complete    : prev.sliceId non-empty AND curr.sliceId !== prev.sliceId AND curr.mid === prev.mid
 *   Milestone complete: prev.mid non-empty AND curr.mid !== prev.mid
 *   Blocked           : curr.phase === 'blocked' AND prev.phase !== 'blocked'
 *   Auto stopped      : prev.isActive AND !curr.isActive AND !curr.isPaused
 *   Auto paused       : prev.isActive AND !curr.isActive AND curr.isPaused
 */
export function computeNotifications(
  prev: GsdAutoState,
  curr: GsdAutoState,
  projectName?: string,
): string[] {
  const msgs: string[] = [];
  const prefix = projectName ? `[${projectName}] ` : '';

  // Task complete
  if (prev.taskId && curr.taskId !== prev.taskId && curr.mid === prev.mid) {
    msgs.push(`${prefix}✅ Task <b>${prev.mid}/${prev.sliceId}/${prev.taskId}</b> complete`);
  }

  // Slice complete
  if (prev.sliceId && curr.sliceId !== prev.sliceId && curr.mid === prev.mid) {
    msgs.push(`${prefix}🔷 Slice <b>${prev.mid}/${prev.sliceId}</b> complete`);
  }

  // Milestone complete
  if (prev.mid && curr.mid !== prev.mid) {
    msgs.push(`${prefix}🏁 Milestone <b>${prev.mid}</b> complete!`);
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
