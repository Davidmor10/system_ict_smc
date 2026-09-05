// The edge score and the learning score.
//
// This suite exists because of one defect and its consequence.
//
// The score used to substitute a neutral 50 for every factor whose sample was
// too thin, and 70 for stability when there was no previous profile at all.
// A brand-new account — nothing analysed, nothing to compare against — scored
// 45 out of 100 on an edge that had never been measured.
//
// The consequence was worse than the number. When a trader's data finally
// crossed a sample floor, the placeholder was replaced by a real reading, the
// score moved, and the learning score read that movement AS LEARNING. A
// measurement beginning to exist is not the trader improving, and the tests
// below are what keep those two apart.

import { describe, expect, it } from 'vitest';
import {
  computeEdgeScore, computeLearningScore, MIN_MEASURED_WEIGHT,
  MIN_CONFIRMATION_SAMPLE, MIN_SPECIALIZATION_SAMPLE,
} from '../../app/lib/intelligence/scores';
import type { PatternMemoryRow, ScoreSnapshot, TraderProfile } from '../../app/lib/intelligence/types';
import type { ConfidenceLevel, ExitBehavior, GroupPerformance } from '../../app/lib/analytics';

const EMPTY_EXIT: ExitBehavior = { sampleSize: 0, winnerCount: 0, captureRatio: null, winnersCutShort: 0, partialExitRate: 0, avgWinnerR: 0, avgLoserR: 0 };

function group(winRate: number, sampleSize: number): GroupPerformance {
  return {
    key: 'g', label: 'g', trades: sampleSize, wins: 0, losses: 0, winRate,
    totalPnl: 0, avgRR: 1, rrSample: 0, rrStdDev: null, avgWinner: 1, avgLoser: 1, profitFactor: 1,
    confidence: { level: 'medium', sampleSize },
  } as GroupPerformance;
}

function profile(overrides: Partial<TraderProfile> = {}): TraderProfile {
  return {
    schemaVersion: 1, strongestInstrument: null, weakestInstrument: null, strongestSession: null, weakestSession: null,
    bestHour: null, worstHour: null, direction: { edge: 'none', longWinRate: 0, shortWinRate: 0 },
    winRate: { current: 60, trend: 'flat' }, avgRR: { current: 1.5, trend: 'flat' }, profitFactor: { current: 2, trend: 'flat' },
    exitBehavior: { ratio: 1, detail: EMPTY_EXIT }, topConfirmations: [], screenshotAvailability: { pct: 0, count: 0, totalClosed: 0 },
    notesObservations: [], recurringConditions: [], changesVsPrevious: [],
    ...overrides,
  };
}

function pattern(status: PatternMemoryRow['status'], level: ConfidenceLevel = 'medium'): PatternMemoryRow {
  return {
    clerkId: 'user_A', patternId: `p_${Math.random()}`, kind: 'instrument_best', subject: { instrument: 'ES' },
    status, currentMetric: { key: 'ES', label: 'ES', trades: 20, wins: 12, losses: 8, winRate: 60, totalPnl: 0, avgRR: 1, rrSample: 0, rrStdDev: null, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level, sampleSize: 20 } },
    currentConfidenceLevel: level, currentSampleSize: 20, baselineWinRate: 50, delta: 10,
    firstDetectedAt: '2026-06-01T00:00:00.000Z', lastSeenAt: '2026-07-01T00:00:00.000Z', lastUpdatedAt: '2026-07-01T00:00:00.000Z',
    consecutiveMisses: 0, history: [], aiTitle: null, aiEvidence: null, aiAction: null, aiPhrasedStatus: null, aiPhrasedWinRate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

/** A profile where every factor can actually be read. */
function measurable(): TraderProfile {
  return profile({
    winRate: { current: 60, trend: 'up' },
    avgRR: { current: 1.5, trend: 'up' },
    profitFactor: { current: 2, trend: 'flat' },
    topConfirmations: [group(62, MIN_CONFIRMATION_SAMPLE + 5)],
    strongestSession: group(70, MIN_SPECIALIZATION_SAMPLE), weakestSession: group(40, MIN_SPECIALIZATION_SAMPLE),
    strongestInstrument: group(68, MIN_SPECIALIZATION_SAMPLE), weakestInstrument: group(45, MIN_SPECIALIZATION_SAMPLE),
  });
}

describe('the edge score refuses to invent a reading', () => {
  // The headline case: the account this file was written for.
  it('returns no score at all for an account with nothing measured', () => {
    const r = computeEdgeScore(profile(), [], null, false);
    expect(r.score).toBeNull();
    expect(r.measured).toBe(0);
    expect(r.measuredWeight).toBe(0);
  });

  it('reports every factor it could not read, with a reason the trader can act on', () => {
    const r = computeEdgeScore(profile(), [], null, false);
    for (const f of r.factors) {
      expect(f.score).toBeNull();
      expect(f.missing).toBeTruthy();
      // A factor that could not be read carries no weight into anything.
      expect(f.effectiveWeight).toBe(0);
    }
  });

  // Every trend defaults to 'flat' with nothing to compare against, and 'flat'
  // scored 70 — a flattering stability reading for a first-ever run.
  it('does not read stability from trends that had nothing to compare against', () => {
    const first = computeEdgeScore(measurable(), [pattern('active', 'high')], null, false);
    expect(first.factors.find(f => f.key === 'stability')?.score).toBeNull();

    const later = computeEdgeScore(measurable(), [pattern('active', 'high')], null, true);
    expect(later.factors.find(f => f.key === 'stability')?.score).not.toBeNull();
  });

  it('does not read confirmation quality from a sample too small to average', () => {
    const thin = computeEdgeScore(profile({ topConfirmations: [group(90, MIN_CONFIRMATION_SAMPLE - 1)] }), [], null, true);
    expect(thin.factors.find(f => f.key === 'confirmation')?.score).toBeNull();
  });

  // The spread between the max and min of two small samples is maximised by
  // noise, not by skill.
  it('does not read specialization from two thin groups', () => {
    const thin = computeEdgeScore(profile({
      strongestSession: group(90, MIN_SPECIALIZATION_SAMPLE - 1),
      weakestSession: group(20, MIN_SPECIALIZATION_SAMPLE - 1),
    }), [], null, true);
    expect(thin.factors.find(f => f.key === 'sessionSpecialization')?.score).toBeNull();
  });

  // Zero live patterns out of twenty analysed is a finding. Zero out of zero
  // is an empty table, and the two must not produce the same number.
  it('separates “no pattern survived” from “nothing was analysed”', () => {
    const analysed = computeEdgeScore(profile(), [pattern('disappeared'), pattern('weakening', 'low')], null, true);
    expect(analysed.factors.find(f => f.key === 'consistency')?.score).toBe(0);

    const never = computeEdgeScore(profile(), [], null, true);
    expect(never.factors.find(f => f.key === 'consistency')?.score).toBeNull();
  });
});

describe('the edge score redistributes what it can read', () => {
  it('spreads the missing weight across the measurable factors', () => {
    const r = computeEdgeScore(measurable(), [pattern('active', 'high')], null, true);
    const live = r.factors.filter(f => f.score != null);
    const total = live.reduce((a, f) => a + f.effectiveWeight, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('still scores when most of the definition is present', () => {
    const r = computeEdgeScore(measurable(), [pattern('active', 'high')], null, true);
    expect(r.score).not.toBeNull();
    expect(r.measuredWeight).toBeGreaterThanOrEqual(MIN_MEASURED_WEIGHT);
  });

  // A number assembled from a quarter of what it claims to be is not a weak
  // reading of the trader's edge; it is a different quantity wearing its name.
  it('withholds the score below the measurable-weight floor', () => {
    // Only the two specialization factors are readable — 0.20 of the weight.
    const r = computeEdgeScore(profile({
      strongestSession: group(70, MIN_SPECIALIZATION_SAMPLE), weakestSession: group(40, MIN_SPECIALIZATION_SAMPLE),
      strongestInstrument: group(68, MIN_SPECIALIZATION_SAMPLE), weakestInstrument: group(45, MIN_SPECIALIZATION_SAMPLE),
    }), [], null, false);
    expect(r.measuredWeight).toBeLessThan(MIN_MEASURED_WEIGHT);
    expect(r.score).toBeNull();
    expect(r.measured).toBe(2);
  });

  it('stays inside 0-100 and reads higher for a stronger set of patterns', () => {
    const weak = computeEdgeScore(measurable(), [pattern('weakening', 'low'), pattern('disappeared')], null, true);
    const strong = computeEdgeScore(measurable(), [pattern('active', 'high'), pattern('strengthening', 'high')], null, true);
    expect(strong.score!).toBeGreaterThan(weak.score!);
    for (const r of [weak, strong]) {
      expect(r.score!).toBeGreaterThanOrEqual(0);
      expect(r.score!).toBeLessThanOrEqual(100);
    }
  });

  it('smooths against a previous score instead of jumping to the fresh reading', () => {
    const next = computeEdgeScore(measurable(), [pattern('active', 'high'), pattern('strengthening', 'high')], 40, true);
    expect(next.score!).toBeGreaterThan(40);
    expect(next.score!).toBeLessThan(100);
  });
});

describe('the learning score', () => {
  const snap = (avgRR: number, profitFactor: number, edgeScore: number | null): ScoreSnapshot => ({
    at: '2026-07-01T00:00:00.000Z', edgeScore, learningScore: null, winRate: 60, avgRR, profitFactor,
  });

  // The whole point of the change: "cannot say" and "no improvement" are now
  // different values, so no caller has to remember the difference.
  it('is null, not 50, when the history is too short to compare', () => {
    expect(computeLearningScore([], 60)).toBeNull();
    expect(computeLearningScore([snap(1, 1, 50)], 60)).toBeNull();
  });

  it('is null when the edge score it reads could not be measured', () => {
    expect(computeLearningScore([snap(1, 1, 50), snap(1, 1, 52)], null)).toBeNull();
  });

  // A run where the edge could not be read is missing from the comparison,
  // not evidence of a collapse in it.
  it('is null when no earlier snapshot carries an edge score to compare against', () => {
    expect(computeLearningScore([snap(1, 1, null), snap(1.4, 1.6, 60)], 62)).toBeNull();
  });

  it('scores above neutral when the later half improved', () => {
    const history = [snap(1.0, 1.2, 50), snap(1.1, 1.3, 52), snap(1.6, 2.0, 58), snap(1.8, 2.2, 60)];
    expect(computeLearningScore(history, 62)!).toBeGreaterThan(50);
  });

  it('scores below neutral when the later half got worse', () => {
    const history = [snap(1.8, 2.2, 60), snap(1.7, 2.1, 58), snap(1.1, 1.2, 50), snap(1.0, 1.1, 46)];
    expect(computeLearningScore(history, 44)!).toBeLessThan(50);
  });

  it('never lets an Infinity profit factor poison the average', () => {
    const history = [snap(1, 1, 50), snap(1, 1, 50), snap(1, Infinity, 52), snap(1, Infinity, 52)];
    const score = computeLearningScore(history, 54)!;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeLessThanOrEqual(100);
  });
});
