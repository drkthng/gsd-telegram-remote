import { describe, it, expect } from '@jest/globals';
import { computeNotifications, computeBudgetAlert, EMPTY_STATE, GsdAutoState } from '../src/notifier.js';

const base: GsdAutoState = {
  phase: 'running',
  mid: 'M001',
  sliceId: 'S01',
  taskId: 'T01',
  blockers: [],
  isActive: true,
  isPaused: false,
};

describe('computeNotifications (no project name)', () => {
  // TC01: task advances within same mid/slice
  it('TC01 task complete: fires ✅ task notification when taskId advances', () => {
    const prev: GsdAutoState = { ...base, taskId: 'T01' };
    const curr: GsdAutoState = { ...base, taskId: 'T02' };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('✅ Task <b>M001/S01/T01</b> complete'),
    ]));
    // Should NOT fire slice or milestone notifications
    expect(result.some(m => m.includes('🔷'))).toBe(false);
    expect(result.some(m => m.includes('🏁'))).toBe(false);
  });

  // TC02: slice advances within same milestone
  it('TC02 slice complete: fires 🔷 slice notification when sliceId advances within same mid', () => {
    const prev: GsdAutoState = { ...base, sliceId: 'S01', taskId: 'T03' };
    const curr: GsdAutoState = { ...base, sliceId: 'S02', taskId: 'T01' };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('🔷 Slice <b>M001/S01</b> complete'),
    ]));
    expect(result.some(m => m.includes('🏁'))).toBe(false);
  });

  // TC03: milestone complete — mid changes
  it('TC03 milestone complete: fires 🏁 notification when mid advances', () => {
    const prev: GsdAutoState = { ...base, mid: 'M001' };
    const curr: GsdAutoState = { ...base, mid: 'M002' };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('🏁 Milestone <b>M001</b> complete!'),
    ]));
  });

  // TC03 variant: milestone complete when curr.mid is empty (auto stopped after last milestone)
  it('TC03b milestone complete: fires 🏁 notification when mid transitions to empty', () => {
    const prev: GsdAutoState = { ...base, mid: 'M001', isActive: true };
    const curr: GsdAutoState = { ...base, mid: '', isActive: false, isPaused: false };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('🏁 Milestone <b>M001</b> complete!'),
    ]));
  });

  // TC04: blocked transition
  it('TC04 blocked: fires 🚫 notification with blocker message', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: ['budget exceeded'] };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('🚫 <b>Blocked:</b> budget exceeded'),
    ]));
  });

  // TC04b: blocked with multiple blockers
  it('TC04b blocked: joins multiple blockers with comma', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: ['no key', 'no budget'] };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('no key, no budget'))).toBe(true);
  });

  // TC04c: blocked with empty blockers array — fallback message
  it('TC04c blocked: falls back to "unknown" when blockers array is empty', () => {
    const prev: GsdAutoState = { ...base, phase: 'running' };
    const curr: GsdAutoState = { ...base, phase: 'blocked', blockers: [] };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('unknown'))).toBe(true);
  });

  // TC05: unblocked transition — no notification
  it('TC05 unblocked: no notification when recovering from blocked', () => {
    const prev: GsdAutoState = { ...base, phase: 'blocked' };
    const curr: GsdAutoState = { ...base, phase: 'running' };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual([]);
  });

  // TC06: auto stopped
  it('TC06 auto stopped: fires ⏹️ notification when isActive goes false and not paused', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: false };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      '⏹️ Auto-mode stopped.',
    ]));
  });

  // TC07: auto paused
  it('TC07 auto paused: fires ⏸️ notification when isActive goes false and isPaused is true', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: true };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      '⏸️ Auto-mode paused — send /auto to resume.',
    ]));
  });

  // TC07b: stopped notification does NOT fire when paused
  it('TC07b: stopped notification does not fire when isPaused is true', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: true };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('⏹️'))).toBe(false);
  });

  // TC08: idle to idle — no spurious fires
  it('TC08 idle→idle: no notifications when both states are EMPTY_STATE', () => {
    const result = computeNotifications(EMPTY_STATE, EMPTY_STATE);
    expect(result).toEqual([]);
  });

  // TC09: first call — EMPTY_STATE → running, no task/slice/milestone notifications
  it('TC09 first call: no task/slice/milestone notifications on initial state hydration', () => {
    const curr: GsdAutoState = { ...base };
    const result = computeNotifications(EMPTY_STATE, curr);
    expect(result.some(m => m.includes('✅'))).toBe(false);
    expect(result.some(m => m.includes('🔷'))).toBe(false);
    expect(result.some(m => m.includes('🏁'))).toBe(false);
  });

  // TC09b: first call with isActive transition — should fire stopped/paused? No: prev.isActive is false
  it('TC09b first call: no stopped/paused notifications when prev was not active', () => {
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: false };
    const result = computeNotifications(EMPTY_STATE, curr);
    expect(result.some(m => m.includes('⏹️'))).toBe(false);
    expect(result.some(m => m.includes('⏸️'))).toBe(false);
  });

  // Edge: task complete does NOT fire when mid changes (milestone boundary, not task completion)
  it('task complete does not fire when mid changes alongside taskId change', () => {
    const prev: GsdAutoState = { ...base, mid: 'M001', taskId: 'T01' };
    const curr: GsdAutoState = { ...base, mid: 'M002', taskId: 'T01', sliceId: 'S01' };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('✅'))).toBe(false);
  });

  // Edge: slice complete does NOT fire when mid changes
  it('slice complete does not fire when mid changes alongside sliceId change', () => {
    const prev: GsdAutoState = { ...base, mid: 'M001', sliceId: 'S01' };
    const curr: GsdAutoState = { ...base, mid: 'M002', sliceId: 'S01' };
    const result = computeNotifications(prev, curr);
    expect(result.some(m => m.includes('🔷'))).toBe(false);
  });
});

describe('computeNotifications (with project name)', () => {
  it('prefixes all messages with [projectName]', () => {
    const prev: GsdAutoState = { ...base, taskId: 'T01' };
    const curr: GsdAutoState = { ...base, taskId: 'T02' };
    const result = computeNotifications(prev, curr, 'my-project');
    expect(result[0]).toMatch(/^\[my-project\]/);
    expect(result[0]).toContain('✅ Task <b>M001/S01/T01</b> complete');
  });

  it('prefixes slice complete message', () => {
    const prev: GsdAutoState = { ...base, sliceId: 'S01', taskId: 'T03' };
    const curr: GsdAutoState = { ...base, sliceId: 'S02', taskId: 'T01' };
    const result = computeNotifications(prev, curr, 'my-project');
    expect(result.some(m => m.startsWith('[my-project] 🔷'))).toBe(true);
  });

  it('prefixes milestone complete message', () => {
    const prev: GsdAutoState = { ...base, mid: 'M001' };
    const curr: GsdAutoState = { ...base, mid: 'M002' };
    const result = computeNotifications(prev, curr, 'my-project');
    expect(result.some(m => m.startsWith('[my-project] 🏁'))).toBe(true);
  });

  it('prefixes stopped message', () => {
    const prev: GsdAutoState = { ...base, isActive: true };
    const curr: GsdAutoState = { ...base, isActive: false, isPaused: false };
    const result = computeNotifications(prev, curr, 'my-project');
    expect(result.some(m => m === '[my-project] ⏹️ Auto-mode stopped.')).toBe(true);
  });

  it('no prefix when projectName is undefined', () => {
    const prev: GsdAutoState = { ...base, taskId: 'T01' };
    const curr: GsdAutoState = { ...base, taskId: 'T02' };
    const result = computeNotifications(prev, curr);
    expect(result[0]).not.toMatch(/^\[/);
  });
});

describe('computeBudgetAlert', () => {
  // TC-B01: returns null when ceiling is undefined
  it('TC-B01: returns null when ceiling is undefined', () => {
    expect(computeBudgetAlert(0, 10, undefined)).toBeNull();
  });

  // TC-B02: returns null when ceiling is 0
  it('TC-B02: returns null when ceiling is 0', () => {
    const result = computeBudgetAlert(0, 10, 0);
    expect(result).toBeNull();
  });

  // TC-B03: returns null when pct < 75
  it('TC-B03: returns null when cost is below 75% of ceiling', () => {
    expect(computeBudgetAlert(0, 7, 100)).toBeNull();
  });

  // TC-B04: fires at 75% with ⚠️ emoji and correct dollar amounts
  it('TC-B04: fires at 75% threshold with ⚠️ emoji', () => {
    const result = computeBudgetAlert(0, 75, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('⚠️');
    expect(result!.message).toContain('75%');
    expect(result!.message).toContain('$75.00');
    expect(result!.message).toContain('$100.00');
    expect(result!.newLevel).toBe(75);
  });

  // TC-B05: fires at 80% with correct message
  it('TC-B05: fires at 80% threshold with correct message', () => {
    const result = computeBudgetAlert(0, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('⚠️');
    expect(result!.message).toContain('80%');
    expect(result!.newLevel).toBe(80);
  });

  // TC-B06: fires at 90% with correct message
  it('TC-B06: fires at 90% threshold with correct message', () => {
    const result = computeBudgetAlert(0, 90, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('⚠️');
    expect(result!.message).toContain('90%');
    expect(result!.newLevel).toBe(90);
  });

  // TC-B07: fires at 100% with 🚨 emoji
  it('TC-B07: fires at 100% threshold with 🚨 emoji', () => {
    const result = computeBudgetAlert(0, 100, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('🚨');
    expect(result!.message).toContain('100%');
    expect(result!.newLevel).toBe(100);
  });

  // TC-B08: returns null when prevLevel already equals new level (no repeat fire)
  it('TC-B08: returns null when prevLevel already matches new threshold (no repeat)', () => {
    expect(computeBudgetAlert(80, 80, 100)).toBeNull();
  });

  // TC-B09: advances from prevLevel 75 → 80 when cost crosses 80%
  it('TC-B09: advances from prevLevel 75 to 80 when cost crosses 80%', () => {
    const result = computeBudgetAlert(75, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.newLevel).toBe(80);
  });

  // TC-B10: does NOT fire if pct exactly at previous level boundary
  it('TC-B10: does not fire when cost is below 75% of ceiling', () => {
    expect(computeBudgetAlert(0, 74, 100)).toBeNull();
  });

  // TC-B11: newLevel returned correctly so caller can update prevBudgetLevel state
  it('TC-B11: newLevel is returned correctly for each threshold', () => {
    expect(computeBudgetAlert(0, 75, 100)!.newLevel).toBe(75);
    expect(computeBudgetAlert(0, 80, 100)!.newLevel).toBe(80);
    expect(computeBudgetAlert(0, 90, 100)!.newLevel).toBe(90);
    expect(computeBudgetAlert(0, 100, 100)!.newLevel).toBe(100);
  });

  // TC-B12: message format matches '⚠️ Budget 80%: $X.XX / $Y.YY' exactly
  it('TC-B12: message format matches expected pattern for 80% threshold', () => {
    const result = computeBudgetAlert(0, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('⚠️ Budget 80%: $80.00 / $100.00');
  });

  // TC-B13: formats fractional dollar amounts with 2 decimal places
  it('TC-B13: formats fractional dollar amounts with 2 decimal places', () => {
    const result = computeBudgetAlert(0, 7.5, 10);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('$7.50');
    expect(result!.message).toContain('$10.00');
  });

  // TC-B14: prefixes budget alert message with project name
  it('TC-B14: prefixes budget alert with [projectName] when provided', () => {
    const result = computeBudgetAlert(0, 80, 100, 'my-project');
    expect(result).not.toBeNull();
    expect(result!.message).toBe('[my-project] ⚠️ Budget 80%: $80.00 / $100.00');
  });

  // TC-B15: no prefix when projectName is undefined
  it('TC-B15: no prefix when projectName is undefined', () => {
    const result = computeBudgetAlert(0, 80, 100);
    expect(result).not.toBeNull();
    expect(result!.message).not.toMatch(/^\[/);
  });
});
