import { describe, expect, it } from 'vitest';
import { deriveKnownFacts } from '../../app/lib/intelligence/memory';
import type { TraderProfile, KnownFact } from '../../app/lib/intelligence/types';
import type { ExitBehavior, GroupPerformance } from '../../app/lib/analytics';

const NOW = '2026-07-06T12:00:00.000Z';

const EMPTY_EXIT: ExitBehavior = { sampleSize: 0, winnerCount: 0, captureRatio: null, winnersCutShort: 0, partialExitRate: 0, avgWinnerR: 0, avgLoserR: 0 };

function group(key: string, winRate: number, sampleSize = 20): GroupPerformance {
  return { key, label: key, trades: sampleSize, wins: Math.round(sampleSize * winRate / 100), losses: sampleSize - Math.round(sampleSize * winRate / 100), winRate, totalPnl: 0, avgRR: 1, rrSample: 0, rrStdDev: null, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level: 'medium', sampleSize } };
}

function baseProfile(overrides: Partial<TraderProfile> = {}): TraderProfile {
  return {
    schemaVersion: 1, strongestInstrument: null, weakestInstrument: null, strongestSession: null, weakestSession: null,
    bestHour: null, worstHour: null, direction: { edge: 'none', longWinRate: 0, shortWinRate: 0 },
    winRate: { current: 60, trend: 'flat' }, avgRR: { current: 1.5, trend: 'flat' }, profitFactor: { current: 2, trend: 'flat' },
    exitBehavior: { ratio: 1, detail: EMPTY_EXIT }, topConfirmations: [], screenshotAvailability: { pct: 0, count: 0, totalClosed: 0 },
    notesObservations: [], recurringConditions: [], changesVsPrevious: [],
    ...overrides,
  };
}

describe('deriveKnownFacts', () => {
  it('produces a fact for the strongest instrument', () => {
    const facts = deriveKnownFacts(baseProfile({ strongestInstrument: group('MNQ', 70) }), [], NOW);
    expect(facts.find(f => f.sourceField === 'strongestInstrument')?.fact).toContain('MNQ');
  });

  it('flags exiting early via the legacy proxy ratio when no real exit data exists', () => {
    const early = deriveKnownFacts(baseProfile({ exitBehavior: { ratio: 0.5, detail: EMPTY_EXIT } }), [], NOW);
    expect(early.some(f => f.sourceField === 'exitBehavior')).toBe(true);

    const normal = deriveKnownFacts(baseProfile({ exitBehavior: { ratio: 1.1, detail: EMPTY_EXIT } }), [], NOW);
    expect(normal.some(f => f.sourceField === 'exitBehavior')).toBe(false);
  });

  it('prefers the real capture ratio and cites the exact percentage when there is a winner sample', () => {
    const detail: ExitBehavior = { sampleSize: 8, winnerCount: 5, captureRatio: 0.45, winnersCutShort: 4, partialExitRate: 0.5, avgWinnerR: 0.9, avgLoserR: -1 };
    // ratio proxy says "fine" (1.2) but the real capture ratio is well below plan — real data wins.
    const facts = deriveKnownFacts(baseProfile({ exitBehavior: { ratio: 1.2, detail } }), [], NOW);
    const exitFact = facts.find(f => f.sourceField === 'exitBehavior');
    expect(exitFact?.fact).toContain('45%');
  });

  it('only surfaces a confirmation fact when the sample and win rate are strong enough', () => {
    const weak = deriveKnownFacts(baseProfile({ topConfirmations: [group('FVG', 40)] }), [], NOW);
    expect(weak.some(f => f.sourceField === 'topConfirmations[0]')).toBe(false);

    const strong = deriveKnownFacts(baseProfile({ topConfirmations: [group('IFVG', 65)] }), [], NOW);
    expect(strong.find(f => f.sourceField === 'topConfirmations[0]')?.fact).toContain('IFVG');
  });

  it('keeps firstStatedAt when the same claim persists, but resets it when the underlying subject changes', () => {
    const previous: KnownFact[] = [{ fact: 'החוזק שלך הוא MNQ.', sourceField: 'strongestInstrument', confidence: 'medium', firstStatedAt: '2026-05-01T00:00:00.000Z', lastConfirmedAt: '2026-06-01T00:00:00.000Z' }];

    const stillMnq = deriveKnownFacts(baseProfile({ strongestInstrument: group('MNQ', 70) }), previous, NOW);
    expect(stillMnq[0].firstStatedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(stillMnq[0].lastConfirmedAt).toBe(NOW);

    const nowNq = deriveKnownFacts(baseProfile({ strongestInstrument: group('NQ', 70) }), previous, NOW);
    expect(nowNq[0].firstStatedAt).toBe(NOW); // a genuinely new claim, not a continuation
  });
});
