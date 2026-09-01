// The direction is read for the TRADE'S day, not for today.
//
// The trade form seeded this field once, at mount, from today's declaration.
// A trader logging Sunday's trades on Tuesday therefore graded them against
// Tuesday's direction — a wrong alignment written into the database, and
// afterwards indistinguishable from a right one.

import { describe, expect, it, beforeEach } from 'vitest';

const store = new Map<string, string>();
const localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage, __ONYX_OWNER__: 'user_test' };

const { getDeclaredBiasForDate } = await import('../../app/lib/dailyBias');

const declare = (dateISO: string, bias: string) =>
  localStorage.setItem(`onyx_dash_planobj_${dateISO}`, JSON.stringify({ o: 'user_test', v: { bias } }));

beforeEach(() => { store.clear(); });

describe('getDeclaredBiasForDate', () => {
  it('reads the direction declared for that day', () => {
    declare('2026-08-23', 'bull');
    expect(getDeclaredBiasForDate('2026-08-23')).toBe('BULLISH');
  });

  // The bug itself: two days, two different declarations.
  it('does not return another day\'s declaration', () => {
    declare('2026-08-23', 'bull');   // Sunday — the trade
    declare('2026-08-25', 'bear');   // Tuesday — when it was logged
    expect(getDeclaredBiasForDate('2026-08-23')).toBe('BULLISH');
    expect(getDeclaredBiasForDate('2026-08-25')).toBe('BEARISH');
  });

  it('is null for a day with no declaration, so absent stays absent', () => {
    declare('2026-08-25', 'bear');
    expect(getDeclaredBiasForDate('2026-08-23')).toBeNull();
  });

  it('maps neutral to INDECISIVE rather than dropping it', () => {
    declare('2026-08-23', 'neutral');
    expect(getDeclaredBiasForDate('2026-08-23')).toBe('INDECISIVE');
  });

  // The date comes from a form field, so it can be anything.
  it('refuses a malformed date instead of building a junk key', () => {
    expect(getDeclaredBiasForDate('')).toBeNull();
    expect(getDeclaredBiasForDate('2026-8-3')).toBeNull();
    expect(getDeclaredBiasForDate('yesterday')).toBeNull();
  });

  it('survives an unreadable plan record', () => {
    localStorage.setItem('onyx_dash_planobj_2026-08-23', '}{not json');
    expect(getDeclaredBiasForDate('2026-08-23')).toBeNull();
  });
});
