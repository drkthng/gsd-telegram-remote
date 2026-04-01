import { describe, it, expect } from '@jest/globals';
import {
  computeNotifications,
  computeBudgetAlert,
  formatToolResultNotification,
  isLifecycleTool,
  EMPTY_STATE,
  GsdAutoState,
} from '../src/notifier.js';

const base: GsdAutoState = {
  phase: 'running',
  mid: 'M001',
  sliceId: 'S01',
  taskId: 'T01',
  blockers: [],
  isActive: true,
  isPaused: false,
};

// ─── computeNotifications (status transitions only — no task/slice/milestone) ──

describe('computeNotifications (no project name)', () => {
  it('fires ▶️ auto started when isActive transitions to true', () => {
    const prev: GsdAutoState = { ...base, isActive: false };
    const curr: GsdAutoState = { ...base, isActive: true };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('▶️ Auto-mode started'),
    ]));
  });

  it('fires 🚫 blocked notification with blocker message', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: ['budget exceeded'] };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('🚫 <b>Blocked:</b> budget exceeded'),
    ]));
  });

  it('joins multiple blockers with comma', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: ['no key', 'no budget'] };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('no key, no budget'))).toBe(true);
  });

  it('falls back to "unknown" when blockers array is empty', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: [] };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('unknown'))).toBe(true);
  });

  it('no notification when recovering from blocked', () => {
    const prev: GsdAutoState = { ...base, phase: 'blocked' };
    const curr: GsdAutoState = { ...base, phase: 'running' };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual([]);
  });

  it('fires ⏹️ notification when isActive goes false and not paused', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: false };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      '⏹️ Auto-mode stopped.',
    ]));
  });

  it('fires ⏸️ notification when isActive goes false and isPaused is true', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: true };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      '⏸️ Auto-mode paused — send /auto to resume.',
    ]));
  });

  it('stopped does not fire when paused', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: true };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('⏹️'))).toBe(false);
  });

  it('idle→idle: no notifications', () => {
    const result = computeNotifications(EMPTY_STATE, EMPTY_STATE);
    expect(result).toEqual([]);
  });

  it('no stopped/paused when prev was not active', () => {
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: false };
    const result = computeNotifications(EMPTY_STATE, curr);
    expect(result.some(m => m.includes('⏹️'))).toBe(false);
    expect(result.some(m => m.includes('⏸️'))).toBe(false);
  });
});

describe('computeNotifications (with project name)', () => {
  it('prefixes blocked message with [projectName]', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: ['test'] };
    const result = computeNotifications(prev, curr, 'my-project');
    expect(result[0]).toMatch(/^\[my-project\]/);
  });

  it('prefixes stopped message with [projectName]', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: false };
    const result = computeNotifications(prev, curr, 'my-project');
    expect(result.some(m => m === '[my-project] ⏹️ Auto-mode stopped.')).toBe(true);
  });
});

// ─── formatToolResultNotification ────────────────────────────────────────────

describe('formatToolResultNotification', () => {
  // Task complete
  it('fires ✅ for gsd_task_complete', () => {
    const msg = formatToolResultNotification(
      'gsd_task_complete',
      { milestoneId: 'M001', sliceId: 'S01', taskId: 'T01', oneLiner: 'Did the thing' },
      false,
    );
    expect(msg).toBe('✅ Task <b>M001/S01/T01</b> complete — Did the thing');
  });

  it('fires ✅ for gsd_complete_task (alias)', () => {
    const msg = formatToolResultNotification(
      'gsd_complete_task',
      { milestoneId: 'M002', sliceId: 'S03', taskId: 'T05' },
      false,
    );
    expect(msg).toBe('✅ Task <b>M002/S03/T05</b> complete');
  });

  it('returns null when gsd_task_complete errors', () => {
    const msg = formatToolResultNotification(
      'gsd_task_complete',
      { milestoneId: 'M001', sliceId: 'S01', taskId: 'T01' },
      true,
    );
    expect(msg).toBeNull();
  });

  // Slice complete
  it('fires 🔷 for gsd_slice_complete', () => {
    const msg = formatToolResultNotification(
      'gsd_slice_complete',
      { milestoneId: 'M001', sliceId: 'S01', sliceTitle: 'Core API' },
      false,
    );
    expect(msg).toBe('🔷 Slice <b>M001/S01</b> complete — Core API');
  });

  it('fires 🔷 for gsd_complete_slice (alias)', () => {
    const msg = formatToolResultNotification(
      'gsd_complete_slice',
      { milestoneId: 'M001', sliceId: 'S02' },
      false,
    );
    expect(msg).toBe('🔷 Slice <b>M001/S02</b> complete');
  });

  it('returns null when gsd_slice_complete errors', () => {
    const msg = formatToolResultNotification(
      'gsd_slice_complete',
      { milestoneId: 'M001', sliceId: 'S01' },
      true,
    );
    expect(msg).toBeNull();
  });

  // Milestone complete
  it('fires 🏁 for gsd_milestone_complete', () => {
    const msg = formatToolResultNotification(
      'gsd_milestone_complete',
      { milestoneId: 'M001', title: 'Foundation' },
      false,
    );
    expect(msg).toBe('🏁 Milestone <b>M001</b> complete! — Foundation');
  });

  it('fires 🏁 for gsd_complete_milestone (alias)', () => {
    const msg = formatToolResultNotification(
      'gsd_complete_milestone',
      { milestoneId: 'M003' },
      false,
    );
    expect(msg).toBe('🏁 Milestone <b>M003</b> complete!');
  });

  it('returns null when gsd_milestone_complete errors', () => {
    const msg = formatToolResultNotification(
      'gsd_milestone_complete',
      { milestoneId: 'M001' },
      true,
    );
    expect(msg).toBeNull();
  });

  // Non-lifecycle tools
  it('returns null for non-lifecycle tools', () => {
    expect(formatToolResultNotification('bash', {}, false)).toBeNull();
    expect(formatToolResultNotification('read', {}, false)).toBeNull();
    expect(formatToolResultNotification('gsd_plan_task', {}, false)).toBeNull();
    expect(formatToolResultNotification('gsd_save_decision', {}, false)).toBeNull();
  });

  // With project name
  it('prefixes with [projectName] when provided', () => {
    const msg = formatToolResultNotification(
      'gsd_task_complete',
      { milestoneId: 'M001', sliceId: 'S01', taskId: 'T01' },
      false,
      'my-project',
    );
    expect(msg).toBe('[my-project] ✅ Task <b>M001/S01/T01</b> complete');
  });

  it('no prefix when projectName is undefined', () => {
    const msg = formatToolResultNotification(
      'gsd_task_complete',
      { milestoneId: 'M001', sliceId: 'S01', taskId: 'T01' },
      false,
    );
    expect(msg).not.toMatch(/^\[/);
  });

  // Missing input fields gracefully handled
  it('handles missing milestoneId/sliceId/taskId gracefully', () => {
    const msg = formatToolResultNotification(
      'gsd_task_complete',
      {},
      false,
    );
    expect(msg).toBe('✅ Task <b>//</b> complete');
  });
});

// ─── isLifecycleTool ─────────────────────────────────────────────────────────

describe('isLifecycleTool', () => {
  it('returns true for all lifecycle tool names', () => {
    expect(isLifecycleTool('gsd_task_complete')).toBe(true);
    expect(isLifecycleTool('gsd_complete_task')).toBe(true);
    expect(isLifecycleTool('gsd_slice_complete')).toBe(true);
    expect(isLifecycleTool('gsd_complete_slice')).toBe(true);
    expect(isLifecycleTool('gsd_milestone_complete')).toBe(true);
    expect(isLifecycleTool('gsd_complete_milestone')).toBe(true);
  });

  it('returns false for non-lifecycle tools', () => {
    expect(isLifecycleTool('bash')).toBe(false);
    expect(isLifecycleTool('read')).toBe(false);
    expect(isLifecycleTool('gsd_plan_task')).toBe(false);
    expect(isLifecycleTool('gsd_save_decision')).toBe(false);
    expect(isLifecycleTool('ask_user_questions')).toBe(false);
  });
});

// ─── computeBudgetAlert ──────────────────────────────────────────────────────

describe('computeBudgetAlert', () => {
  it('returns null when ceiling is undefined', () => {
    expect(computeBudgetAlert(0, 10, undefined)).toBeNull();
  });

  it('returns null when ceiling is 0', () => {
    expect(computeBudgetAlert(0, 10, 0)).toBeNull();
  });

  it('returns null when cost is below 75% of ceiling', () => {
    expect(computeBudgetAlert(0, 7, 100)).toBeNull();
  });

  it('fires at 75% with ⚠️ emoji', () => {
    const result = computeBudgetAlert(0, 75, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('⚠️');
    expect(result!.message).toContain('75%');
    expect(result!.message).toContain('$75.00');
    expect(result!.message).toContain('$100.00');
    expect(result!.newLevel).toBe(75);
  });

  it('fires at 80% with correct message', () => {
    const result = computeBudgetAlert(0, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('80%');
    expect(result!.newLevel).toBe(80);
  });

  it('fires at 90%', () => {
    const result = computeBudgetAlert(0, 90, 100);
    expect(result).not.toBeNull();
    expect(result!.newLevel).toBe(90);
  });

  it('fires at 100% with 🚨 emoji', () => {
    const result = computeBudgetAlert(0, 100, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('🚨');
    expect(result!.newLevel).toBe(100);
  });

  it('returns null when prevLevel already matches (no repeat)', () => {
    expect(computeBudgetAlert(80, 80, 100)).toBeNull();
  });

  it('advances from 75 to 80', () => {
    const result = computeBudgetAlert(75, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.newLevel).toBe(80);
  });

  it('does not fire when cost is below 75%', () => {
    expect(computeBudgetAlert(0, 74, 100)).toBeNull();
  });

  it('message format: ⚠️ Budget 80%: $80.00 / $100.00', () => {
    const result = computeBudgetAlert(0, 80, 100);
    expect(result!.message).toBe('⚠️ Budget 80%: $80.00 / $100.00');
  });

  it('formats fractional dollar amounts with 2 decimal places', () => {
    const result = computeBudgetAlert(0, 7.5, 10);
    expect(result!.message).toContain('$7.50');
    expect(result!.message).toContain('$10.00');
  });

  it('prefixes with [projectName]', () => {
    const result = computeBudgetAlert(0, 80, 100, 'my-project');
    expect(result!.message).toBe('[my-project] ⚠️ Budget 80%: $80.00 / $100.00');
  });

  it('no prefix when projectName is undefined', () => {
    const result = computeBudgetAlert(0, 80, 100);
    expect(result!.message).not.toMatch(/^\[/);
  });
});
