import { describe, expect, it } from 'vitest';
import {
  buildContexts,
  dimensionValue,
  CONTEXT_DIMENSIONS,
  DIMENSION_LABELS,
  __internals,
} from '../../app/lib/coach-pipeline/behavior/context';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

let seq = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    clerk_id: 'user_test',
    id: `c${seq}`,
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
    r_multiple: 1,
    pnl_usd: 50,
    result: 'WIN',
    session: 'london',
    bias: null,
    setup: 'REVERSAL',
    confirmations: ['SMT'],
    emotional_state: null,
    followed_rules: true, stop_moved: null,
    notes: '',
    tags: [],
    screenshots: null,
    profile_processed_at: null,
    profile_processed_rev: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Antecedent state — where behavioural causes hide
// ═══════════════════════════════════════════════════════════════════════════

describe('prevResult', () => {
  it('the first trade of a day has no predecessor', () => {
    const a = T({ time: '09:00' });
    const ctx = buildContexts([a]).get(a.id)!;
    expect(ctx.prevResult).toBe('none');
  });

  it('carries the previous trade’s result forward', () => {
    const a = T({ time: '09:00', result: 'LOSS', pnl_usd: -40 });
    const b = T({ time: '10:00' });
    const ctx = buildContexts([a, b]).get(b.id)!;
    expect(ctx.prevResult).toBe('LOSS');
  });

  it('a break-even predecessor is not a loss', () => {
    const a = T({ time: '09:00', result: 'BE', pnl_usd: 0 });
    const b = T({ time: '10:00' });
    const ctx = buildContexts([a, b]).get(b.id)!;
    expect(ctx.prevResult).toBe('BE');
  });

  // Yesterday's loss is part of the trader's week, not what they carried into
  // this morning's first trade. Smearing it across the gap would corrupt every
  // "after a loss" finding.
  it('resets across the day boundary', () => {
    const yesterday = T({ date: '2026-08-01', time: '15:00', result: 'LOSS', pnl_usd: -40 });
    const today     = T({ date: '2026-08-02', time: '09:00' });
    const ctx = buildContexts([yesterday, today]).get(today.id)!;
    expect(ctx.prevResult).toBe('none');
    expect(ctx.nthOfDay).toBe('first');
    expect(ctx.dayPnlBefore).toBe('flat');
  });
});

describe('nthOfDay', () => {
  it('marks only the first trade of each day', () => {
    const a = T({ date: '2026-08-01', time: '09:00' });
    const b = T({ date: '2026-08-01', time: '10:00' });
    const c = T({ date: '2026-08-02', time: '09:00' });
    const m = buildContexts([a, b, c]);
    expect(m.get(a.id)!.nthOfDay).toBe('first');
    expect(m.get(b.id)!.nthOfDay).toBe('later');
    expect(m.get(c.id)!.nthOfDay).toBe('first');
  });
});

describe('dayPnlBefore', () => {
  it('is flat before anything has been decided', () => {
    const a = T({ time: '09:00' });
    expect(buildContexts([a]).get(a.id)!.dayPnlBefore).toBe('flat');
  });

  it('reflects the running total, not the previous trade alone', () => {
    // −100 then +40: the previous trade was a winner, but the day is still red.
    const a = T({ time: '09:00', result: 'LOSS', pnl_usd: -100 });
    const b = T({ time: '10:00', result: 'WIN',  pnl_usd: 40 });
    const c = T({ time: '11:00' });
    const ctx = buildContexts([a, b, c]).get(c.id)!;
    expect(ctx.prevResult).toBe('WIN');
    expect(ctx.dayPnlBefore).toBe('down');
  });

  it('goes up once the day is net positive', () => {
    const a = T({ time: '09:00', result: 'WIN', pnl_usd: 100 });
    const b = T({ time: '10:00' });
    expect(buildContexts([a, b]).get(b.id)!.dayPnlBefore).toBe('up');
  });

  it('treats a scratch day as flat', () => {
    const a = T({ time: '09:00', result: 'BE', pnl_usd: 0 });
    const b = T({ time: '10:00' });
    expect(buildContexts([a, b]).get(b.id)!.dayPnlBefore).toBe('flat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Standing facts
// ═══════════════════════════════════════════════════════════════════════════

describe('hourBucket', () => {
  it('buckets to the hour and pads', () => {
    expect(__internals.hourBucketOf('09:47')).toBe('09:00');
    expect(__internals.hourBucketOf('9:05')).toBe('09:00');
    expect(__internals.hourBucketOf('16:59')).toBe('16:00');
  });

  it('is unknown for missing or malformed times', () => {
    expect(__internals.hourBucketOf(null)).toBe('unknown');
    expect(__internals.hourBucketOf('')).toBe('unknown');
    expect(__internals.hourBucketOf('nonsense')).toBe('unknown');
    expect(__internals.hourBucketOf('44:00')).toBe('unknown');
  });
});

describe('standing facts', () => {
  it('falls back to unknown rather than dropping the trade', () => {
    const a = T({ session: null, setup: null, direction: '', time: null });
    const ctx = buildContexts([a]).get(a.id)!;
    expect(ctx.session).toBe('unknown');
    expect(ctx.setup).toBe('unknown');
    expect(ctx.direction).toBe('unknown');
    expect(ctx.hourBucket).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shape + plumbing
// ═══════════════════════════════════════════════════════════════════════════

describe('buildContexts', () => {
  it('skips undecided and deleted trades', () => {
    const open = T({ result: 'OPEN' });
    const gone = T({ deleted_at: '2026-08-02T00:00:00Z' });
    const live = T();
    const m = buildContexts([open, gone, live]);
    expect([...m.keys()]).toEqual([live.id]);
  });

  it('is order-independent — input shuffling does not change the answer', () => {
    const a = T({ time: '09:00', result: 'LOSS', pnl_usd: -40 });
    const b = T({ time: '10:00' });
    const forward  = buildContexts([a, b]).get(b.id);
    const reversed = buildContexts([b, a]).get(b.id);
    expect(forward).toEqual(reversed);
  });

  it('handles an empty history', () => {
    expect(buildContexts([]).size).toBe(0);
  });
});

describe('dimensions', () => {
  it('every declared dimension is readable off a context', () => {
    const a = T();
    const ctx = buildContexts([a]).get(a.id)!;
    for (const dim of CONTEXT_DIMENSIONS) {
      expect(typeof dimensionValue(ctx, dim)).toBe('string');
      expect(dimensionValue(ctx, dim).length).toBeGreaterThan(0);
    }
  });

  it('every dimension has a label to show the trader', () => {
    for (const dim of CONTEXT_DIMENSIONS) {
      expect(DIMENSION_LABELS[dim]).toBeTruthy();
    }
  });

  // Behavioural dimensions are listed first so that when two explain the data
  // equally well, the one that suggests a cause wins over the one that just
  // describes the trade.
  it('lists behavioural dimensions before descriptive ones', () => {
    const behavioural = ['prevResult', 'dayPnlBefore', 'nthOfDay'];
    expect([...CONTEXT_DIMENSIONS.slice(0, 3)]).toEqual(behavioural);
  });
});
