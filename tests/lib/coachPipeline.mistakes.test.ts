import { describe, expect, it } from 'vitest';
import {
  detectMistakes,
  eventTradeIds,
  sortChronologically,
  EARLY_EXIT_CAPTURE,
  SIZE_BASELINE_MIN,
  __internals,
} from '../../app/lib/coach-pipeline/behavior/mistakes';
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
    followed_rules: true,
    notes: '',
    tags: [],
    screenshots: null,
    profile_processed_at: null,
    profile_processed_rev: 0,
    ...overrides,
  };
}

function tally(trades: TradeRow[], kind: string) {
  return detectMistakes(trades).find(t => t.kind === kind);
}

// ═══════════════════════════════════════════════════════════════════════════
// The denominator — the whole reason this module exists
// ═══════════════════════════════════════════════════════════════════════════

describe('opportunities', () => {
  it('omits a mistake nobody had the chance to make', () => {
    // No target set anywhere, so "exited before target" is not a thing that
    // could have happened. Reporting 0/0 would read as a clean record.
    const trades = [T({ take_profit: null, rr_planned: null }), T({ take_profit: null, rr_planned: null })];
    expect(tally(trades, 'early_exit')).toBeUndefined();
  });

  it('counts a clean trade as an opportunity, not an occurrence', () => {
    const t = tally([T()], 'early_exit')!;
    expect(t.opportunities).toBe(1);
    expect(t.occurrences).toBe(0);
    expect(t.rate).toBe(0);
  });

  it('ignores OPEN trades entirely — they have not finished happening', () => {
    const trades = [T({ result: 'OPEN' }), T({ result: 'OPEN' })];
    expect(detectMistakes(trades)).toEqual([]);
  });

  it('ignores soft-deleted trades', () => {
    const trades = [T({ deleted_at: '2026-08-02T00:00:00Z', followed_rules: false })];
    expect(detectMistakes(trades)).toEqual([]);
  });

  it('rate is occurrences over opportunities, not over all trades', () => {
    const trades = [
      T({ rr_planned: 2, r_multiple: 0.5 }),               // early exit
      T({ rr_planned: 2, r_multiple: 2 }),                 // clean
      T({ take_profit: null, rr_planned: null }),          // not an opportunity
      T({ take_profit: null, rr_planned: null }),          // not an opportunity
    ];
    const t = tally(trades, 'early_exit')!;
    expect(t.opportunities).toBe(2);
    expect(t.occurrences).toBe(1);
    expect(t.rate).toBe(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// early_exit
// ═══════════════════════════════════════════════════════════════════════════

describe('early_exit', () => {
  it('flags a win that banked well short of its plan', () => {
    const t = tally([T({ rr_planned: 3, r_multiple: 0.8 })], 'early_exit')!;
    expect(t.occurrences).toBe(1);
    expect(t.events[0].evidence).toMatchObject({ planned_r: 3, actual_r: 0.8 });
  });

  it('does not flag a win that reached its plan', () => {
    expect(tally([T({ rr_planned: 2, r_multiple: 2 })], 'early_exit')!.occurrences).toBe(0);
  });

  it('does not flag a win just under target — that is noise, not a decision', () => {
    // 0.7 of a 2R plan is above the 0.6 threshold.
    expect(tally([T({ rr_planned: 2, r_multiple: 1.4 })], 'early_exit')!.occurrences).toBe(0);
  });

  it('is governed by the documented threshold', () => {
    const planned = 2;
    const justUnder = planned * EARLY_EXIT_CAPTURE - 0.01;
    expect(tally([T({ rr_planned: planned, r_multiple: justUnder })], 'early_exit')!.occurrences).toBe(1);
  });

  // Exiting a loser early is risk management. Calling it a mistake would
  // punish the one reflex we want traders to keep.
  it('never flags a loss', () => {
    expect(tally([T({ result: 'LOSS', rr_planned: 2, r_multiple: -0.3, pnl_usd: -30 })], 'early_exit')!.occurrences).toBe(0);
  });

  // A scratch on a trade that never moved is indistinguishable from a
  // premature exit without maximum-favourable-excursion data we don't store.
  it('never flags a break-even scratch', () => {
    expect(tally([T({ result: 'BE', rr_planned: 2, r_multiple: 0, pnl_usd: 0 })], 'early_exit')!.occurrences).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// no_confirmation / rule_violation / size_spike
// ═══════════════════════════════════════════════════════════════════════════

describe('no_confirmation', () => {
  it('flags an empty list and a null list alike', () => {
    expect(tally([T({ confirmations: [] })], 'no_confirmation')!.occurrences).toBe(1);
    expect(tally([T({ confirmations: null })], 'no_confirmation')!.occurrences).toBe(1);
  });

  it('does not flag a trade with any confirmation logged', () => {
    expect(tally([T({ confirmations: ['SMT'] })], 'no_confirmation')!.occurrences).toBe(0);
  });

  it('every decided trade is an opportunity', () => {
    expect(tally([T(), T(), T()], 'no_confirmation')!.opportunities).toBe(3);
  });
});

describe('rule_violation', () => {
  it('follows the trader’s own checkbox', () => {
    const t = tally([T({ followed_rules: false }), T({ followed_rules: true })], 'rule_violation')!;
    expect(t.occurrences).toBe(1);
    expect(t.opportunities).toBe(2);
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
});

// ═══════════════════════════════════════════════════════════════════════════
// Ordering + plumbing
// ═══════════════════════════════════════════════════════════════════════════

describe('detectMistakes', () => {
  it('returns the most frequent behaviour first', () => {
    const trades = [
      T({ followed_rules: false, confirmations: ['SMT'] }),
      T({ followed_rules: false, confirmations: ['SMT'] }),
      T({ followed_rules: true,  confirmations: ['SMT'] }),
      T({ followed_rules: true,  confirmations: ['SMT'] }),
    ];
    const out = detectMistakes(trades);
    expect(out[0].kind).toBe('rule_violation');
    expect(out[0].rate).toBe(0.5);
  });

  it('is deterministic — same input, same output', () => {
    const trades = [T({ followed_rules: false }), T({ confirmations: [] }), T()];
    expect(detectMistakes(trades)).toEqual(detectMistakes(trades));
  });

  it('handles an empty history', () => {
    expect(detectMistakes([])).toEqual([]);
  });

  it('eventTradeIds returns exactly the offending trades', () => {
    const bad = T({ followed_rules: false });
    const good = T({ followed_rules: true });
    const t = tally([bad, good], 'rule_violation')!;
    expect([...eventTradeIds(t)]).toEqual([bad.id]);
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
