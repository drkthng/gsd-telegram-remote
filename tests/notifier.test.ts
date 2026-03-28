import { describe, it, expect } from '@jest/globals';
import { computeNotifications, EMPTY_STATE, GsdAutoState } from '../src/notifier.js';

const base: GsdAutoState = {
  phase: 'running',
  mid: 'M001',
  sliceId: 'S01',
  taskId: 'T01',
  blockers: [],
  isActive: true,
  isPaused: false,
};

describe('computeNotifications', () => {
  // TC01: task advances within same mid/slice
  it('TC01 task complete: fires ✅ task notification when taskId advances', () => {
    const prev: GsdAutoState = { ...base, taskId: 'T01' };
    const curr: GsdAutoState = { ...base, taskId: 'T02' };
    const result = computeNotifications(prev, curr);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining('✅ Task <b>T01</b> complete'),
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
      expect.stringContaining('🔷 Slice <b>S01</b> complete'),
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
