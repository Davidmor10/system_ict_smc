import { describe, expect, it } from 'vitest';
import {
  analyzeTriggers,
  bestTrigger,
  fisherExactTwoSided,
  MIN_TOTAL_OCCURRENCES,
  MIN_GROUP_OPPORTUNITIES,
  MIN_LIFT,
} from '../../app/lib/coach-pipeline/behavior/contingency';
import { detectBehaviors } from '../../app/lib/coach-pipeline/behavior/behaviors';
import { buildContexts } from '../../app/lib/coach-pipeline/behavior/context';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Trades are built as a day's sequence so antecedent context (after a loss,
// day P&L) is produced by the real code path rather than hand-stubbed.

let seq = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    clerk_id: 'user_test',
    id: `x${seq}`,
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
    emotional_state: null,
    followed_rules: true,
    notes: '',
    tags: [],
    screenshots: null,
    profile_processed_at: null,
    profile_processed_rev: 0,
    ...overrides,
  };
}

/** A rule-violation trade, and a clean one. Rule violations are used for most
 *  tests because every decided trade is an opportunity, which keeps the
 *  fixtures about the trigger rather than about the detector. */
const bad  = (o: Partial<TradeRow> = {}) => T({ followed_rules: false, ...o });
const good = (o: Partial<TradeRow> = {}) => T({ followed_rules: true,  ...o });

function triggersFor(trades: TradeRow[], kind = 'rule_violation') {
  const tally = detectBehaviors(trades).find(t => t.kind === kind)!;
  return analyzeTriggers(tally, buildContexts(trades));
}

// ═══════════════════════════════════════════════════════════════════════════
// Fisher's exact test — verified against hand-computed tables
// ═══════════════════════════════════════════════════════════════════════════

describe('fisherExactTwoSided', () => {
  // Margins all 2, n = 4. p(a=2) = p(a=0) = 1/6, p(a=1) = 4/6.
  // Two-sided for the observed a=2 sums the tables no likelier than it: 2/6.
  it('matches a hand-computed 2×2', () => {
    expect(fisherExactTwoSided(2, 0, 0, 2)).toBeCloseTo(1 / 3, 10);
  });

  // Margins all 3, n = 6. p(a=3) = p(a=0) = 1/20.
  it('matches a second hand-computed 2×2', () => {
    expect(fisherExactTwoSided(3, 0, 0, 3)).toBeCloseTo(0.1, 10);
  });

  it('returns 1 for a table with no contrast', () => {
    expect(fisherExactTwoSided(5, 5, 5, 5)).toBe(1);
  });

  it('returns 1 for degenerate tables rather than pretending to know', () => {
    expect(fisherExactTwoSided(0, 0, 5, 5)).toBe(1);   // empty row
    expect(fisherExactTwoSided(5, 0, 5, 0)).toBe(1);   // empty column
  });

  it('is symmetric under transposition', () => {
    expect(fisherExactTwoSided(7, 1, 2, 10)).toBeCloseTo(fisherExactTwoSided(1, 7, 10, 2), 12);
  });

  it('stays within [0, 1] on a large table', () => {
    const p = fisherExactTwoSided(40, 10, 12, 38);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('gets smaller as separation gets cleaner', () => {
    expect(fisherExactTwoSided(9, 1, 1, 9)).toBeLessThan(fisherExactTwoSided(7, 3, 3, 7));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Insufficient evidence — the answers that must stay empty
// ═══════════════════════════════════════════════════════════════════════════

describe('insufficient evidence', () => {
  it('says nothing below the repeated-mistake threshold', () => {
    // Two violations is an incident, not a pattern.
    const trades = [
      bad({ time: '09:00' }), bad({ time: '10:00' }),
      good({ time: '11:00' }), good({ time: '12:00' }),
      good({ time: '13:00' }), good({ time: '14:00' }),
    ];
    const tally = detectBehaviors(trades).find(t => t.kind === 'rule_violation')!;
    expect(tally.occurrences).toBeLessThan(MIN_TOTAL_OCCURRENCES);
    expect(triggersFor(trades)).toEqual([]);
  });

  it('says nothing when the behaviour is spread evenly', () => {
    // Half the London trades and half the NY trades. There is no "when".
    const trades = [
      bad({ session: 'london', time: '09:00' }), good({ session: 'london', time: '10:00' }),
      bad({ session: 'london', time: '11:00' }), good({ session: 'london', time: '12:00' }),
      bad({ session: 'nyam', time: '13:00' }),   good({ session: 'nyam', time: '14:00' }),
      bad({ session: 'nyam', time: '15:00' }),   good({ session: 'nyam', time: '16:00' }),
    ];
    expect(triggersFor(trades)).toEqual([]);
  });

  it('ignores a group too small to speak for itself', () => {
    // Three NY trades, all violations — a perfect record on a group below the
    // opportunity floor. Tempting, and meaningless.
    const ny = Array.from({ length: MIN_GROUP_OPPORTUNITIES - 1 }, (_, i) =>
      bad({ session: 'nyam', time: `1${i}:00` }));
    const london = Array.from({ length: 8 }, (_, i) =>
      good({ session: 'london', time: `0${i}:00` }));
    const found = triggersFor([...ny, ...london]).find(t => t.value === 'nyam');
    expect(found).toBeUndefined();
  });

  it('ignores a comparison group too small to compare against', () => {
    // Almost everything is NY, so "it happens in NY" is not information.
    const ny = Array.from({ length: 10 }, (_, i) =>
      (i < 5 ? bad : good)({ session: 'nyam', date: '2026-08-01', time: `0${i}:00` }));
    const other = [good({ session: 'london', time: '20:00' })];
    const found = triggersFor([...ny, ...other]).find(t => t.value === 'nyam');
    expect(found).toBeUndefined();
  });

  it('ignores a difference too small to matter', () => {
    // 50% vs 40% — a real difference in the numbers, noise at this sample size.
    const a = Array.from({ length: 10 }, (_, i) =>
      (i < 5 ? bad : good)({ session: 'nyam', time: `0${i}:00` }));
    const b = Array.from({ length: 10 }, (_, i) =>
      (i < 4 ? bad : good)({ session: 'london', date: '2026-08-02', time: `0${i}:00` }));
    const found = triggersFor([...a, ...b]).find(t => t.value === 'nyam');
    expect(found).toBeUndefined();
  });

  it('bestTrigger returns null rather than the least bad option', () => {
    const trades = [bad({ time: '09:00' }), good({ time: '10:00' })];
    const tally = detectBehaviors(trades).find(t => t.kind === 'rule_violation')!;
    expect(bestTrigger(tally, buildContexts(trades))).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A real trigger
// ═══════════════════════════════════════════════════════════════════════════

describe('a genuine concentration', () => {
  // 8 NY trades, 7 violations. 10 London trades, 1 violation.
  const trades = [
    ...Array.from({ length: 8 }, (_, i) =>
      (i < 7 ? bad : good)({ session: 'nyam', date: '2026-08-03', time: `1${i}:00` })),
    ...Array.from({ length: 10 }, (_, i) =>
      (i < 1 ? bad : good)({ session: 'london', date: '2026-08-04', time: `0${i}:00` })),
  ];

  it('finds the session split', () => {
    const t = triggersFor(trades).find(x => x.dimension === 'session' && x.value === 'nyam')!;
    expect(t).toBeDefined();
    expect(t.withK).toBe(7);
    expect(t.withN).toBe(8);
    expect(t.withoutK).toBe(1);
    expect(t.withoutN).toBe(10);
  });

  it('reports both rates, because one without the other means nothing', () => {
    const t = triggersFor(trades).find(x => x.value === 'nyam')!;
    expect(t.withRate).toBeCloseTo(0.88, 2);
    expect(t.withoutRate).toBeCloseTo(0.1, 2);
    expect(t.lift).toBeCloseTo(0.78, 2);
  });

  it('rates it strong, and survives the multiple-comparison correction', () => {
    const t = triggersFor(trades).find(x => x.value === 'nyam')!;
    expect(t.pValue).toBeLessThan(0.01);
    expect(t.pAdjusted).toBeLessThanOrEqual(0.05);
    expect(t.strength).toBe('strong');
  });

  it('puts the strongest finding first', () => {
    expect(triggersFor(trades)[0].strength).toBe('strong');
  });
});

describe('behavioural triggers', () => {
  it('finds "after a loss" from the sequence, not from a stubbed field', () => {
    // A losing trade, then a violation — five times. Plus clean trades that
    // follow winners, so the comparison group exists.
    const days = [1, 2, 3, 4, 5].map(d => {
      const date = `2026-08-0${d}`;
      return [
        T({ date, time: '09:00', result: 'LOSS', pnl_usd: -50, followed_rules: true }),
        bad({ date, time: '10:00' }),
        good({ date, time: '11:00' }),
        good({ date, time: '12:00' }),
      ];
    }).flat();

    const t = triggersFor(days).find(x => x.dimension === 'prevResult' && x.value === 'LOSS');
    expect(t).toBeDefined();
    expect(t!.withK).toBe(5);
    expect(t!.withN).toBe(5);
    expect(t!.lift).toBeGreaterThan(MIN_LIFT);
  });

  it('prefers a behavioural dimension over a descriptive one on a tie', () => {
    // Constructed so "after a loss" and "on ES" describe exactly the same
    // trades: the behavioural reading is the one worth telling the trader.
    const days = [1, 2, 3, 4, 5].map(d => {
      const date = `2026-08-1${d}`;
      return [
        T({ date, time: '09:00', result: 'LOSS', pnl_usd: -50, symbol: 'NQ' }),
        bad({ date, time: '10:00', symbol: 'ES' }),
        good({ date, time: '11:00', symbol: 'NQ' }),
        good({ date, time: '12:00', symbol: 'NQ' }),
      ];
    }).flat();

    const top = triggersFor(days)[0];
    const sameStrength = triggersFor(days).filter(t => t.strength === top.strength);
    expect(sameStrength.map(t => t.dimension)).toContain('symbol');
    expect(top.dimension).toBe('prevResult');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Guarding against confident nonsense
// ═══════════════════════════════════════════════════════════════════════════

describe('multiple comparisons', () => {
  // Nine dimensions with several values each means something clears p < 0.05
  // by luck on most runs. Raw significance alone would name a trigger nearly
  // every time the system looked at anything.
  it('adjusts p upward by the number of tests performed', () => {
    const trades = [
      ...Array.from({ length: 8 }, (_, i) =>
        (i < 6 ? bad : good)({ session: 'nyam', date: '2026-08-03', time: `1${i}:00`, symbol: 'ES', setup: 'FVG' })),
      ...Array.from({ length: 10 }, (_, i) =>
        (i < 1 ? bad : good)({ session: 'london', date: '2026-08-04', time: `0${i}:00`, symbol: 'NQ', setup: 'BOS' })),
    ];
    const found = triggersFor(trades);
    expect(found.length).toBeGreaterThan(1);
    for (const t of found) {
      expect(t.pAdjusted).toBeGreaterThanOrEqual(t.pValue);
      expect(t.pAdjusted).toBeLessThanOrEqual(1);
    }
  });

  it('never reports strong on a small group, however clean the split', () => {
    // 5 trades, all violations, against 10 clean ones. Perfect separation and
    // still below the sample floor for the top rating.
    const trades = [
      ...Array.from({ length: 5 }, (_, i) => bad({ session: 'asia', date: '2026-08-05', time: `1${i}:00` })),
      ...Array.from({ length: 10 }, (_, i) => good({ session: 'london', date: '2026-08-06', time: `0${i}:00` })),
    ];
    const t = triggersFor(trades).find(x => x.value === 'asia')!;
    expect(t.withN).toBeLessThan(8);
    expect(t.strength).not.toBe('strong');
  });
});

describe('plumbing', () => {
  it('is deterministic', () => {
    const trades = [
      ...Array.from({ length: 8 }, (_, i) => (i < 6 ? bad : good)({ session: 'nyam', date: '2026-08-07', time: `1${i}:00` })),
      ...Array.from({ length: 8 }, (_, i) => good({ session: 'london', date: '2026-08-08', time: `0${i}:00` })),
    ];
    expect(triggersFor(trades)).toEqual(triggersFor(trades));
  });

  it('survives contexts missing for some opportunities', () => {
    const trades = [bad(), good(), bad(), good()];
    const tally = detectBehaviors(trades).find(t => t.kind === 'rule_violation')!;
    expect(() => analyzeTriggers(tally, new Map())).not.toThrow();
    expect(analyzeTriggers(tally, new Map())).toEqual([]);
  });
});
