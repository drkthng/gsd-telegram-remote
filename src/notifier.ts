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
 * Rules (evaluated in order — all that match are returned):
 *   Task complete    : prev.taskId non-empty AND curr.taskId !== prev.taskId AND curr.mid === prev.mid
 *   Slice complete   : prev.sliceId non-empty AND curr.sliceId !== prev.sliceId AND curr.mid === prev.mid
 *   Milestone complete: prev.mid non-empty AND curr.mid !== prev.mid
 *   Blocked          : curr.phase === 'blocked' AND prev.phase !== 'blocked'
 *   Auto stopped     : prev.isActive AND !curr.isActive AND !curr.isPaused
 *   Auto paused      : prev.isActive AND !curr.isActive AND curr.isPaused
 */
export function computeNotifications(prev: GsdAutoState, curr: GsdAutoState): string[] {
  const msgs: string[] = [];

  // Task complete
  if (prev.taskId && curr.taskId !== prev.taskId && curr.mid === prev.mid) {
    msgs.push(`✅ Task <b>${prev.taskId}</b> complete`);
  }

  // Slice complete
  if (prev.sliceId && curr.sliceId !== prev.sliceId && curr.mid === prev.mid) {
    msgs.push(`🔷 Slice <b>${prev.sliceId}</b> complete`);
  }

  // Milestone complete
  if (prev.mid && curr.mid !== prev.mid) {
    msgs.push(`🏁 Milestone <b>${prev.mid}</b> complete!`);
  }

  // Blocked
  if (curr.phase === 'blocked' && prev.phase !== 'blocked') {
    msgs.push(`🚫 <b>Blocked:</b> ${curr.blockers.join(', ') || 'unknown'}`);
  }

  // Auto stopped
  if (prev.isActive && !curr.isActive && !curr.isPaused) {
    msgs.push(`⏹️ Auto-mode stopped.`);
  }

  // Auto paused
  if (prev.isActive && !curr.isActive && curr.isPaused) {
    msgs.push(`⏸️ Auto-mode paused — send /auto to resume.`);
  }

  return msgs;
}
