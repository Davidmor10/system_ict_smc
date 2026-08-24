// ─────────────────────────────────────────────────────────────────────────────
// What the trader is HOLDING — the five behaviour detectors read from the
// other side. Every one of them answers "how often does this go wrong", which
// is the half of the picture a trader already feels. The half they cannot see
// from inside their own week is the run that is going right: eight days
// without breaking a rule, twelve entries with a confirmation logged.
//
// Non-monetary by construction. A run of green days is an outcome, not a
// strength, and this analyzer has no access to money at all.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { computeHoldingStreaks, __internals } from '../../app/lib/coach-pipeline/behavior/holding';
import type { BehaviorTally } from '../../app/lib/coach-pipeline/behavior/behaviors';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

const MIN = __internals.MIN_STREAK_TRADES;

/** Trades t1..tN, one per day unless `perDay` packs several into each. */
function history(n: number, perDay = 1): TradeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    date: `2026-08-${String(Math.floor(i / perDay) + 1).padStart(2, '0')}`,
  } as TradeRow));
}

function tally(over: Partial<BehaviorTally> & { kind: BehaviorTally['kind'] }): BehaviorTally {
  const opportunityTradeIds = over.opportunityTradeIds ?? [];
  const events = over.events ?? [];
  return {
    kind: over.kind,
    occurrences: over.occurrences ?? events.length,
    opportunities: over.opportunities ?? opportunityTradeIds.length,
    rate: 0,
    events,
    opportunityTradeIds,
  } as BehaviorTally;
}

/** A tally whose behaviour last occurred `cleanSince` trades from the end. */
function withStreak(kind: BehaviorTally['kind'], total: number, cleanSince: number): BehaviorTally {
  const ids = Array.from({ length: total }, (_, i) => `t${i + 1}`);
  const failIndex = total - cleanSince - 1;
  const events = failIndex >= 0
    ? [{ kind, tradeId: ids[failIndex], date: '2026-08-01', evidence: {} }]
    : [];
  return tally({ kind, opportunityTradeIds: ids, events: events as BehaviorTally['events'] });
}

describe('computeHoldingStreaks', () => {
  it('counts the run since the behaviour last happened, in trades and in days', () => {
    const trades = history(MIN + 3);
    const [held] = computeHoldingStreaks([withStreak('rule_violation', MIN + 3, MIN + 1)], trades);

    expect(held.kind).toBe('rule_violation');
    expect(held.trades).toBe(MIN + 1);
    expect(held.days).toBe(MIN + 1);      // one trade per day in this fixture
    expect(held.recovered).toBe(true);
  });

  it('counts days, not trades, when a day holds several trades', () => {
    const trades = history(MIN + 4, 2);   // two trades per calendar day
    const [held] = computeHoldingStreaks([withStreak('rule_violation', MIN + 4, MIN + 2)], trades);

    expect(held.trades).toBe(MIN + 2);
    expect(held.days).toBeLessThan(held.trades);
  });

  it('stays silent about a run too short to mean anything', () => {
    const trades = history(MIN + 2);
    expect(computeHoldingStreaks([withStreak('rule_violation', MIN + 2, 3)], trades)).toEqual([]);
  });

  it('does not praise a behaviour that has simply never happened, until the run is long', () => {
    // Never occurred, run == whole (short) history: an unfilled field reading
    // as a run of good decisions is the exact mistake the detectors already
    // guard against elsewhere.
    const shortClean = computeHoldingStreaks([withStreak('stop_widened', MIN, MIN)], history(MIN));
    expect(shortClean).toEqual([]);

    const longClean = computeHoldingStreaks([withStreak('stop_widened', MIN * 2, MIN * 2)], history(MIN * 2));
    expect(longClean).toHaveLength(1);
    expect(longClean[0].recovered).toBe(false);
  });

  it('ranks a behaviour they stopped above one they never had', () => {
    const trades = history(40);
    const ranked = computeHoldingStreaks([
      withStreak('stop_widened',   40, 40),   // never happened
      withStreak('rule_violation', 40, 12),   // happened, then stopped
    ], trades);

    expect(ranked[0].kind).toBe('rule_violation');
    expect(ranked[0].recovered).toBe(true);
  });

  it('hands over at most two, so the note has a subject and not a list', () => {
    const trades = history(40);
    const many = computeHoldingStreaks([
      withStreak('rule_violation',      40, 20),
      withStreak('discretionary_exit',  40, 18),
      withStreak('no_confirmation',     40, 16),
      withStreak('size_spike',          40, 14),
    ], trades);

    expect(many.length).toBeLessThanOrEqual(__internals.MAX_STREAKS);
    expect(many[0].kind).toBe('rule_violation');   // longest run leads
  });

  it('returns nothing for a trader with no opportunities at all', () => {
    expect(computeHoldingStreaks([], history(10))).toEqual([]);
  });
});
