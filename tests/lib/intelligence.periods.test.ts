import { describe, expect, it } from 'vitest';
import { runFullAnalysis } from '../../app/lib/analytics';
import { computePeriodComparison } from '../../app/lib/intelligence/periods';
import { UNSPECIFIED_MODEL } from '../../app/lib/journal';
import { makeTrade } from '../helpers/trade';

// UNSPECIFIED_MODEL keeps these trades out of the confirmation breakdown
// entirely, so the concentration tests below only exercise the
// instrument/session dimensions they're actually named after.
function trades(symbol: 'ES' | 'NQ', session: string, wins: number, losses: number) {
  const out = [];
  for (let i = 0; i < wins; i++) out.push(makeTrade({ symbol, session, model: UNSPECIFIED_MODEL, result: 'WIN' }));
  for (let i = 0; i < losses; i++) out.push(makeTrade({ symbol, session, model: UNSPECIFIED_MODEL, result: 'LOSS' }));
  return out;
}

describe('computePeriodComparison', () => {
  it('says plainly there is no comparison when prevWeek/baseline are null', () => {
    const thisWeek = runFullAnalysis(trades('ES', 'nyam', 5, 0));
    const c = computePeriodComparison(thisWeek, null, null);
    expect(c.hasPrevWeek).toBe(false);
    expect(c.hasBaseline).toBe(false);
    expect(c.winRate.prevWeek).toBeNull();
    expect(c.winRate.deltaVsPrevWeek).toBeNull();
    expect(c.winRate.trend).toBe('flat');
  });

  it('computes up/down trend and deltas against a real previous week', () => {
    const thisWeek = runFullAnalysis(trades('ES', 'nyam', 8, 2));   // winRate 80
    const prevWeek = runFullAnalysis(trades('ES', 'nyam', 3, 7));   // winRate 30
    const c = computePeriodComparison(thisWeek, prevWeek, null);
    expect(c.hasPrevWeek).toBe(true);
    expect(c.winRate.trend).toBe('up');
    expect(c.winRate.deltaVsPrevWeek).toBeCloseTo(50, 5);
  });

  // ── noise is not a direction ──────────────────────────────────────────────
  //
  // The trend used to be a fixed three-point threshold. In a week of ten
  // decided trades one trade is worth ten points, so almost every week came
  // back with a direction on every metric — and `rootCause` reads those three
  // labels together and names a MECHANISM from them, which the weekly
  // narrative then explains to the trader in confident prose. One trade of
  // variance became a diagnosis.

  it('does not call one trade of difference a direction', () => {
    // 6 of 10 against 5 of 10. Fisher on this table returns p = 1.
    const thisWeek = runFullAnalysis(trades('ES', 'nyam', 6, 4));
    const prevWeek = runFullAnalysis(trades('ES', 'nyam', 5, 5));
    const c = computePeriodComparison(thisWeek, prevWeek, null);
    expect(c.winRate.trend).toBe('flat');
    // The delta is still reported — the move happened, it just is not a
    // direction, and a surface that wants the raw number still has it.
    expect(c.winRate.deltaVsPrevWeek).toBeCloseTo(10, 5);
  });

  it('calls a swing a direction once the sample can carry it', () => {
    const thisWeek = runFullAnalysis(trades('ES', 'nyam', 16, 4));
    const prevWeek = runFullAnalysis(trades('ES', 'nyam', 6, 14));
    expect(computePeriodComparison(thisWeek, prevWeek, null).winRate.trend).toBe('up');
  });

  it('reads no direction out of a week with nothing decided', () => {
    const thisWeek = runFullAnalysis(trades('ES', 'nyam', 4, 4));
    const prevWeek = runFullAnalysis([]);
    const c = computePeriodComparison(thisWeek, prevWeek, null);
    expect(c.hasPrevWeek).toBe(true);
    expect(c.winRate.trend).toBe('flat');
    expect(c.avgRR.trend).toBe('flat');
    expect(c.profitFactor.trend).toBe('flat');
  });

  // The floor comes from how far apart the trades themselves landed, not from
  // how many there were. The old rule read "one trade moves a mean of R by
  // 1/n", which holds only if every trade lands about 1R from the mean; real
  // R multiples land three times further out. Simulated on two weeks drawn
  // from ONE distribution — same trader, nothing changed — 83% of them were
  // reported as having moved, and `avgRR.trend === 'down'` is what makes
  // rootCause name exit management as the mechanism.
  const week = (rs: number[]) => runFullAnalysis(
    rs.map(r => makeTrade({
      symbol: 'ES', session: 'nyam', model: UNSPECIFIED_MODEL,
      result: r > 0 ? 'WIN' : 'LOSS', tradeR: r,
    })),
  );

  it('holds average R flat when the spread of the trades could account for the move', () => {
    // Two ordinary weeks: winners between 1.5R and 3R, losers at -1R. Their
    // averages are 0.06R apart and the trades are spread over four R, so
    // nothing here is a direction.
    const c = computePeriodComparison(
      week([2, -1, 3, -1, 1, -1, 2, -1]),
      week([1.5, -1, 2.5, -1, 1.5, -1, 2, -1]),
      null,
    );
    expect(c.avgRR.trend).toBe('flat');
  });

  // The old fixture used four IDENTICAL trades a side, which has no spread at
  // all — and with no spread a 0.2R gap really is a direction. Kept as its own
  // case, because it is the one place the fixed floor still decides.
  it('calls a gap a direction when the trades had no spread to hide it', () => {
    const c = computePeriodComparison(week([1.2, 1.2, 1.2, 1.2]), week([1, 1, 1, 1]), null);
    expect(c.avgRR.deltaVsPrevWeek).toBeCloseTo(0.2, 5);
    expect(c.avgRR.trend).toBe('up');
  });

  it('calls average R a direction once the move outgrows that spread', () => {
    const c = computePeriodComparison(
      week([3, -1, 3, 2.5, 3, -1, 3, 2.5, 3, 2.5]),
      week([-1, -1, 0.5, -1, -1, -1, 0.5, -1, -1, -1]),
      null,
    );
    expect(c.avgRR.trend).toBe('up');
  });

  it('flags over-reliance when one instrument carries >=60% of the week\'s trades', () => {
    const thisWeek = runFullAnalysis([
      ...trades('ES', 'nyam', 6, 0),  // 6 of 10 trades = 60%
      ...trades('NQ', 'london', 2, 2),
    ]);
    const c = computePeriodComparison(thisWeek, null, null);
    expect(c.concentration.isOverReliant).toBe(true);
    expect(c.concentration.overRelianceSubject?.key).toBe('ES');
  });

  it('does not flag over-reliance when trades are spread out', () => {
    const thisWeek = runFullAnalysis([
      ...trades('ES', 'nyam', 3, 2),
      ...trades('NQ', 'london', 3, 2),
    ]);
    const c = computePeriodComparison(thisWeek, null, null);
    expect(c.concentration.isOverReliant).toBe(false);
    expect(c.concentration.overRelianceSubject).toBeNull();
  });
});
