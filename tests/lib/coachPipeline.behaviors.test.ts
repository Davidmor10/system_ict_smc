import { describe, expect, it } from 'vitest';
import {
  detectBehaviors,
  occurrenceTradeIds,
  sortChronologically,
  EXIT_TOLERANCE,
  SIZE_BASELINE_MIN,
  __internals,
} from '../../app/lib/coach-pipeline/behavior/behaviors';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    clerk_id: 'user_test',
    id: `t${seq}`,
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-01T09:00:00Z',
    deleted_at: null,
    date: '2026-08-01',
    time: '10:00',
    symbol: 'NQ',
    direction: 'LONG',
    contracts: 1,
    entry_price: 20000,
    stop_loss: 19980,
    take_profit: 20040,
    exit_price: 20040,
    exits: null,
    rr_planned: 2,
    r_multiple: 2,
    pnl_usd: 100,
    result: 'WIN',
    session: 'london',
    bias: null,
    setup: 'REVERSAL',
    confirmations: ['SMT'],
    emotional_state: 'CALM',
    followed_rules: true, stop_moved: null, management: null,
    notes: '',
    tags: [],
    screenshots: null,
    profile_processed_at: null,
    profile_processed_rev: 0,
    ...overrides,
  };
}

function tally(trades: TradeRow[], kind: string) {
  return detectBehaviors(trades).find(t => t.kind === kind);
}

// ═══════════════════════════════════════════════════════════════════════════
// The denominator — the whole reason this module exists
// ═══════════════════════════════════════════════════════════════════════════

describe('opportunities', () => {
  it('omits a mistake nobody had the chance to make', () => {
    // No exit recorded anywhere, so "closed away from the plan" is not a thing
    // that could have been observed. Reporting 0/0 would read as a clean record.
    const trades = [T({ exit_price: null }), T({ exit_price: null })];
    expect(tally(trades, 'discretionary_exit')).toBeUndefined();
  });

  it('counts a clean trade as an opportunity, not an occurrence', () => {
    const t = tally([T({ exit_price: 20040 })], 'discretionary_exit')!;
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
    expect(t.rate).toBe(0);
  });

  it('ignores OPEN trades entirely — they have not finished happening', () => {
    const trades = [T({ result: 'OPEN' }), T({ result: 'OPEN' })];
    expect(detectBehaviors(trades)).toEqual([]);
  });

  it('ignores soft-deleted trades', () => {
    const trades = [T({ deleted_at: '2026-08-02T00:00:00Z', followed_rules: false, exit_price: 20010 })];
    expect(detectBehaviors(trades)).toEqual([]);
  });

  it('rate is occurrences over opportunities, not over all trades', () => {
    const trades = [
      T({ exit_price: 20010 }),          // discretionary
      T({ exit_price: 20040 }),          // clean
      T({ exit_price: null }),           // not an opportunity
      T({ exit_price: null }),           // not an opportunity
    ];
    const t = tally(trades, 'discretionary_exit')!;
    expect(t.opportunities).toBe(2);
    expect(t.occurrences).toBe(1);
    expect(t.rate).toBe(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// discretionary_exit — judged against the plan, never against the outcome
// ═══════════════════════════════════════════════════════════════════════════

describe('discretionary_exit', () => {
  // entry 20000, stop 19980, target 20040. Planned distance = 40 points.
  const planned = (o: Partial<TradeRow> = {}) =>
    T({ entry_price: 20000, stop_loss: 19980, take_profit: 20040, ...o });

  it('flags an exit taken between the entry and the target', () => {
    const t = tally([planned({ exit_price: 20010 })], 'discretionary_exit')!;
    expect(t.occurrences).toBe(1);
    expect(t.events[0].evidence).toMatchObject({ exit_price: 20010, progress_to_target: 0.25 });
  });

  it('does not flag an exit at the target', () => {
    expect(tally([planned({ exit_price: 20040 })], 'discretionary_exit')!.occurrences).toBe(0);
  });

  it('does not flag an exit at the stop', () => {
    expect(tally([planned({ exit_price: 19980, result: 'LOSS' })], 'discretionary_exit')!.occurrences).toBe(0);
  });

  it('does not flag a few ticks of slippage around the target', () => {
    // Within EXIT_TOLERANCE of the 40-point planned distance.
    const almost = 20040 - 40 * EXIT_TOLERANCE * 0.5;
    expect(tally([planned({ exit_price: almost })], 'discretionary_exit')!.occurrences).toBe(0);
  });

  it('flags a runner beyond the target as reaching it, not as discretion', () => {
    expect(tally([planned({ exit_price: 20080 })], 'discretionary_exit')!.occurrences).toBe(0);
  });

  // The whole point of correction #9: the behaviour is the decision, and the
  // decision is the same whether or not it happened to pay.
  it('flags a profitable discretionary exit exactly like a losing one', () => {
    const won  = tally([planned({ exit_price: 20010, result: 'WIN',  pnl_usd: 50 })], 'discretionary_exit')!;
    const lost = tally([planned({ exit_price: 19990, result: 'LOSS', pnl_usd: -25 })], 'discretionary_exit')!;
    expect(won.occurrences).toBe(1);
    expect(lost.occurrences).toBe(1);
  });

  it('works for shorts', () => {
    const short = T({
      direction: 'SHORT', entry_price: 20000, stop_loss: 20020, take_profit: 19960,
      exit_price: 19990, result: 'WIN',
    });
    expect(tally([short], 'discretionary_exit')!.occurrences).toBe(1);
  });

  // A trade whose R was assumed from its result cannot testify about where it
  // closed — the assumption already decided the answer.
  it('is not an opportunity when the exit was never recorded', () => {
    expect(tally([planned({ exit_price: null })], 'discretionary_exit')).toBeUndefined();
  });

  it('ignores a malformed plan rather than calling it a behaviour', () => {
    // Target on the wrong side of entry for a long.
    expect(tally([planned({ take_profit: 19950, exit_price: 19970 })], 'discretionary_exit')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// An advanced stop is not a discretionary exit
//
// THE REGRESSION. The detector reads the stop set at entry, because that is
// the stop the plan named. A trader who moves their stop up to protect a
// position and is then taken out at the new level closed AT A STOP — one this
// function cannot see, since the level is not recorded. Against the entry
// stop it looks exactly like a mid-trade decision.
//
// Measured on live data before the fix: of ten flagged exits, eight were
// trades the trader had reported advancing their stop on. The behaviour was
// about to be handed a measurement window asking them to stop protecting
// their positions.
// ═══════════════════════════════════════════════════════════════════════════

describe('discretionary_exit vs an advanced stop', () => {
  const planned = (o: Partial<TradeRow> = {}) =>
    T({ entry_price: 20000, stop_loss: 19980, take_profit: 20040, ...o });

  it('does not flag an exit on a trade whose stop was advanced', () => {
    const t = tally([planned({ exit_price: 20010, stop_moved: 'advanced' })], 'discretionary_exit');
    expect(t).toBeUndefined();
  });

  it('drops it from the denominator too, rather than crediting a clean exit', () => {
    // With the level gone, "the advanced stop was hit" and "the stop was
    // advanced and then the position was closed by hand" are the same row.
    // Counting it as an opportunity that stayed clean asserts the first.
    const trades = [
      planned({ exit_price: 20010, stop_moved: 'advanced' }),
      planned({ exit_price: 20010, stop_moved: 'none' }),
    ];
    const t = tally(trades, 'discretionary_exit')!;
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(1);
  });

  it('still flags one where the stop was explicitly not moved', () => {
    expect(tally([planned({ exit_price: 20010, stop_moved: 'none' })], 'discretionary_exit')!.occurrences).toBe(1);
  });

  it('still flags one where the trader never answered', () => {
    // Silence about the stop is not a claim that it moved. The trade stays
    // judgeable, and the entry stop is the only stop there is evidence for.
    expect(tally([planned({ exit_price: 20010, stop_moved: null })], 'discretionary_exit')!.occurrences).toBe(1);
  });

  it('still flags one where the stop was widened', () => {
    // Widening moves the stop AWAY. An exit between entry and target cannot
    // be a widened stop being hit, so the mid-trade decision stands.
    expect(tally([planned({ exit_price: 20010, stop_moved: 'widened' })], 'discretionary_exit')!.occurrences).toBe(1);
  });

  it('keeps a target reached on an advanced stop as a clean opportunity', () => {
    // Nothing ambiguous here: the plan's own target was hit. Advancing the
    // stop on the way is irrelevant, and dropping the trade would shrink the
    // denominator for no reason.
    const t = tally([planned({ exit_price: 20040, stop_moved: 'advanced' })], 'discretionary_exit')!;
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
  });

  it('keeps the entry stop being hit as a clean opportunity', () => {
    const t = tally([planned({ exit_price: 19980, result: 'LOSS', stop_moved: 'advanced' })], 'discretionary_exit')!;
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
  });

  // ── when the level survived, nothing is guessed ──────────────────────────

  it('clears the trade when the exit reached the level the stop moved to', () => {
    // Advanced to 20005, taken out there. A stop was hit; it just was not the
    // one written at entry.
    const t = tally([planned({
      exit_price: 20005,
      stop_moved: null,
      management: [{ kind: 'stop', at: '2026-08-01T10:05:00Z', to: 20005 }],
    } as Partial<TradeRow>)], 'discretionary_exit')!;
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
  });

  it('still flags an exit taken ABOVE the level the stop moved to', () => {
    // THE CASE THE EVENT LOG EXISTS FOR. Advanced to 20005, closed by hand at
    // 20020 — the advanced stop was never reached, so this is a decision, and
    // the record proves it rather than the detector assuming it.
    const t = tally([planned({
      exit_price: 20020,
      stop_moved: 'advanced',
      management: [{ kind: 'stop', at: '2026-08-01T10:05:00Z', to: 20005 }],
    } as Partial<TradeRow>)], 'discretionary_exit')!;
    expect(t.occurrences).toBe(1);
  });

  it('allows the same slippage against the advanced stop as against the planned one', () => {
    const t = tally([planned({
      exit_price: 20005 + 20 * EXIT_TOLERANCE * 0.5,
      stop_moved: 'advanced',
      management: [{ kind: 'stop', at: '2026-08-01T10:05:00Z', to: 20005 }],
    } as Partial<TradeRow>)], 'discretionary_exit')!;
    expect(t.occurrences).toBe(0);
  });

  it('works for shorts', () => {
    const short = T({
      direction: 'SHORT', entry_price: 20000, stop_loss: 20020, take_profit: 19960,
      exit_price: 19990, result: 'WIN', stop_moved: 'advanced',
    });
    expect(tally([short], 'discretionary_exit')).toBeUndefined();
  });

  it('reproduces the live split — eight advanced, two real', () => {
    const trades = [
      ...Array.from({ length: 8 }, () => planned({ exit_price: 20010, stop_moved: 'advanced' })),
      ...Array.from({ length: 2 }, () => planned({ exit_price: 20010, stop_moved: 'none' })),
      ...Array.from({ length: 6 }, () => planned({ exit_price: 20040, stop_moved: 'none' })),
    ];
    const t = tally(trades, 'discretionary_exit')!;
    expect(t.occurrences).toBe(2);
    expect(t.opportunities).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// no_confirmation / rule_violation / size_spike
// ═══════════════════════════════════════════════════════════════════════════

describe('no_confirmation', () => {
  it('flags an empty list and a null list alike, once the field is in use', () => {
    const withEmpty = [T({ confirmations: ['SMT'] }), T({ confirmations: [] })];
    const withNull  = [T({ confirmations: ['SMT'] }), T({ confirmations: null })];
    expect(tally(withEmpty, 'no_confirmation')!.occurrences).toBe(1);
    expect(tally(withNull,  'no_confirmation')!.occurrences).toBe(1);
  });

  it('does not flag a trade with any confirmation logged', () => {
    expect(tally([T({ confirmations: ['SMT'] })], 'no_confirmation')!.occurrences).toBe(0);
  });

  // The guard against the failure that keeps recurring: an unfilled field
  // reading as a discovered habit. Before the trader had ever used the box,
  // every trade is empty for a reason that has nothing to do with trading.
  it('stays silent for a trader who has never used the field', () => {
    const trades = [T({ confirmations: [] }), T({ confirmations: null }), T({ confirmations: [] })];
    expect(tally(trades, 'no_confirmation')).toBeUndefined();
  });

  it('counts only from the first trade that carried a confirmation', () => {
    // Explicit times: adoption is a point in the HISTORY, so the order the
    // detector sees has to be the chronological one, not the array one.
    const trades = [
      T({ time: '09:00', confirmations: [] }),        // before adoption — invisible
      T({ time: '10:00', confirmations: [] }),        // before adoption — invisible
      T({ time: '11:00', confirmations: ['SMT'] }),   // the field enters service
      T({ time: '12:00', confirmations: [] }),        // a real omission
    ];
    const t = tally(trades, 'no_confirmation')!;
    expect(t.opportunities).toBe(2);
    expect(t.occurrences).toBe(1);
  });

  it('every decided trade after adoption is an opportunity', () => {
    expect(tally([T(), T(), T()], 'no_confirmation')!.opportunities).toBe(3);
  });
});

describe('rule_violation', () => {
  it('follows the trader’s own verdict', () => {
    const t = tally([T({ followed_rules: false }), T({ followed_rules: true })], 'rule_violation')!;
    expect(t.occurrences).toBe(1);
    expect(t.opportunities).toBe(2);
  });

  // Counting silence as compliance would inflate the denominator with trades
  // nobody graded and turn the adherence rate into a flattering fiction.
  it('an ungraded trade is not an opportunity', () => {
    expect(tally([T({ followed_rules: null })], 'rule_violation')).toBeUndefined();
  });

  it('the denominator is trades the trader actually graded', () => {
    const trades = [
      T({ followed_rules: false }),
      T({ followed_rules: true }),
      T({ followed_rules: null }),
      T({ followed_rules: null }),
    ];
    const t = tally(trades, 'rule_violation')!;
    expect(t.opportunities).toBe(2);
    expect(t.rate).toBe(0.5);
  });
});

describe('size_spike', () => {
  const base = (n: number) => Array.from({ length: n }, () => T({ contracts: 2 }));

  it('stays silent until a usual size exists', () => {
    // Four priors is below SIZE_BASELINE_MIN, so the fifth trade — however
    // large — has nothing to be unusual against.
    const trades = [...base(SIZE_BASELINE_MIN - 1), T({ contracts: 20 })];
    expect(tally(trades, 'size_spike')).toBeUndefined();
  });

  it('flags size well above the recent median once a baseline exists', () => {
    const trades = [...base(SIZE_BASELINE_MIN), T({ contracts: 6 })];
    const t = tally(trades, 'size_spike')!;
    expect(t.occurrences).toBe(1);
    expect(t.events[0].evidence).toMatchObject({ contracts: 6, usual_contracts: 2, multiple: 3 });
  });

  it('does not flag ordinary size', () => {
    const trades = [...base(SIZE_BASELINE_MIN), T({ contracts: 2 })];
    expect(tally(trades, 'size_spike')!.occurrences).toBe(0);
  });

  it('uses the median so one outlier cannot hide the next', () => {
    // A single 100-lot among 2-lots leaves the median at 2, so the following
    // 6-lot is still caught. A mean would have been dragged to ~18 and missed it.
    const trades = [
      ...base(SIZE_BASELINE_MIN),
      T({ contracts: 100 }),
      T({ contracts: 6 }),
    ];
    expect(tally(trades, 'size_spike')!.occurrences).toBe(2);
  });

  it('median is the true middle for even and odd counts', () => {
    expect(__internals.median([1, 3])).toBe(2);
    expect(__internals.median([1, 2, 100])).toBe(2);
    expect(__internals.median([])).toBe(0);
  });

  // ── one contract is not one unit ─────────────────────────────────────────
  //
  // Three MNQ is a fraction of one NQ. A flat baseline across both makes every
  // switch to the micro read as a size spike, and hides a real one in the
  // full-size contract behind a median the micros inflated.

  it('does not call a switch to the micro a size spike', () => {
    // THE REGRESSION. Six 1-lot NQ trades, then 5 MNQ — a tenth of the
    // notional. Against a flat baseline the median is 1 and the MNQ trade is
    // 5x it, which is what used to be reported.
    const trades = [
      ...Array.from({ length: SIZE_BASELINE_MIN + 1 }, () => T({ symbol: 'NQ', contracts: 1 })),
      T({ symbol: 'MNQ', contracts: 5 }),
    ];
    const t = tally(trades, 'size_spike')!;
    // The sixth NQ trade is judgeable and clean. The MNQ trade has no MNQ
    // history to be unusual against, so it is not judged at all.
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
  });

  it('builds a separate baseline per instrument', () => {
    const trades = [
      ...Array.from({ length: SIZE_BASELINE_MIN }, () => T({ symbol: 'NQ',  contracts: 1 })),
      ...Array.from({ length: SIZE_BASELINE_MIN }, () => T({ symbol: 'MNQ', contracts: 10 })),
      T({ symbol: 'MNQ', contracts: 12 }),   // ordinary for MNQ, 12x the NQ median
      T({ symbol: 'NQ',  contracts: 2 }),    // doubled for NQ, tiny next to MNQ
    ];
    const t = tally(trades, 'size_spike')!;
    expect(t.occurrences).toBe(1);
    expect(t.events[0].evidence).toMatchObject({ symbol: 'NQ', contracts: 2, usual_contracts: 1 });
  });

  it('waits for a new instrument to earn its own baseline', () => {
    // There is no usual size in something traded twice, and borrowing the
    // other instrument's is how the wrong answer got produced.
    const trades = [
      ...Array.from({ length: 20 }, () => T({ symbol: 'NQ', contracts: 1 })),
      T({ symbol: 'ES', contracts: 4 }),
      T({ symbol: 'ES', contracts: 4 }),
    ];
    expect(tally(trades, 'size_spike')!.occurrences).toBe(0);
  });

  it('reads one instrument written two ways as one instrument', () => {
    const trades = [
      ...Array.from({ length: SIZE_BASELINE_MIN }, () => T({ symbol: 'mnq ', contracts: 2 })),
      T({ symbol: 'MNQ', contracts: 6 }),
    ];
    expect(tally(trades, 'size_spike')!.occurrences).toBe(1);
  });

  // ── an absent contract count is not a zero ───────────────────────────────

  it('keeps a trade with no contract count out of the baseline', () => {
    // Pushed as 0, four of these drag a 2-lot median to 0 and every ordinary
    // trade after them becomes a spike.
    const trades = [
      ...Array.from({ length: SIZE_BASELINE_MIN }, () => T({ contracts: 2 })),
      ...Array.from({ length: 4 }, () => T({ contracts: undefined })),
      T({ contracts: 2 }),
    ];
    expect(tally(trades, 'size_spike')!.occurrences).toBe(0);
  });

  it('does not judge a trade that has no contract count of its own', () => {
    const trades = [
      ...Array.from({ length: SIZE_BASELINE_MIN + 1 }, () => T({ contracts: 2 })),
      T({ contracts: undefined }),
    ];
    const t = tally(trades, 'size_spike')!;
    // The sixth 2-lot is the only judgeable trade; the countless one is left
    // out rather than being read as a zero-lot position.
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
  });

  it('treats zero contracts as an absence, not as a position', () => {
    const trades = [
      ...Array.from({ length: SIZE_BASELINE_MIN }, () => T({ contracts: 2 })),
      T({ contracts: 0 }),
      T({ contracts: 6 }),
    ];
    const t = tally(trades, 'size_spike')!;
    expect(t.occurrences).toBe(1);
    expect(t.events[0].evidence).toMatchObject({ usual_contracts: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ordering + plumbing
// ═══════════════════════════════════════════════════════════════════════════

describe('detectBehaviors', () => {
  it('returns the most frequent behaviour first', () => {
    const trades = [
      T({ followed_rules: false, confirmations: ['SMT'] }),
      T({ followed_rules: false, confirmations: ['SMT'] }),
      T({ followed_rules: true,  confirmations: ['SMT'] }),
      T({ followed_rules: true,  confirmations: ['SMT'] }),
    ];
    const out = detectBehaviors(trades);
    expect(out[0].kind).toBe('rule_violation');
    expect(out[0].rate).toBe(0.5);
  });

  it('is deterministic — same input, same output', () => {
    const trades = [T({ followed_rules: false }), T({ confirmations: [] }), T()];
    expect(detectBehaviors(trades)).toEqual(detectBehaviors(trades));
  });

  it('handles an empty history', () => {
    expect(detectBehaviors([])).toEqual([]);
  });

  it('occurrenceTradeIds returns exactly the offending trades', () => {
    const bad = T({ followed_rules: false });
    const good = T({ followed_rules: true });
    const t = tally([bad, good], 'rule_violation')!;
    expect([...occurrenceTradeIds(t)]).toEqual([bad.id]);
  });
});

describe('sortChronologically', () => {
  it('orders by date, then time', () => {
    const a = T({ date: '2026-08-02', time: '09:00' });
    const b = T({ date: '2026-08-01', time: '15:00' });
    const c = T({ date: '2026-08-01', time: '09:00' });
    expect(sortChronologically([a, b, c]).map(t => t.id)).toEqual([c.id, b.id, a.id]);
  });

  it('places untimed trades after timed ones on the same date', () => {
    const timed = T({ date: '2026-08-01', time: '23:00' });
    const untimed = T({ date: '2026-08-01', time: null });
    expect(sortChronologically([untimed, timed]).map(t => t.id)).toEqual([timed.id, untimed.id]);
  });

  it('does not mutate its input', () => {
    const trades = [T({ date: '2026-08-02' }), T({ date: '2026-08-01' })];
    const before = trades.map(t => t.id);
    sortChronologically(trades);
    expect(trades.map(t => t.id)).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// stop_widened — the one management decision the tables cannot reconstruct
//
// Three answers and not two, which is the entire reason this detector can
// exist. Advancing a stop to protect a position and widening it to avoid being
// stopped out are opposite acts; a boolean counts them together and measures
// nothing.
// ═══════════════════════════════════════════════════════════════════════════

describe('stop_widened', () => {
  it('flags only a widened stop', () => {
    const t = tally([
      T({ stop_moved: 'widened' }),
      T({ stop_moved: 'advanced' }),
      T({ stop_moved: 'none' }),
    ], 'stop_widened')!;
    expect(t.opportunities).toBe(3);
    expect(t.occurrences).toBe(1);
  });

  // Advancing is discipline. Counting it as the same act as widening is the
  // failure this detector was designed around.
  it('does not treat advancing the stop as the behaviour', () => {
    expect(tally([T({ stop_moved: 'advanced' })], 'stop_widened')!.occurrences).toBe(0);
  });

  it('an unanswered trade is not an opportunity', () => {
    expect(tally([T({ stop_moved: null })], 'stop_widened')).toBeUndefined();
  });

  it('the denominator is trades the trader actually answered', () => {
    const t = tally([
      T({ stop_moved: 'widened' }),
      T({ stop_moved: 'none' }),
      T({ stop_moved: null }),
      T({ stop_moved: null }),
    ], 'stop_widened')!;
    expect(t.opportunities).toBe(2);
    expect(t.rate).toBe(0.5);
  });

  it('ignores a value that is not one of the three', () => {
    expect(tally([T({ stop_moved: 'maybe' })], 'stop_widened')).toBeUndefined();
  });
});
