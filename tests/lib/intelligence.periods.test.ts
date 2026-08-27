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

  it('holds average R flat when one trade could account for the move', () => {
    // Four decided trades a side, so one trade is worth 0.25R. The weeks are
    // 0.2R apart — above the fixed 0.15 floor the rule used to stop at, and
    // below what a single trade in a week this short can explain.
    const week = (r: number) => runFullAnalysis(
      Array.from({ length: 4 }, () => makeTrade({
        symbol: 'ES', session: 'nyam', model: UNSPECIFIED_MODEL, result: 'WIN', tradeR: r,
      })),
    );
    const c = computePeriodComparison(week(1.2), week(1), null);
    expect(c.avgRR.deltaVsPrevWeek).toBeCloseTo(0.2, 5);
    expect(c.avgRR.trend).toBe('flat');
  });

  it('calls average R a direction once the move outgrows one trade', () => {
    const week = (r: number) => runFullAnalysis(
      Array.from({ length: 4 }, () => makeTrade({
        symbol: 'ES', session: 'nyam', model: UNSPECIFIED_MODEL, result: 'WIN', tradeR: r,
      })),
    );
    expect(computePeriodComparison(week(1.4), week(1), null).avgRR.trend).toBe('up');
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
