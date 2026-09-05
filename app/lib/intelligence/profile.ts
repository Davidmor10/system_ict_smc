// ─────────────────────────────────────────────────────────────────────────────
// Pure Trader Profile derivation — arithmetic over an already-computed
// FullAnalysis, never a new statistic. Nothing here reaches an LLM directly;
// it only produces the facts the AI layer is later allowed to phrase.
// ─────────────────────────────────────────────────────────────────────────────

import type { FullAnalysis, GroupPerformance } from '../analytics';
import { pairedExtremes, winRateSeparated } from '../analytics/extremes';
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';
import { bonferroni, fisherExactTwoSided } from '../stats/fisher';
import { PATTERN_ALPHA } from '../analytics/patterns';
import type { TradeEntry } from '../journal';
import { meanFloor, ratioFloor, winRateMoved, type DecidedSplit } from '../stats/movement';
import { computeTrend } from './trend';
import type { PatternMemorySubjectSummary, ProfileChange, TraderProfile } from './types';

const SCHEMA_VERSION = 1;
/** The shared floor, not a local copy. Three decided trades was never enough
    to call a session a strength — see lib/stats/evidence. */
const MIN_SAMPLE = MIN_DECIDED_FOR_CLAIM;
// Floors, not the rule — see ./movement. These three used to BE the rule, and
// at this journal's size a fixed floor is smaller than one trade: on a
// thirty-trade history one more win moves the win rate by about two points,
// so the profile reported a direction every time it was rebuilt. The label
// feeds the edge score's stability factor, which is a fifth of a number the
// trader reads as a measurement.
const WIN_RATE_THRESHOLD = 3;   // percentage points
const AVG_RR_THRESHOLD = 0.15;  // R
const PROFIT_FACTOR_THRESHOLD = 0.2;
const MAX_NOTES = 5;
const MAX_CONFIRMATIONS = 3;
const MAX_RECURRING = 5;

/** Strongest/weakest by win rate — a thin wrapper over the shared
    `pairedExtremes`, so the "never the same group as both" guarantee and the
    separation test both live in exactly one place.

    These two become durable KNOWN FACTS in plain Hebrew — "your strength is
    ES", "your weakest session is X" — and the narrative and hypothesis prompts
    cite them as standing context. A fact the LLM builds on has to be a fact. */
function extremesByWinRate(groups: GroupPerformance[]) {
  return pairedExtremes(
    groups,
    g => g.winRate,
    g => g.confidence.sampleSize >= MIN_SAMPLE,
    WIN_RATE_THRESHOLD,
    winRateSeparated,
  );
}

function diffField(field: string, previous: string | number | null, current: string | number | null): ProfileChange | null {
  if (previous === current) return null;
  if (previous === null && current === null) return null;
  return { field, previousValue: previous, currentValue: current };
}

/** Pure: turns one FullAnalysis snapshot (+ raw trades, for the two fields
    that aren't part of FullAnalysis) into a persistent TraderProfile. Reuses
    only numbers the analytics engine already computed — never recomputes a
    statistic itself. `recurringPatterns` is composed in by the service layer
    after updatePatternMemory has run in the same request. */
export function deriveTraderProfile(
  analysis: FullAnalysis,
  trades: TradeEntry[],
  previousProfile: TraderProfile | null,
  recurringPatterns: PatternMemorySubjectSummary[] = [],
): TraderProfile {
  const { strongest: strongestInstrument, weakest: weakestInstrument } = extremesByWinRate(analysis.instruments);
  const { strongest: strongestSession, weakest: weakestSession } = extremesByWinRate(analysis.sessions);

  // The word is EDGE, and it was decided by whichever side had the higher win
  // rate — on as few as three trades each, with nothing asked about whether
  // the two differed. Four longs at 50% against three shorts at 33% named an
  // edge. One comparison here, so the correction is a formality, but the test
  // is not.
  const { long, short } = analysis.direction;
  const bothQualify = long.confidence.sampleSize >= MIN_SAMPLE && short.confidence.sampleSize >= MIN_SAMPLE;
  const directionSeparated = bothQualify && bonferroni(
    fisherExactTwoSided(long.wins, long.losses, short.wins, short.losses), 1,
  ) < PATTERN_ALPHA;
  const direction = {
    edge: (directionSeparated
      ? (long.winRate > short.winRate ? 'long' : long.winRate < short.winRate ? 'short' : 'none')
      : 'none') as 'long' | 'short' | 'none',
    longWinRate: long.winRate,
    shortWinRate: short.winRate,
  };

  const { winRate, avgRR, profitFactor, avgWinner, avgLoser } = analysis.performance;

  // ── movement against the previous snapshot ───────────────────────────────
  //
  // Tested rather than thresholded, and against the counts the previous
  // snapshot recorded. A profile written before those counts existed cannot be
  // tested against, so it falls back to the fixed floors — the old behaviour,
  // kept only for the runs it takes to write a snapshot that carries them.
  const decided: DecidedSplit = { wins: analysis.performance.wins, losses: analysis.performance.losses };
  const previousDecided = previousProfile?.winRate.decided ?? null;
  const previousSample  = previousProfile?.avgRR.sample ?? null;
  const sample = decided.wins + decided.losses;
  const n = previousSample != null ? Math.min(sample, previousSample) : sample;

  const winRateTrend = previousProfile
    ? (previousDecided
        ? (winRateMoved(decided, previousDecided)
            ? computeTrend(winRate, previousProfile.winRate.current, WIN_RATE_THRESHOLD)
            : 'flat')
        : computeTrend(winRate, previousProfile.winRate.current, WIN_RATE_THRESHOLD))
    : 'flat';
  const avgRRTrend = computeTrend(
    avgRR, previousProfile?.avgRR.current ?? null,
    previousSample != null ? meanFloor(AVG_RR_THRESHOLD, n) : AVG_RR_THRESHOLD,
  );
  const profitFactorTrend = computeTrend(
    profitFactor, previousProfile?.profitFactor.current ?? null,
    previousSample != null ? ratioFloor(PROFIT_FACTOR_THRESHOLD, profitFactor, n) : PROFIT_FACTOR_THRESHOLD,
  );
  const exitRatio = avgRR > 0 && avgLoser > 0 ? (avgWinner / avgLoser) / avgRR : null;

  const closed = trades.filter(t => t.result !== 'OPEN');
  // hasScreenshot comes from a generated column when the analysis read them;
  // the array is the fallback for any caller that has the real thing.
  const withScreenshots = closed.filter(t => t.hasScreenshot ?? ((t.screenshots?.length ?? 0) > 0));
  const notesObservations = trades
    .filter(t => t.notes && t.notes.trim().length > 0)
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_NOTES)
    .map(t => t.notes.trim());

  const profile: TraderProfile = {
    schemaVersion: SCHEMA_VERSION,
    strongestInstrument,
    weakestInstrument,
    strongestSession,
    weakestSession,
    bestHour: analysis.time.bestHour,
    worstHour: analysis.time.worstHour,
    direction,
    winRate: { current: winRate, trend: winRateTrend, sample, decided },
    avgRR: { current: avgRR, trend: avgRRTrend, sample },
    profitFactor: { current: profitFactor, trend: profitFactorTrend, sample },
    exitBehavior: { ratio: exitRatio, detail: analysis.exits },
    topConfirmations: analysis.confirmations.slice(0, MAX_CONFIRMATIONS),
    screenshotAvailability: {
      pct: closed.length > 0 ? (withScreenshots.length / closed.length) * 100 : 0,
      count: withScreenshots.length,
      totalClosed: closed.length,
    },
    notesObservations,
    recurringConditions: recurringPatterns.slice(0, MAX_RECURRING),
    changesVsPrevious: [],
  };

  if (previousProfile) {
    profile.changesVsPrevious = [
      diffField('strongestInstrument', previousProfile.strongestInstrument?.key ?? null, strongestInstrument?.key ?? null),
      diffField('weakestInstrument', previousProfile.weakestInstrument?.key ?? null, weakestInstrument?.key ?? null),
      diffField('strongestSession', previousProfile.strongestSession?.key ?? null, strongestSession?.key ?? null),
      diffField('direction.edge', previousProfile.direction.edge, direction.edge),
    ].filter((c): c is ProfileChange => c !== null);
  }

  return profile;
}
