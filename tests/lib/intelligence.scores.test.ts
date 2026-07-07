import { describe, expect, it } from 'vitest';
import { computeEdgeScore, computeLearningScore } from '../../app/lib/intelligence/scores';
import type { PatternMemoryRow, ScoreSnapshot, TraderProfile } from '../../app/lib/intelligence/types';
import type { ConfidenceLevel } from '../../app/lib/analytics';

function profile(overrides: Partial<TraderProfile> = {}): TraderProfile {
  return {
    schemaVersion: 1, strongestInstrument: null, weakestInstrument: null, strongestSession: null, weakestSession: null,
    bestHour: null, worstHour: null, direction: { edge: 'none', longWinRate: 0, shortWinRate: 0 },
    winRate: { current: 60, trend: 'flat' }, avgRR: { current: 1.5, trend: 'flat' }, profitFactor: { current: 2, trend: 'flat' },
    exitBehavior: { ratio: 1 }, topConfirmations: [], screenshotAvailability: { pct: 0, count: 0, totalClosed: 0 },
    notesObservations: [], recurringConditions: [], changesVsPrevious: [],
    ...overrides,
  };
}

function pattern(status: PatternMemoryRow['status'], level: ConfidenceLevel = 'medium'): PatternMemoryRow {
  return {
    clerkId: 'user_A', patternId: `p_${Math.random()}`, kind: 'instrument_best', subject: { instrument: 'ES' },
    status, currentMetric: { key: 'ES', label: 'ES', trades: 20, wins: 12, losses: 8, winRate: 60, totalPnl: 0, avgRR: 1, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level, sampleSize: 20 } },
    currentConfidenceLevel: level, currentSampleSize: 20, baselineWinRate: 50, delta: 10,
    firstDetectedAt: '2026-06-01T00:00:00.000Z', lastSeenAt: '2026-07-01T00:00:00.000Z', lastUpdatedAt: '2026-07-01T00:00:00.000Z',
    consecutiveMisses: 0, history: [], aiTitle: null, aiEvidence: null, aiAction: null, aiPhrasedStatus: null, aiPhrasedWinRate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

describe('computeEdgeScore', () => {
  it('scores higher when more patterns are active/strengthening with strong confidence', () => {
    const weak = computeEdgeScore(profile(), [pattern('weakening', 'low'), pattern('disappeared')], null);
    const strong = computeEdgeScore(profile(), [pattern('active', 'high'), pattern('strengthening', 'high')], null);
    expect(strong).toBeGreaterThan(weak);
  });

  it('smooths against the previous score instead of jumping straight to the fresh reading', () => {
    const previousScore = 40;
    const nextScore = computeEdgeScore(profile(), [pattern('active', 'high'), pattern('strengthening', 'high')], previousScore);
    // A single run should move meaningfully but not all the way to a much higher raw score.
    expect(nextScore).toBeGreaterThan(previousScore);
    expect(nextScore).toBeLessThan(100);
  });

  it('returns the raw score unsmoothed the first time (no previous score)', () => {
    const score = computeEdgeScore(profile(), [], null);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('stays within 0-100 in every case', () => {
    const score = computeEdgeScore(profile({ strongestSession: null }), [pattern('active', 'high')], 95);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('computeLearningScore', () => {
  const snapshot = (avgRR: number, profitFactor: number, edgeScore: number): ScoreSnapshot => ({
    at: '2026-07-01T00:00:00.000Z', edgeScore, learningScore: 50, winRate: 60, avgRR, profitFactor,
  });

  it('returns a neutral 50 when there is not enough history yet', () => {
    expect(computeLearningScore([], 60)).toBe(50);
    expect(computeLearningScore([snapshot(1, 2, 60)], 60)).toBe(50);
  });

  it('scores above neutral when avgRR and profit factor trend upward across the history', () => {
    const history = [snapshot(1.0, 1.5, 40), snapshot(1.1, 1.6, 45), snapshot(1.8, 2.5, 55), snapshot(2.0, 2.8, 60)];
    expect(computeLearningScore(history, 65)).toBeGreaterThan(50);
  });

  it('scores below neutral when avgRR and profit factor trend downward across the history', () => {
    const history = [snapshot(2.0, 2.8, 60), snapshot(1.8, 2.5, 55), snapshot(1.1, 1.6, 45), snapshot(1.0, 1.5, 40)];
    expect(computeLearningScore(history, 35)).toBeLessThan(50);
  });

  it('never lets an Infinity profit factor poison the score', () => {
    const history = [snapshot(1, Infinity, 60), snapshot(1, Infinity, 60)];
    const score = computeLearningScore(history, 60);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
