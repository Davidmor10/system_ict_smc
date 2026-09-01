// A direction written down after the trade is not a plan the trade can be
// measured against — it is the trade explaining itself.
//
// Both readings look identical once stored, so without this the coach could
// say "your trades followed the direction you set" about a day whose direction
// was set at 23:00, after a losing session. That sentence would be false, on a
// screen whose whole value is that it is not.

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

const { declarationPrecededTrade, getDeclarationForDate } = await import('../../app/lib/dailyBias');

// The suite runs on UTC; the trader's zone defaults to Asia/Jerusalem, which
// is +3 in August. An instant is written here as UTC and compared against a
// wall clock in the trader's zone, which is the whole point of the helper.
const utc = (y: number, m: number, d: number, h: number, min: number) => Date.UTC(y, m, d, h, min);

beforeEach(() => { store.clear(); });

describe('declarationPrecededTrade', () => {
  it('accepts a direction declared earlier the same day', () => {
    // 04:42 UTC = 07:42 in Israel, before a 10:15 trade.
    expect(declarationPrecededTrade(utc(2026, 7, 24, 4, 42), '2026-08-24', '10:15')).toBe(true);
  });

  // The case this exists for.
  it('rejects a direction declared after the trade', () => {
    // 20:10 UTC = 23:10 in Israel, after a 10:15 trade.
    expect(declarationPrecededTrade(utc(2026, 7, 24, 20, 10), '2026-08-24', '10:15')).toBe(false);
  });

  it('accepts the same minute — declaring and entering together is not hindsight', () => {
    // 07:15 UTC = 10:15 in Israel.
    expect(declarationPrecededTrade(utc(2026, 7, 24, 7, 15), '2026-08-24', '10:15')).toBe(true);
  });

  it('accepts a declaration from an earlier day', () => {
    expect(declarationPrecededTrade(utc(2026, 7, 23, 4, 0), '2026-08-24', '10:15')).toBe(true);
  });

  it('rejects a declaration from a later day', () => {
    expect(declarationPrecededTrade(utc(2026, 7, 25, 4, 0), '2026-08-24', '10:15')).toBe(false);
  });

  // Compared in the trader's zone on both sides, so an instant that is still
  // "yesterday" in UTC is judged by the date it carries in Israel.
  it('compares in the trader\'s zone, not in UTC', () => {
    // 21:30 UTC on the 23rd is 00:30 on the 24th in Israel — the trade's day,
    // and before a 10:15 entry.
    expect(declarationPrecededTrade(utc(2026, 7, 23, 21, 30), '2026-08-24', '10:15')).toBe(true);
  });

  // A claim that cannot be checked is not made.
  it('refuses when the moment of declaration is unknown', () => {
    expect(declarationPrecededTrade(null, '2026-08-24', '10:15')).toBe(false);
    expect(declarationPrecededTrade(Number.NaN, '2026-08-24', '10:15')).toBe(false);
  });

  it('refuses a malformed date or time rather than guessing', () => {
    const at = utc(2026, 7, 24, 4, 0);
    expect(declarationPrecededTrade(at, '2026-8-24', '10:15')).toBe(false);
    expect(declarationPrecededTrade(at, '2026-08-24', '1015')).toBe(false);
  });
});

describe('getDeclarationForDate', () => {
  const declare = (dateISO: string, doc: unknown) =>
    localStorage.setItem(`onyx_dash_planobj_${dateISO}`, JSON.stringify({ o: 'user_test', v: doc }));

  it('returns the direction with the moment it was made', () => {
    declare('2026-08-24', { bias: 'bull', biasAt: 1756000000000 });
    expect(getDeclarationForDate('2026-08-24')).toEqual({ bias: 'BULLISH', at: 1756000000000 });
  });

  // An older record, written before the timestamp existed. Readable, but its
  // moment is unknown — which the caller must treat as unverifiable.
  it('reports a missing timestamp as null rather than inventing one', () => {
    declare('2026-08-24', { bias: 'bear' });
    expect(getDeclarationForDate('2026-08-24')).toEqual({ bias: 'BEARISH', at: null });
  });

  it('is null when no direction was declared for the day', () => {
    expect(getDeclarationForDate('2026-08-24')).toBeNull();
  });

  it('ignores a direction it does not recognise', () => {
    declare('2026-08-24', { bias: 'sideways', biasAt: 1 });
    expect(getDeclarationForDate('2026-08-24')).toBeNull();
  });
});
