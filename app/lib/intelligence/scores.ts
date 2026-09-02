// ─────────────────────────────────────────────────────────────────────────────
// Edge Score (quality of the trader's edge, NOT profitability) and Learning
// Score (is the trader improving over time). Pure arithmetic over an
// already-computed TraderProfile and its pattern rows — no model call, no
// trade reads.
//
// AN UNMEASURABLE FACTOR IS NULL. IT IS NOT 50.
//
// This file used to substitute a neutral 50 for every factor whose sample was
// too thin to read, and 70 for stability when there was no previous profile to
// compare against. Each substitution was locally reasonable and the total was
// not: a brand-new account, with no analysed pattern and nothing to compare
// against, scored 45 out of 100 on an edge nobody had measured.
//
// Worse than the number itself was what happened next. The moment a trader's
// data crossed a sample floor, the placeholder was replaced by a real reading,
// the score moved — and the Learning Score, which reads the change in this
// score, reported that movement AS LEARNING. A measurement starting to exist
// is not the trader improving.
//
// So every factor now reports `null` with a reason, the weight of what cannot
// be measured is redistributed across what can, and a score built from less
// than half its own definition is not returned at all. This is the policy the
// statistics screen's edge score has always used; the two implementations
// disagreed, and this one was wrong.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceLevel } from '../analytics';
import type { PatternMemoryRow, ScoreSnapshot, TraderProfile } from './types';

const TIER_SCORE: Record<ConfidenceLevel, number> = { low: 30, medium: 65, high: 100 };
/** How much weight the previous score keeps vs this run's fresh read —
    0.7/0.3 means a single update can move the score at most ~30% of the way
    to a completely different reading, enforcing "changes gradually." */
const EDGE_SCORE_SMOOTHING = 0.7;

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function average(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** Decided trades a group needs before the score is allowed to read anything
    into it. Matches the medium-confidence floor used everywhere else in the
    analytics layer. */
export const MIN_SPECIALIZATION_SAMPLE = 10;
/** Same floor, named for the other factor that needed it. */
export const MIN_CONFIRMATION_SAMPLE = MIN_SPECIALIZATION_SAMPLE;

/** Average win rate across the trader's main models, over the models with a
 *  sample worth averaging.
 *
 *  Null, not 50, when nothing qualifies: a win rate over three trades is a
 *  coin, and averaging three of them produces a confident-looking number out
 *  of nine trades. This factor carries real weight, so a placeholder here was
 *  the largest invented input to a score the trader reads as a measurement. */
function confirmationQualityScore(groups: Array<{ winRate: number; confidence: { sampleSize: number } }>): number | null {
  const eligible = groups.filter(g => g.confidence.sampleSize >= MIN_CONFIRMATION_SAMPLE);
  return eligible.length > 0 ? average(eligible.map(g => g.winRate)) : null;
}

/** The gap between a trader's best and worst group.
 *
 *  Null when either side is too small to compare: the spread between the max
 *  and min of several small samples is maximised by NOISE, not by skill. Two
 *  sessions of four trades each will routinely differ by fifty points for no
 *  reason at all, and the score would read that as a sharply specialized
 *  trader. */
function specializationScore(
  strongest: { winRate: number; confidence: { sampleSize: number } } | null,
  weakest: { winRate: number; confidence: { sampleSize: number } } | null,
): number | null {
  if (!strongest || !weakest) return null;
  if (strongest.confidence.sampleSize < MIN_SPECIALIZATION_SAMPLE) return null;
  if (weakest.confidence.sampleSize < MIN_SPECIALIZATION_SAMPLE) return null;
  return clamp01to100(strongest.winRate - weakest.winRate);
}

/** Caps profit factor before it enters any averaging/differencing — an
    Infinity (zero losses) must never poison a mean. */
function cappedPF(pf: number): number {
  return Number.isFinite(pf) ? Math.min(pf, 10) : 10;
}

// ── The factors ──────────────────────────────────────────────────────────────

export type EdgeFactorKey =
  | 'consistency' | 'recurring' | 'stability' | 'confirmation'
  | 'sessionSpecialization' | 'instrumentSpecialization' | 'sampleSize';

export interface EdgeFactor {
  key: EdgeFactorKey;
  /** Hebrew, for any surface that shows the breakdown. */
  label: string;
  /** Nominal weight. What it would carry if every factor were measurable. */
  weight: number;
  /** What it actually carried this run, after unmeasurable weight was
   *  redistributed. Zero for a factor that could not be read. */
  effectiveWeight: number;
  /** 0–100, or null when the data cannot answer this yet. */
  score: number | null;
  /** Why it is null, in the trader's language. */
  missing?: string;
}

export interface EdgeScoreBreakdown {
  /** Null when too little of the definition could be measured — see
   *  MIN_MEASURED_WEIGHT. */
  score: number | null;
  factors: EdgeFactor[];
  measured: number;
  total: number;
  /** Share of the nominal weight that was measurable, 0–1. */
  measuredWeight: number;
}

const FACTOR_WEIGHTS: Record<EdgeFactorKey, { weight: number; label: string }> = {
  consistency:             { weight: 0.20, label: 'עקביות הדפוסים' },
  recurring:               { weight: 0.15, label: 'דפוסים חוזרים' },
  stability:               { weight: 0.20, label: 'יציבות המגמה' },
  confirmation:            { weight: 0.15, label: 'איכות אישורי הכניסה' },
  sessionSpecialization:   { weight: 0.10, label: 'התמחות לפי סשן' },
  instrumentSpecialization:{ weight: 0.10, label: 'התמחות לפי מכשיר' },
  sampleSize:              { weight: 0.10, label: 'גודל המדגם' },
};

/** Below this share of the nominal weight, no score is returned at all.
 *
 *  Redistributing weight is honest while most of the definition is present.
 *  A number assembled from a quarter of what it claims to be is not a weak
 *  reading of the trader's edge — it is a different quantity wearing its
 *  name. */
export const MIN_MEASURED_WEIGHT = 0.5;

/** The quality-of-edge score, with its arithmetic in the open.
 *
 *  Returns the breakdown rather than a bare number so a caller can say WHY it
 *  is null, and so a screen can print each factor beside the total instead of
 *  asking the trader to trust one figure. */
export function computeEdgeScore(
  profile: TraderProfile,
  patternRows: PatternMemoryRow[],
  previousScore: number | null,
  /** Absent on a trader's first run, which is exactly when a trend cannot
   *  exist — every trend defaults to 'flat', and scoring that as 70 invented
   *  a stability reading for an account with nothing to compare against. */
  hasPreviousProfile = true,
): EdgeScoreBreakdown {
  const analysed = patternRows.length > 0;
  const liveRows = patternRows.filter(p => p.status === 'active' || p.status === 'strengthening');
  const strongRows = liveRows.filter(p => p.currentConfidenceLevel !== 'low');

  const trendScore = (t: TraderProfile['winRate']['trend']) => (t === 'up' ? 100 : t === 'flat' ? 70 : 40);

  const bestTier = liveRows.reduce<ConfidenceLevel | null>((best, p) => {
    if (!best) return p.currentConfidenceLevel;
    return TIER_SCORE[p.currentConfidenceLevel] > TIER_SCORE[best] ? p.currentConfidenceLevel : best;
  }, null);

  const raw: Record<EdgeFactorKey, { score: number | null; missing?: string }> = {
    // No pattern rows means nothing was analysed. Zero live patterns out of
    // twenty analysed is a finding; zero out of zero is an empty table.
    consistency: analysed
      ? { score: (liveRows.length / patternRows.length) * 100 }
      : { score: null, missing: 'עוד לא נותחו דפוסים ביומן' },
    recurring: analysed
      ? { score: Math.min(100, strongRows.length * 20) }
      : { score: null, missing: 'עוד לא נותחו דפוסים ביומן' },
    stability: hasPreviousProfile
      ? { score: average([trendScore(profile.winRate.trend), trendScore(profile.avgRR.trend), trendScore(profile.profitFactor.trend)]) }
      : { score: null, missing: 'צריך תקופה קודמת להשוות אליה' },
    confirmation: (() => {
      const v = confirmationQualityScore(profile.topConfirmations);
      return v === null
        ? { score: null, missing: `אין אישור כניסה עם ${MIN_CONFIRMATION_SAMPLE} עסקאות לפחות` }
        : { score: v };
    })(),
    sessionSpecialization: (() => {
      const v = specializationScore(profile.strongestSession, profile.weakestSession);
      return v === null
        ? { score: null, missing: `צריך שני סשנים עם ${MIN_SPECIALIZATION_SAMPLE} עסקאות לפחות` }
        : { score: v };
    })(),
    instrumentSpecialization: (() => {
      const v = specializationScore(profile.strongestInstrument, profile.weakestInstrument);
      return v === null
        ? { score: null, missing: `צריך שני מכשירים עם ${MIN_SPECIALIZATION_SAMPLE} עסקאות לפחות` }
        : { score: v };
    })(),
    sampleSize: bestTier
      ? { score: TIER_SCORE[bestTier] }
      : { score: null, missing: 'אין עדיין דפוס פעיל למדוד את המדגם שלו' },
  };

  const keys = Object.keys(FACTOR_WEIGHTS) as EdgeFactorKey[];
  const measuredWeight = keys
    .filter(k => raw[k].score != null)
    .reduce((acc, k) => acc + FACTOR_WEIGHTS[k].weight, 0);

  const factors: EdgeFactor[] = keys.map(k => ({
    key: k,
    label: FACTOR_WEIGHTS[k].label,
    weight: FACTOR_WEIGHTS[k].weight,
    effectiveWeight: raw[k].score == null || measuredWeight === 0 ? 0 : FACTOR_WEIGHTS[k].weight / measuredWeight,
    score: raw[k].score,
    missing: raw[k].missing,
  }));

  const measured = factors.filter(f => f.score != null).length;
  const base = { factors, measured, total: factors.length, measuredWeight };

  if (measuredWeight < MIN_MEASURED_WEIGHT) return { ...base, score: null };

  const fresh = clamp01to100(factors.reduce((acc, f) => acc + f.effectiveWeight * (f.score ?? 0), 0));
  // Smoothing only applies between two real readings. Blending a fresh score
  // against a previous one that no longer exists would carry a number forward
  // past the point where it could still be justified.
  const score = previousScore === null
    ? Math.round(fresh)
    : Math.round(previousScore * EDGE_SCORE_SMOOTHING + fresh * (1 - EDGE_SCORE_SMOOTHING));

  return { ...base, score };
}

/** Is the trader improving over time — better avgRR, better profit factor, a
 *  strengthening edge score — by comparing the earlier half of the rolling
 *  history against the later half.
 *
 *  NULL, NOT 50, WHEN IT CANNOT SAY.
 *
 *  It used to return a neutral 50, with a docstring asking every caller to
 *  remember that this meant "cannot say yet". One of them did remember and
 *  the rest of the codebase had no way to tell the two apart — a 50 from an
 *  empty history and a 50 from a genuinely flat trader are the same number.
 *  Now they are different values, and no caller has to be careful.
 *
 *  Snapshots with no edge score are skipped rather than counted as zero: a run
 *  where the edge could not be measured is missing from the comparison, not
 *  evidence of a collapse in it. */
export function computeLearningScore(
  history: ScoreSnapshot[],
  currentEdgeScore: number | null,
): number | null {
  if (currentEdgeScore === null) return null;
  if (history.length < 2) return null;

  const half = Math.floor(history.length / 2);
  const earlier = history.slice(0, half);
  const later = history.slice(half);
  if (earlier.length === 0 || later.length === 0) return null;

  const earlierEdge = earlier.map(s => s.edgeScore).filter((n): n is number => n != null);
  if (earlierEdge.length === 0) return null;

  const avgRRDelta = average(later.map(s => s.avgRR)) - average(earlier.map(s => s.avgRR));
  const pfDelta = average(later.map(s => cappedPF(s.profitFactor))) - average(earlier.map(s => cappedPF(s.profitFactor)));
  const edgeScoreDelta = currentEdgeScore - average(earlierEdge);

  return Math.round(clamp01to100(50 + avgRRDelta * 15 + pfDelta * 8 + edgeScoreDelta * 0.5));
}
