// ─────────────────────────────────────────────────────────────────────────────
// The journal's headline numbers.
//
// Every one of these rests on the realized exit price, which the journal did
// not collect until this week — so the risk here is the one that has bitten
// repeatedly: a statistic that silently falls back to the PLAN and reports it
// as the outcome. The first describe block is about exactly that.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  equityCurve, rDistribution, expectancy, streaks, planVsExecution, completeness,
} from '../../app/lib/analytics/journalStats';
import { makeTrade } from '../helpers/trade';
import type { TradeEntry } from '../../app/lib/journal';

/** entry 100, stop 90, target 130 → a 3R plan, 10 points of risk. */
const T = (o: Partial<TradeEntry> = {}): TradeEntry =>
  makeTrade({ entry: 100, stop: 90, target: 130, contracts: 1, ...o });

/** A trade closed at a real price, with the R it actually returned. */
const closedAt = (price: number, r: number, result: TradeEntry['result'], o: Partial<TradeEntry> = {}) =>
  T({ result, exits: [{ price, contracts: 1 }], tradeR: r, pnlUsd: r * 100, ...o });

describe('measured beats assumed', () => {
  // The failure this whole file is exposed to: a 3R plan closed by hand at
  // +0.4R must count as 0.4, not 3.
  it('uses the recorded R, not the plan, when the trade was measured', () => {
    const e = expectancy([closedAt(112, 0.4, 'WIN')]);
    expect(e.expectancyR).toBe(0.4);
    expect(e.avgWinR).toBe(0.4);
  });

  it('falls back to the plan only when nothing was recorded', () => {
    const e = expectancy([T({ result: 'WIN' })]);
    expect(e.avgWinR).toBe(3);      // the plan, which is all there is
  });
});

describe('equity curve', () => {
  const trades = [
    closedAt(130,  3, 'WIN',  { dateISO: '2026-08-01' }),
    closedAt(90,  -1, 'LOSS', { dateISO: '2026-08-02' }),
    closedAt(90,  -1, 'LOSS', { dateISO: '2026-08-03' }),
    closedAt(120,  2, 'WIN',  { dateISO: '2026-08-04' }),
  ];

  it('accumulates oldest first, whatever order it was handed', () => {
    const c = equityCurve([...trades].reverse());
    expect(c.points.map(p => p.r)).toEqual([3, 2, 1, 3]);
    expect(c.finalR).toBe(3);
  });

  // Measured from the running peak, not from zero. A trader up 3R who falls to
  // 1R has had a 2R drawdown even though they are still up — and that fall is
  // the one that decides whether they are still trading.
  it('measures drawdown from the peak, not from the start', () => {
    expect(equityCurve(trades).maxDrawdownR).toBe(2);
  });

  it('is empty for a history with nothing closed', () => {
    const c = equityCurve([T({ result: 'OPEN' })]);
    expect(c.points).toEqual([]);
    expect(c.maxDrawdownR).toBe(0);
  });
});

describe('distribution', () => {
  it('buckets by realized R', () => {
    const d = rDistribution([
      closedAt(130,  3.5, 'WIN'),
      closedAt(115,  1.5, 'WIN'),
      closedAt(90,  -1,   'LOSS'),
      closedAt(80,  -2.5, 'LOSS'),
    ]);
    const byLabel = Object.fromEntries(d.map(b => [b.label, b.count]));
    expect(byLabel['מעל 3R']).toBe(1);
    expect(byLabel['1R עד 2R']).toBe(1);
    expect(byLabel['מתחת ל-2R−']).toBe(1);
    // −1 sits in [−1, 0), not in [−2, −1).
    expect(byLabel['1R− עד 0']).toBe(1);
  });
});

describe('expectancy', () => {
  it('decomposes rather than reporting one number', () => {
    const e = expectancy([
      closedAt(130, 3, 'WIN'), closedAt(130, 3, 'WIN'),
      closedAt(90, -1, 'LOSS'), closedAt(90, -1, 'LOSS'),
    ]);
    expect(e.winRate).toBe(0.5);
    expect(e.avgWinR).toBe(3);
    expect(e.avgLossR).toBe(-1);
    expect(e.expectancyR).toBe(1);
  });

  it('leaves breakevens out of the win rate but inside the average', () => {
    const e = expectancy([closedAt(130, 3, 'WIN'), closedAt(100, 0, 'BE')]);
    expect(e.winRate).toBe(1);        // 1 win, 0 losses
    expect(e.expectancyR).toBe(1.5);  // (3 + 0) / 2
  });
});

describe('streaks', () => {
  it('counts the current run and the worst of each side', () => {
    const s = streaks([
      closedAt(130, 3, 'WIN',  { dateISO: '2026-08-01' }),
      closedAt(130, 3, 'WIN',  { dateISO: '2026-08-02' }),
      closedAt(90, -1, 'LOSS', { dateISO: '2026-08-03' }),
      closedAt(90, -1, 'LOSS', { dateISO: '2026-08-04' }),
      closedAt(90, -1, 'LOSS', { dateISO: '2026-08-05' }),
    ]);
    expect(s.current).toBe(-3);
    expect(s.maxWin).toBe(2);
    expect(s.maxLoss).toBe(3);
  });

  // Neither a win nor a loss. Counting it as either is a claim about
  // something that didn't happen.
  it('breaks a streak on a breakeven rather than extending it', () => {
    const s = streaks([
      closedAt(130, 3, 'WIN', { dateISO: '2026-08-01' }),
      closedAt(100, 0, 'BE',  { dateISO: '2026-08-02' }),
      closedAt(130, 3, 'WIN', { dateISO: '2026-08-03' }),
    ]);
    expect(s.current).toBe(1);
    expect(s.maxWin).toBe(1);
  });
});

describe('plan vs execution', () => {
  // The statistic that could not exist before the exit price was collected.
  it('shows the gap between what was aimed for and what was taken', () => {
    const p = planVsExecution([
      closedAt(112, 1.2, 'WIN'),   // 3R plan, 1.2R taken
      closedAt(118, 1.8, 'WIN'),   // 3R plan, 1.8R taken
    ]);
    expect(p.avgPlannedRR).toBe(3);
    expect(p.avgRealizedR).toBe(1.5);
    expect(p.captureRate).toBe(0.5);
  });

  // A loss taken properly at the stop captures −1 of a +3 plan. Folding that
  // into the ratio would make the number fall when a trader behaves well.
  it('computes the capture rate on winners only', () => {
    const p = planVsExecution([
      closedAt(112, 1.2, 'WIN'),
      closedAt(90, -1, 'LOSS'),
    ]);
    expect(p.captureRate).toBe(0.4);
  });

  it('separates measured trades from assumed ones', () => {
    const p = planVsExecution([closedAt(112, 1.2, 'WIN'), T({ result: 'WIN' })]);
    expect(p.measured).toBe(1);
    expect(p.assumed).toBe(1);
  });

  it('has no capture rate at all when nothing was measured', () => {
    expect(planVsExecution([T({ result: 'WIN' })]).captureRate).toBeNull();
  });
});

describe('completeness', () => {
  it('scores each field and the whole record', () => {
    const c = completeness([
      closedAt(130, 3, 'WIN', { followedRules: true, confirmations: ['SMT'], stopMoved: 'none', notes: 'x' }),
      T({ result: 'WIN' }),
    ]);
    expect(c.exitPrice).toBe(0.5);
    expect(c.rulesAnswer).toBe(0.5);
    expect(c.overall).toBe(0.5);
  });

  it('counts a logged stop move as an answer about the stop', () => {
    const c = completeness([
      closedAt(130, 3, 'WIN', { management: [{ at: '2026-08-01T10:00:00Z', kind: 'stop', to: 95 }] }),
    ]);
    expect(c.stopAnswer).toBe(1);
  });
});
