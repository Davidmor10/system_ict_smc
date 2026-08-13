import { describe, expect, it } from 'vitest';
import { computeStatistical, shiftDate, __internals } from '../../app/lib/coach-pipeline/analyzers/statistical';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

// ── Fixture builder ─────────────────────────────────────────────────────────

let idCounter = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  idCounter += 1;
  return {
    clerk_id:               'user_test',
    id:                     `t${idCounter}`,
    created_at:             '2026-08-01T10:00:00Z',
    updated_at:             '2026-08-01T10:00:00Z',
    deleted_at:             null,
    date:                   '2026-08-01',
    time:                   '10:00',
    symbol:                 'ES',
    direction:              'LONG',
    contracts:              1,
    entry_price:            5000,
    stop_loss:              4990,
    take_profit:            5020,
    exit_price:             5020,
    exits:                  null,
    rr_planned:             2,
    r_multiple:             1,
    pnl_usd:                500,
    result:                 'WIN',
    session:                'nyam',
    bias:                   null,
    setup:                  'SMT',
    confirmations:          null,
    emotional_state:        null,
    followed_rules:         true, stop_moved: null,
    notes:                  '',
    tags:                   [],
    screenshots:            null,
    profile_processed_at:   null,
    profile_processed_rev:  0,
    ...overrides,
  };
}

// ── shiftDate ──────────────────────────────────────────────────────────────
describe('shiftDate', () => {
  it('subtracts days correctly', () => {
    expect(shiftDate('2026-08-15', 7)).toBe('2026-08-08');
  });
  it('crosses month boundary', () => {
    expect(shiftDate('2026-08-05', 10)).toBe('2026-07-26');
  });
  it('crosses year boundary', () => {
    expect(shiftDate('2026-01-05', 10)).toBe('2025-12-26');
  });
  it('zero is same day', () => {
    expect(shiftDate('2026-08-15', 0)).toBe('2026-08-15');
  });
});

// ── Empty / cold-start ─────────────────────────────────────────────────────
describe('computeStatistical — empty input', () => {
  it('returns {n:0} when no trades', () => {
    expect(computeStatistical([])).toEqual({ n: 0 });
  });

  it('returns {n:0} when only OPEN trades', () => {
    const trades = [T({ result: 'OPEN' }), T({ result: 'OPEN' })];
    expect(computeStatistical(trades)).toEqual({ n: 0 });
  });

  it('ignores soft-deleted trades', () => {
    const trades = [T({ result: 'WIN', deleted_at: '2026-08-01T11:00:00Z' })];
    expect(computeStatistical(trades)).toEqual({ n: 0 });
  });
});

// ── Top-level aggregates ───────────────────────────────────────────────────
describe('computeStatistical — top-level aggregates', () => {
  const today = '2026-08-15';

  it('computes win rate exactly', () => {
    const trades = [
      T({ result: 'WIN', r_multiple: 1 }),
      T({ result: 'WIN', r_multiple: 2 }),
      T({ result: 'LOSS', r_multiple: -1 }),
    ];
    const s = computeStatistical(trades, { today });
    expect(s.n).toBe(3);
    expect(s.wr).toBe(0.67);
  });

  it('avg_r includes losses and BE', () => {
    const trades = [
      T({ result: 'WIN',  r_multiple: 2 }),
      T({ result: 'LOSS', r_multiple: -1 }),
      T({ result: 'BE',   r_multiple: 0 }),
    ];
    const s = computeStatistical(trades, { today });
    expect(s.avg_r).toBeCloseTo(0.33, 2);
  });

  it('profit factor = gross win $ / gross loss $', () => {
    const trades = [
      T({ result: 'WIN',  pnl_usd:  500 }),
      T({ result: 'WIN',  pnl_usd:  300 }),
      T({ result: 'LOSS', pnl_usd: -200 }),
    ];
    const s = computeStatistical(trades, { today });
    expect(s.pf).toBe(4);   // 800 / 200
  });

  it('profit factor is 0 when no losses (no divide-by-zero)', () => {
    const trades = [T({ result: 'WIN', pnl_usd: 500 })];
    const s = computeStatistical(trades, { today });
    expect(s.pf).toBe(0);
  });

  it('expectancy in USD is integer', () => {
    const trades = [
      T({ result: 'WIN',  pnl_usd: 100 }),
      T({ result: 'LOSS', pnl_usd: -33 }),
    ];
    const s = computeStatistical(trades, { today });
    expect(s.exp_usd).toBe(Math.round(67 / 2));   // 34
  });

  it('BE does not count as a win even with r_multiple > 0 quirk', () => {
    const trades = [
      T({ result: 'BE',  r_multiple: 0.01 }),
      T({ result: 'WIN', r_multiple: 1 }),
    ];
    const s = computeStatistical(trades, { today });
    expect(s.wr).toBe(0.5);
  });
});

// ── Drawdown ───────────────────────────────────────────────────────────────
describe('maxDrawdownUsd', () => {
  const today = '2026-08-15';

  it('is 0 when only wins', () => {
    const trades = [
      T({ result: 'WIN', pnl_usd: 100, date: '2026-08-01' }),
      T({ result: 'WIN', pnl_usd: 200, date: '2026-08-02' }),
    ];
    expect(computeStatistical(trades, { today }).max_dd_usd).toBe(0);
  });

  it('captures peak-to-trough dip', () => {
    const trades = [
      T({ result: 'WIN',  pnl_usd:  500, date: '2026-08-01' }),   // cum 500 (peak)
      T({ result: 'LOSS', pnl_usd: -200, date: '2026-08-02' }),   // cum 300, dd -200
      T({ result: 'LOSS', pnl_usd: -400, date: '2026-08-03' }),   // cum -100, dd -600
      T({ result: 'WIN',  pnl_usd:  300, date: '2026-08-04' }),   // cum 200 (recovering)
    ];
    expect(computeStatistical(trades, { today }).max_dd_usd).toBe(-600);
  });
});

// ── Current streak ─────────────────────────────────────────────────────────
describe('currentStreak', () => {
  const today = '2026-08-15';
  const mkOn = (d: string, r: 'WIN' | 'LOSS' | 'BE') =>
    T({ date: d, result: r, r_multiple: r === 'WIN' ? 1 : r === 'LOSS' ? -1 : 0, pnl_usd: r === 'WIN' ? 100 : r === 'LOSS' ? -100 : 0 });

  it('positive number for consecutive wins', () => {
    const trades = [
      mkOn('2026-08-01', 'LOSS'),
      mkOn('2026-08-02', 'WIN'),
      mkOn('2026-08-03', 'WIN'),
      mkOn('2026-08-04', 'WIN'),
    ];
    expect(computeStatistical(trades, { today }).streak_now).toBe(3);
  });

  it('negative number for consecutive losses', () => {
    const trades = [
      mkOn('2026-08-01', 'WIN'),
      mkOn('2026-08-02', 'LOSS'),
      mkOn('2026-08-03', 'LOSS'),
    ];
    expect(computeStatistical(trades, { today }).streak_now).toBe(-2);
  });

  it('BE breaks the streak', () => {
    const trades = [
      mkOn('2026-08-01', 'WIN'),
      mkOn('2026-08-02', 'BE'),
    ];
    expect(computeStatistical(trades, { today }).streak_now).toBe(0);
  });
});

// ── Bucketing rules ────────────────────────────────────────────────────────
describe('by_session — only sessions with n >= 5', () => {
  const today = '2026-08-15';

  it('omits sessions with fewer than 5 trades', () => {
    const trades = [
      ...Array.from({ length: 6 }, () => T({ session: 'london' })),
      T({ session: 'nyam' }),    // only 1 — must be excluded
    ];
    const s = computeStatistical(trades, { today });
    expect(s.by_session).toBeDefined();
    expect(Object.keys(s.by_session!)).toEqual(['london']);
  });

  it('is undefined when NO session has 5+ trades', () => {
    const trades = [T({ session: 'nyam' }), T({ session: 'nypm' })];
    expect(computeStatistical(trades, { today }).by_session).toBeUndefined();
  });
});

describe('by_setup — top 5 by sample size', () => {
  const today = '2026-08-15';

  it('caps at 5 setups', () => {
    const trades: TradeRow[] = [];
    for (let i = 0; i < 7; i += 1) {
      // Each setup gets a different n so ordering is deterministic
      for (let k = 0; k <= i; k += 1) trades.push(T({ setup: `setup_${i}` }));
    }
    const s = computeStatistical(trades, { today });
    expect(s.by_setup).toBeDefined();
    expect(Object.keys(s.by_setup!).length).toBeLessThanOrEqual(5);
  });

  it('picks the ones with highest n', () => {
    const trades = [
      ...Array.from({ length: 10 }, () => T({ setup: 'big'   })),
      ...Array.from({ length: 5  }, () => T({ setup: 'mid'   })),
      ...Array.from({ length: 1  }, () => T({ setup: 'small' })),
    ];
    const s = computeStatistical(trades, { today });
    const keys = Object.keys(s.by_setup!);
    expect(keys[0]).toBe('big');
    expect(keys).toContain('mid');
  });
});

describe('by_symbol — top 3', () => {
  const today = '2026-08-15';

  it('caps at 3 symbols', () => {
    const trades = [
      ...Array.from({ length: 4 }, () => T({ symbol: 'A' })),
      ...Array.from({ length: 3 }, () => T({ symbol: 'B' })),
      ...Array.from({ length: 2 }, () => T({ symbol: 'C' })),
      ...Array.from({ length: 1 }, () => T({ symbol: 'D' })),
    ];
    const s = computeStatistical(trades, { today });
    expect(Object.keys(s.by_symbol!).length).toBe(3);
    expect(s.by_symbol!.A).toBeDefined();
    expect(s.by_symbol!.D).toBeUndefined();
  });
});

// ── last_7d ────────────────────────────────────────────────────────────────
describe('last_7d window + trend', () => {
  const today = '2026-08-15';

  it('is undefined when nothing in the last 7 days', () => {
    const trades = [T({ date: '2026-07-01' })];
    expect(computeStatistical(trades, { today }).last_7d).toBeUndefined();
  });

  it('flat trend when last_7d ~= prev_7d avg_r', () => {
    const trades: TradeRow[] = [
      T({ date: '2026-08-01', r_multiple: 1, result: 'WIN' }),
      T({ date: '2026-08-02', r_multiple: 1, result: 'WIN' }),
      T({ date: '2026-08-10', r_multiple: 1, result: 'WIN' }),
      T({ date: '2026-08-11', r_multiple: 1, result: 'WIN' }),
    ];
    expect(computeStatistical(trades, { today }).last_7d?.trend).toBe('flat');
  });

  it('up trend when current window is > +0.1R better', () => {
    // prev window: 2026-08-02 .. 2026-08-08. last window: 2026-08-09 .. 2026-08-15.
    const trades: TradeRow[] = [
      T({ date: '2026-08-03', r_multiple: 0, result: 'BE' }),      // prev window: 0R
      T({ date: '2026-08-10', r_multiple: 2, result: 'WIN' }),     // last window: +2R
    ];
    expect(computeStatistical(trades, { today }).last_7d?.trend).toBe('up');
  });

  it('down trend when current window is < -0.1R worse', () => {
    const trades: TradeRow[] = [
      T({ date: '2026-08-03', r_multiple: 2, result: 'WIN' }),     // prev window: +2R
      T({ date: '2026-08-10', r_multiple: -1, result: 'LOSS' }),   // last window: -1R
    ];
    expect(computeStatistical(trades, { today }).last_7d?.trend).toBe('down');
  });
});

// ── trendOf internal ───────────────────────────────────────────────────────
describe('trendOf', () => {
  it('handles nulls as flat', () => {
    expect(__internals.trendOf(null, 1)).toBe('flat');
    expect(__internals.trendOf(1, null)).toBe('flat');
    expect(__internals.trendOf(null, null)).toBe('flat');
  });
  it('respects the 0.1R threshold', () => {
    expect(__internals.trendOf(0.05, 0)).toBe('flat');
    expect(__internals.trendOf(0.15, 0)).toBe('up');
    expect(__internals.trendOf(-0.15, 0)).toBe('down');
  });
});

// ── Realistic snapshot ─────────────────────────────────────────────────────
describe('realistic profile of a mid-tier trader', () => {
  const today = '2026-08-15';

  it('produces a full, sensible Statistical blob', () => {
    const trades: TradeRow[] = [];
    // 20 london SMT wins, 5 nyam OB losses
    for (let i = 0; i < 20; i += 1) {
      trades.push(T({
        date: `2026-07-${String(10 + (i % 15)).padStart(2, '0')}`,
        session: 'london', setup: 'SMT', symbol: 'ES',
        result: 'WIN', r_multiple: 1.5, pnl_usd: 750,
      }));
    }
    for (let i = 0; i < 5; i += 1) {
      trades.push(T({
        date: `2026-08-${String(5 + i).padStart(2, '0')}`,
        session: 'nyam', setup: 'OB', symbol: 'NQ',
        result: 'LOSS', r_multiple: -1, pnl_usd: -500,
      }));
    }

    const s = computeStatistical(trades, { today });
    expect(s.n).toBe(25);
    expect(s.wr).toBe(0.8);
    expect(s.avg_r).toBeCloseTo(1);
    expect(s.pf).toBe(6);   // 20*750=15000 / 5*500=2500
    expect(s.exp_usd).toBe(500);
    expect(s.by_session?.london?.n).toBe(20);
    expect(s.by_session?.nyam?.n).toBe(5);           // n>=5 rule includes exactly 5
  });

  it('includes a session with exactly n=5', () => {
    const trades: TradeRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      trades.push(T({ session: 'nyam', result: 'LOSS', r_multiple: -1, pnl_usd: -100 }));
    }
    const s = computeStatistical(trades, { today });
    expect(s.by_session?.nyam?.n).toBe(5);
  });
});
