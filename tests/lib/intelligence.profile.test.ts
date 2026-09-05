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
    // Nine and one, each way. Both clear the shared floor and the pair clears
    // the separation test — a spread on its own no longer buys the claim.
    const trades = [
      ...winsAndLosses('ES', 'nyam', 9, 1),
      ...winsAndLosses('NQ', 'london', 1, 9),
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

  it('never marks the same instrument as BOTH strongest and weakest (the contradiction bug)', () => {
    // A trader who has only traded MNQ: one eligible instrument. It must not
    // become both "your strength" and "you struggle with it".
    const trades = winsAndLosses('NQ', 'nyam', 5, 4);
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.strongestInstrument?.key).toBe('NQ');
    expect(profile.weakestInstrument).toBeNull();
    if (profile.strongestInstrument && profile.weakestInstrument) {
      expect(profile.weakestInstrument.key).not.toBe(profile.strongestInstrument.key);
    }
  });

  it('does not call two near-equal groups strong vs weak without a real spread', () => {
    // ES 3/6 (50%) and NQ 3/6 (50%): equal win rate → no honest weak/strong split.
    const trades = [...winsAndLosses('ES', 'nyam', 3, 3), ...winsAndLosses('NQ', 'london', 3, 3)];
    const profile = deriveTraderProfile(runFullAnalysis(trades), trades, null);
    expect(profile.weakestInstrument).toBeNull();
  });

  it('reports a direction edge only when both long and short qualify by sample size', () => {
    const tooFewShorts = [
      ...winsAndLosses('ES', 'nyam', 9, 1, 'LONG'),
      ...winsAndLosses('ES', 'nyam', 0, 1, 'SHORT'),
    ];
    expect(deriveTraderProfile(runFullAnalysis(tooFewShorts), tooFewShorts, null).direction.edge).toBe('none');

    const bothQualify = [
      ...winsAndLosses('ES', 'nyam', 9, 1, 'LONG'),
      ...winsAndLosses('ES', 'nyam', 1, 9, 'SHORT'),
    ];
    expect(deriveTraderProfile(runFullAnalysis(bothQualify), bothQualify, null).direction.edge).toBe('long');
  });

  // THE WORD IS "EDGE", and the higher of two win rates used to be the whole
  // of it. Four longs at 50% against three shorts at 33% named one.
  it('names no edge when the two sides are a coin apart', () => {
    const wobble = [
      ...winsAndLosses('ES', 'nyam', 6, 4, 'LONG'),   // 60%
      ...winsAndLosses('ES', 'nyam', 4, 6, 'SHORT'),  // 40%
    ];
    expect(deriveTraderProfile(runFullAnalysis(wobble), wobble, null).direction.edge).toBe('none');
  });

  // The finding this whole change came from: a trader who is EXACTLY as good
  // everywhere was told they had a best session and a worst one, essentially
  // always, because picking the highest and lowest of several noisy rates
  // finds a gap by construction.
  it('names no strongest or weakest session when every session is the same', () => {
    const even = [
      ...winsAndLosses('ES', 'asia', 5, 5),
      ...winsAndLosses('ES', 'london', 6, 4),
      ...winsAndLosses('ES', 'nyam', 4, 6),
      ...winsAndLosses('ES', 'nypm', 5, 5),
    ];
    const profile = deriveTraderProfile(runFullAnalysis(even), even, null);
    expect(profile.weakestSession).toBeNull();
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

// ── movement against the previous snapshot ──────────────────────────────────
//
// The profile's three trends used to be fixed thresholds — three points of win
// rate, 0.15R, 0.2 of profit factor. On a journal this size a fixed threshold
// is smaller than one trade, so the profile reported a direction every time it
// was rebuilt, and the edge score reads those labels as its stability factor.

describe('deriveTraderProfile trends', () => {
  const profileOf = (wins: number, losses: number, previous: TraderProfile | null) => {
    const trades = winsAndLosses('ES', 'nyam', wins, losses);
    return deriveTraderProfile(runFullAnalysis(trades), trades, previous);
  };

  it('carries the counts forward so the next comparison can be tested', () => {
    const p = profileOf(6, 4, null);
    expect(p.winRate.decided).toEqual({ wins: 6, losses: 4 });
    expect(p.winRate.sample).toBe(10);
    expect(p.avgRR.sample).toBe(10);
  });

  it('has no trend on a first snapshot', () => {
    expect(profileOf(6, 4, null).winRate.trend).toBe('flat');
  });

  it('does not call one trade of difference a direction', () => {
    const before = profileOf(5, 5, null);
    expect(profileOf(6, 4, before).winRate.trend).toBe('flat');
  });

  it('calls a real move a direction once the sample can carry it', () => {
    const before = profileOf(6, 14, null);
    expect(profileOf(16, 4, before).winRate.trend).toBe('up');
  });

  it('falls back to the fixed floor against a snapshot written without counts', () => {
    // A profile stored before the counts existed. It can still be compared
    // against — just not tested — and the old behaviour is what it gets.
    const legacy = { ...profileOf(5, 5, null), winRate: { current: 50, trend: 'flat' as const } };
    expect(profileOf(6, 4, legacy).winRate.trend).toBe('up');
  });
});
