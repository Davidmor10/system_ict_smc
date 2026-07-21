import { describe, expect, it } from 'vitest';
import { pairedExtremes } from '../../app/lib/analytics/extremes';
import type { GroupPerformance } from '../../app/lib/analytics';
import { runFullAnalysis } from '../../app/lib/analytics';
import { deriveTraderProfile } from '../../app/lib/intelligence/profile';
import { makeTrade } from '../helpers/trade';

function group(key: string, winRate: number, sampleSize = 5): GroupPerformance {
  return {
    key, label: key, trades: sampleSize, wins: 0, losses: 0, winRate,
    totalPnl: winRate, avgRR: 0, avgWinner: 0, avgLoser: 0, profitFactor: 0,
    confidence: { level: 'medium', sampleSize },
  } as GroupPerformance;
}

const eligible = (g: GroupPerformance) => g.confidence.sampleSize >= 3;
const byWinRate = (g: GroupPerformance) => g.winRate;

describe('pairedExtremes — the shared "never the same group as both" guarantee', () => {
  it('returns both extremes when two distinct groups genuinely differ', () => {
    const { strongest, weakest } = pairedExtremes([group('A', 80), group('B', 20)], byWinRate, eligible);
    expect(strongest?.key).toBe('A');
    expect(weakest?.key).toBe('B');
  });

  it('nulls weakest when only one group is eligible (the single-instrument bug)', () => {
    const { strongest, weakest } = pairedExtremes([group('A', 60), group('B', 90, 1)], byWinRate, eligible);
    expect(strongest?.key).toBe('A');
    expect(weakest).toBeNull();
  });

  it('nulls weakest when the two extremes are the SAME group object', () => {
    const only = group('A', 55);
    const { strongest, weakest } = pairedExtremes([only], byWinRate, eligible);
    expect(strongest).toBe(only);
    expect(weakest).toBeNull();
  });

  it('nulls weakest when metrics are equal (no honest spread)', () => {
    const { weakest } = pairedExtremes([group('A', 50), group('B', 50)], byWinRate, eligible);
    expect(weakest).toBeNull();
  });

  it('respects a minimum spread', () => {
    expect(pairedExtremes([group('A', 51), group('B', 50)], byWinRate, eligible, 3).weakest).toBeNull();
    expect(pairedExtremes([group('A', 60), group('B', 50)], byWinRate, eligible, 3).weakest?.key).toBe('B');
  });

  it('returns nulls for an empty eligible pool', () => {
    expect(pairedExtremes([group('A', 90, 1)], byWinRate, eligible)).toEqual({ strongest: null, weakest: null });
  });
});

describe('paired extremes — matrix across every real dimension', () => {
  // Every dimension the app derives a strongest/weakest pair for. A single
  // eligible group per dimension is the exact condition that used to produce a
  // self-contradiction ("strongest X" AND "weakest X"). None may now do so.
  it('no dimension marks the same group strongest AND weakest, on single-group data', () => {
    // One instrument, one session, one weekday, one hour — all the same trades.
    const trades = Array.from({ length: 7 }, (_, i) =>
      makeTrade({ symbol: 'NQ', session: 'nyam', dateISO: '2026-07-06', time: '16:30', result: i % 2 === 0 ? 'WIN' : 'LOSS' }),
    );
    const analysis = runFullAnalysis(trades);
    const profile = deriveTraderProfile(analysis, trades, null);

    const pairs: [string, { key: string } | null, { key: string } | null][] = [
      ['instrument', profile.strongestInstrument, profile.weakestInstrument],
      ['session', profile.strongestSession, profile.weakestSession],
      ['hour', analysis.time.bestHour, analysis.time.worstHour],
      ['weekday', analysis.time.bestWeekday, analysis.time.worstWeekday],
      ['week', analysis.time.strongestWeek, analysis.time.weakestWeek],
    ];
    for (const [dim, strong, weak] of pairs) {
      if (strong && weak) {
        expect(strong.key, `${dim}: strongest and weakest must differ`).not.toBe(weak.key);
      }
    }
  });

  it('distinct data still yields distinct strongest/weakest keys per dimension', () => {
    const trades = [
      ...Array.from({ length: 5 }, () => makeTrade({ symbol: 'ES', session: 'nyam', dateISO: '2026-07-06', time: '16:30', result: 'WIN' })),
      ...Array.from({ length: 5 }, () => makeTrade({ symbol: 'NQ', session: 'london', dateISO: '2026-07-07', time: '10:30', result: 'LOSS' })),
    ];
    const analysis = runFullAnalysis(trades);
    const profile = deriveTraderProfile(analysis, trades, null);
    if (profile.strongestInstrument && profile.weakestInstrument) {
      expect(profile.strongestInstrument.key).not.toBe(profile.weakestInstrument.key);
    }
    if (profile.strongestSession && profile.weakestSession) {
      expect(profile.strongestSession.key).not.toBe(profile.weakestSession.key);
    }
  });
});
