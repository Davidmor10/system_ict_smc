import { describe, expect, it } from 'vitest';
import { runFullAnalysis } from '../../app/lib/analytics';
import { deriveTraderProfile } from '../../app/lib/intelligence/profile';
import type { TraderProfile } from '../../app/lib/intelligence/types';
import { makeTrade } from '../helpers/trade';

function winsAndLosses(symbol: 'ES' | 'NQ', session: string, wins: number, losses: number, direction: 'LONG' | 'SHORT' = 'LONG') {
  const trades = [];
  for (let i = 0; i < wins; i++) trades.push(makeTrade({ symbol, session, direction, result: 'WIN' }));
  for (let i = 0; i < losses; i++) trades.push(makeTrade({ symbol, session, direction, result: 'LOSS' }));
  return trades;
}

describe('deriveTraderProfile', () => {
  it('picks the strongest/weakest instrument and session by win rate once sample size qualifies', () => {
    const trades = [
      ...winsAndLosses('ES', 'nyam', 5, 0),
      ...winsAndLosses('NQ', 'london', 0, 5),
    ];
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.strongestInstrument?.key).toBe('ES');
    expect(profile.weakestInstrument?.key).toBe('NQ');
    expect(profile.strongestSession?.key).toBe('nyam');
    expect(profile.weakestSession?.key).toBe('london');
  });

  it('returns null extremes when no group reaches the minimum sample size', () => {
    const trades = [...winsAndLosses('ES', 'nyam', 1, 0), ...winsAndLosses('NQ', 'london', 0, 1)];
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.strongestInstrument).toBeNull();
    expect(profile.weakestInstrument).toBeNull();
  });

  it('reports a direction edge only when both long and short qualify by sample size', () => {
    const tooFewShorts = [
      ...winsAndLosses('ES', 'nyam', 5, 0, 'LONG'),
      ...winsAndLosses('ES', 'nyam', 0, 1, 'SHORT'),
    ];
    expect(deriveTraderProfile(runFullAnalysis(tooFewShorts), tooFewShorts, null).direction.edge).toBe('none');

    const bothQualify = [
      ...winsAndLosses('ES', 'nyam', 5, 0, 'LONG'),
      ...winsAndLosses('ES', 'nyam', 0, 5, 'SHORT'),
    ];
    expect(deriveTraderProfile(runFullAnalysis(bothQualify), bothQualify, null).direction.edge).toBe('long');
  });

  it('computes up/down/flat trend against the previous profile, threshold-guarded', () => {
    const trades = winsAndLosses('ES', 'nyam', 7, 3); // winRate 70
    const analysis = runFullAnalysis(trades);
    const base = {
      avgRR: { current: 0, trend: 'flat' },
      profitFactor: { current: 0, trend: 'flat' },
      direction: { edge: 'none', longWinRate: 0, shortWinRate: 0 },
      strongestInstrument: null,
      weakestInstrument: null,
      strongestSession: null,
    };

    const previousFlat = { ...base, winRate: { current: 68, trend: 'flat' } } as TraderProfile;
    expect(deriveTraderProfile(analysis, trades, previousFlat).winRate.trend).toBe('flat'); // within 3pp

    const previousDown = { ...base, winRate: { current: 50, trend: 'flat' } } as TraderProfile;
    expect(deriveTraderProfile(analysis, trades, previousDown).winRate.trend).toBe('up'); // 70 vs 50

    const previousUp = { ...base, winRate: { current: 95, trend: 'flat' } } as TraderProfile;
    expect(deriveTraderProfile(analysis, trades, previousUp).winRate.trend).toBe('down');
  });

  it('defaults every trend to flat when there is no previous profile', () => {
    const trades = winsAndLosses('ES', 'nyam', 5, 0);
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.winRate.trend).toBe('flat');
    expect(profile.avgRR.trend).toBe('flat');
    expect(profile.profitFactor.trend).toBe('flat');
    expect(profile.changesVsPrevious).toEqual([]);
  });

  it('keeps only non-empty notes, most recent first, capped at 5', () => {
    const trades = [
      makeTrade({ notes: '' }),
      makeTrade({ notes: 'first note' }),
      makeTrade({ notes: '  ' }),
      makeTrade({ notes: 'second note' }),
    ];
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.notesObservations).toEqual(['second note', 'first note']);
  });

  it('computes screenshot availability as a percentage of closed trades', () => {
    const trades = [
      makeTrade({ result: 'WIN', screenshots: ['data:image/png;base64,x'] }),
      makeTrade({ result: 'WIN' }),
      makeTrade({ result: 'OPEN' }), // excluded from the closed-trade denominator
    ];
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.screenshotAvailability.totalClosed).toBe(2);
    expect(profile.screenshotAvailability.count).toBe(1);
    expect(profile.screenshotAvailability.pct).toBe(50);
  });
});
