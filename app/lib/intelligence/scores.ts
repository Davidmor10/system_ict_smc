// ─────────────────────────────────────────────────────────────────────────────
// Edge Score (quality of the trader's edge, NOT profitability) and Learning
// Score (is the trader actually improving over time, not just "did they make
// money"). Both are 0-100, pure arithmetic over already-computed
// TraderProfile/PatternMemoryRow/ScoreSnapshot data — no LLM, no new trade
// reads. Edge Score is EMA-blended against its own previous value so it moves
// gradually instead of swinging after a single trade.
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
    sample worth averaging.
 *
 *  The floor was missing here while its neighbour below carried one, and the
 *  reasoning written there applies word for word: a win rate over three trades
 *  is a coin, and averaging three of them produces a confident-looking number
 *  out of nine trades. This factor is weighted more heavily than either
 *  specialization factor, so it was the largest unguarded input to a score the
 *  trader reads as a measurement of their edge.
 *
 *  Neutral 50 when nothing qualifies — the same posture as specialization: a
 *  trader with thin data should score neither high nor low on a question their
 *  data cannot answer. */
function confirmationQualityScore(groups: Array<{ winRate: number; confidence: { sampleSize: number } }>): number {
  const eligible = groups.filter(g => g.confidence.sampleSize >= MIN_CONFIRMATION_SAMPLE);
  return eligible.length > 0 ? average(eligible.map(g => g.winRate)) : 50;
}

/** The gap between a trader's best and worst group, or a neutral 50 when the
    two groups are too small for the gap to mean anything. */
function specializationScore(
  strongest: { winRate: number; confidence: { sampleSize: number } } | null,
  weakest: { winRate: number; confidence: { sampleSize: number } } | null,
): number {
  if (!strongest || !weakest) return 50;
  if (strongest.confidence.sampleSize < MIN_SPECIALIZATION_SAMPLE) return 50;
  if (weakest.confidence.sampleSize < MIN_SPECIALIZATION_SAMPLE) return 50;
  return clamp01to100(strongest.winRate - weakest.winRate);
}

/** Caps profit factor before it enters any averaging/differencing — an
    Infinity (zero losses) must never poison a mean. */
function cappedPF(pf: number): number {
  return Number.isFinite(pf) ? Math.min(pf, 10) : 10;
}

/** Pure: composite 0-100 quality-of-edge score from consistency, recurring
    profitable patterns, stability, confirmation quality, session/instrument
    specialization, and sample size — then smoothed against the previous
    stored score. */
export function computeEdgeScore(
  profile: TraderProfile,
  patternRows: PatternMemoryRow[],
  previousScore: number | null,
): number {
  const liveRows = patternRows.filter(p => p.status === 'active' || p.status === 'strengthening');

  const consistency = patternRows.length > 0 ? (liveRows.length / patternRows.length) * 100 : 50;

  const strongRows = liveRows.filter(p => p.currentConfidenceLevel !== 'low');
  const recurring = Math.min(100, strongRows.length * 20);

  const trendScore = (t: TraderProfile['winRate']['trend']) => (t === 'up' ? 100 : t === 'flat' ? 70 : 40);
  const stability = average([trendScore(profile.winRate.trend), trendScore(profile.avgRR.trend), trendScore(profile.profitFactor.trend)]);

  const confirmationQuality = confirmationQualityScore(profile.topConfirmations);

  // Specialization is the spread between the trader's best and worst group —
  // and the spread between the max and min of several small samples is
  // maximised by NOISE, not by skill. Two sessions of four trades each will
  // routinely differ by fifty points for no reason at all, and the score would
  // read that as a sharply specialized trader.
  //
  // So it only counts when both sides have a sample worth comparing; below
  // that the factor sits at its neutral value and contributes nothing either
  // way. A trader with thin data should score neither high nor low on a
  // question their data cannot answer.
  const sessionSpecialization = specializationScore(profile.strongestSession, profile.weakestSession);
  const instrumentSpecialization = specializationScore(profile.strongestInstrument, profile.weakestInstrument);

  const bestTier = liveRows.reduce<ConfidenceLevel | null>((best, p) => {
    if (!best) return p.currentConfidenceLevel;
    return TIER_SCORE[p.currentConfidenceLevel] > TIER_SCORE[best] ? p.currentConfidenceLevel : best;
  }, null);
  const sampleSizeScore = bestTier ? TIER_SCORE[bestTier] : 30;

  const raw = clamp01to100(
    consistency * 0.20 +
    recurring * 0.15 +
    stability * 0.20 +
    confirmationQuality * 0.15 +
    sessionSpecialization * 0.10 +
    instrumentSpecialization * 0.10 +
    sampleSizeScore * 0.10,
  );

  if (previousScore === null) return Math.round(raw);
  return Math.round(previousScore * EDGE_SCORE_SMOOTHING + raw * (1 - EDGE_SCORE_SMOOTHING));
}

/** Pure: is the trader improving over time — better avgRR, better profit
    factor, a strengthening edge score — measured by comparing the first half
    of the rolling score history against the second half. Returns a neutral
    50 when there isn't enough history yet (fewer than 2 snapshots); callers
    must treat that as "can't say yet," not "no improvement." */
export function computeLearningScore(history: ScoreSnapshot[], currentEdgeScore: number): number {
  if (history.length < 2) return 50;

  const half = Math.floor(history.length / 2);
  const earlier = history.slice(0, half);
  const later = history.slice(half);

  const avgRRDelta = average(later.map(s => s.avgRR)) - average(earlier.map(s => s.avgRR));
  const pfDelta = average(later.map(s => cappedPF(s.profitFactor))) - average(earlier.map(s => cappedPF(s.profitFactor)));
  const edgeScoreDelta = currentEdgeScore - average(earlier.map(s => s.edgeScore));

  return Math.round(clamp01to100(50 + avgRRDelta * 15 + pfDelta * 8 + edgeScoreDelta * 0.5));
}
