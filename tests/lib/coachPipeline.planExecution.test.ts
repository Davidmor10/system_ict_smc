// ─────────────────────────────────────────────────────────────────────────────
// The plan against the execution.
//
// Every other claim in this pipeline measures the trader against their own
// baseline — this session versus your other sessions. None of them ever asked
// the question a journal exists for: how much of what you PLANNED do you
// actually take. The number was in every row all along; nothing read the pair.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { computeLoggingHabit, computePlanExecution } from '../../app/lib/coach-pipeline/analyzers/planExecution';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

let n = 0;
function T(over: Partial<TradeRow> = {}): TradeRow {
  n += 1;
  return {
    id: `t${n}`, clerk_id: 'u', date: '2026-08-20', created_at: '2026-08-20T18:00:00Z',
    deleted_at: null, result: 'WIN', rr_planned: 3, r_multiple: 3,
    ...over,
  } as TradeRow;
}

describe('computePlanExecution', () => {
  it('reports what share of the plan actually gets taken', () => {
    // Four 3R plans, each closed at 1.5R — half the plan, taken every time.
    const out = computePlanExecution(Array.from({ length: 4 }, () => T({ r_multiple: 1.5 })));
    expect(out?.capturePct).toBe(50);
    expect(out?.avgPlanned).toBe(3);
    expect(out?.avgRealised).toBe(1.5);
  });

  it('lets the share exceed 100 — a winner that ran past target is not an error', () => {
    const out = computePlanExecution(Array.from({ length: 4 }, () => T({ rr_planned: 2, r_multiple: 3 })));
    expect(out?.capturePct).toBe(150);
  });

  it('counts the winners that closed short of the level they were taken for', () => {
    const out = computePlanExecution([
      T({ result: 'WIN', rr_planned: 3, r_multiple: 1 }),
      T({ result: 'WIN', rr_planned: 3, r_multiple: 3 }),
      T({ result: 'LOSS', rr_planned: 3, r_multiple: -1 }),
      T({ result: 'WIN', rr_planned: 4, r_multiple: 1.2 }),
    ]);
    // The loss is not "short of target" — it is a loss.
    expect(out?.shortOfTarget).toBe(2);
  });

  it('says nothing rather than quoting a rate built on two trades', () => {
    expect(computePlanExecution([T(), T()])).toBeNull();
  });

  it('ignores trades missing either half of the pair, and deleted ones', () => {
    const out = computePlanExecution([
      ...Array.from({ length: 4 }, () => T({ rr_planned: 2, r_multiple: 1 })),
      T({ rr_planned: null }),
      T({ r_multiple: null }),
      T({ deleted_at: '2026-08-21T00:00:00Z' }),
      T({ result: 'OPEN' }),
    ]);
    expect(out?.n).toBe(4);
    expect(out?.capturePct).toBe(50);
  });
});

describe('computeLoggingHabit', () => {
  it('measures the share written down the day they happened', () => {
    const out = computeLoggingHabit([
      T({ date: '2026-08-20', created_at: '2026-08-20T18:00:00Z' }),
      T({ date: '2026-08-20', created_at: '2026-08-20T22:00:00Z' }),
      T({ date: '2026-08-20', created_at: '2026-08-23T09:00:00Z' }),
      T({ date: '2026-08-20', created_at: '2026-08-24T09:00:00Z' }),
    ]);
    expect(out?.sameDayPct).toBe(50);
    expect(out?.maxLagDays).toBe(4);
  });

  it('ignores a row filed under a day that had not happened yet', () => {
    // A back-dated correction, not promptness the trader earned.
    const out = computeLoggingHabit([
      ...Array.from({ length: 3 }, () => T({ created_at: '2026-08-20T18:00:00Z' })),
      T({ date: '2026-09-01', created_at: '2026-08-20T18:00:00Z' }),
    ]);
    expect(out?.maxLagDays).toBe(0);
    expect(out?.sameDayPct).toBe(75);
  });

  it('says nothing when there is too little to measure', () => {
    expect(computeLoggingHabit([T(), T()])).toBeNull();
  });
});
