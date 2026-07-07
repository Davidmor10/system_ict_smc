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
