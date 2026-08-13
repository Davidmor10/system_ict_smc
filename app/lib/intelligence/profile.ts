// ─────────────────────────────────────────────────────────────────────────────
// Pure Trader Profile derivation — arithmetic over an already-computed
// FullAnalysis, never a new statistic. Nothing here reaches an LLM directly;
// it only produces the facts the AI layer is later allowed to phrase.
// ─────────────────────────────────────────────────────────────────────────────

import type { FullAnalysis, GroupPerformance } from '../analytics';
import { pairedExtremes } from '../analytics/extremes';
import type { TradeEntry } from '../journal';
import { computeTrend } from './trend';
import type { PatternMemorySubjectSummary, ProfileChange, TraderProfile } from './types';

const SCHEMA_VERSION = 1;
const MIN_SAMPLE = 3;
const WIN_RATE_THRESHOLD = 3;   // percentage points
const AVG_RR_THRESHOLD = 0.15;  // R
const PROFIT_FACTOR_THRESHOLD = 0.2;
const MAX_NOTES = 5;
const MAX_CONFIRMATIONS = 3;
const MAX_RECURRING = 5;

/** Strongest/weakest by win rate, eligible at MIN_SAMPLE, requiring a real
    win-rate spread — a thin wrapper over the shared `pairedExtremes` so the
    "never the same group as both" guarantee lives in exactly one place. */
function extremesByWinRate(groups: GroupPerformance[]) {
  return pairedExtremes(groups, g => g.winRate, g => g.confidence.sampleSize >= MIN_SAMPLE, WIN_RATE_THRESHOLD);
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

  const { long, short } = analysis.direction;
  const bothQualify = long.confidence.sampleSize >= MIN_SAMPLE && short.confidence.sampleSize >= MIN_SAMPLE;
  const direction = {
    edge: (bothQualify
      ? (long.winRate > short.winRate ? 'long' : long.winRate < short.winRate ? 'short' : 'none')
      : 'none') as 'long' | 'short' | 'none',
    longWinRate: long.winRate,
    shortWinRate: short.winRate,
  };

  const { winRate, avgRR, profitFactor, avgWinner, avgLoser } = analysis.performance;
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
    winRate: { current: winRate, trend: computeTrend(winRate, previousProfile?.winRate.current ?? null, WIN_RATE_THRESHOLD) },
    avgRR: { current: avgRR, trend: computeTrend(avgRR, previousProfile?.avgRR.current ?? null, AVG_RR_THRESHOLD) },
    profitFactor: { current: profitFactor, trend: computeTrend(profitFactor, previousProfile?.profitFactor.current ?? null, PROFIT_FACTOR_THRESHOLD) },
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
