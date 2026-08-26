// ─────────────────────────────────────────────────────────────────────────────
// "How many more trades until this counts?"
//
// The pattern engine's honest answer to most questions is "not yet". That is
// correct, and on its own it is useless: a trader told their London trades are
// not a pattern learns nothing about whether to keep watching or drop the
// idea. The difference between those two is the size of the gap, and the gap
// is computable.
//
// WHAT THIS DOES
//
// Takes the split as it stands — this group's wins and losses against the rest
// of the journal — and asks what the same split would look like with more
// trades in it. Both sides are scaled proportionally, the same exact test is
// re-run, and the first size that clears the same corrected threshold the
// engine uses is reported.
//
// WHAT IT IS NOT
//
// Not a prediction, and every sentence built from it has to keep saying so.
// It answers "if these rates hold" — never "you will find an edge at 45
// trades". A rate measured over fifteen trades is itself uncertain, and the
// true rate may sit closer to the baseline, in which case the real answer is
// larger than this one or does not exist. The number is a floor on the effort,
// not a promise about the outcome.
//
// It is still worth showing, because the alternative is silence, and silence
// reads as "this feature does not work".
// ─────────────────────────────────────────────────────────────────────────────

import { fisherExactTwoSided, bonferroni } from '../stats/fisher';
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';
import type { PatternCandidate } from './types';

/** Stop looking past this many decided trades in the group.
 *
 *  Beyond a few hundred the honest answer stops being a number and becomes
 *  "this difference is too small to settle by trading more" — which is itself
 *  the useful message, and is what `null` means here. */
export const MAX_PROJECTED_DECIDED = 400;

export interface SampleNeeded {
  /** Decided trades the GROUP would need, at the rate it shows today. */
  groupDecided: number;
  /** Decided trades across the whole journal, at today's proportions. */
  totalDecided: number;
  /** How many more than the journal holds right now. */
  additional: number;
}

export interface OutsideCounts { wins: number; losses: number }

/** The smallest same-shaped split that would clear the bar.
 *
 *  `comparisons` must be the count the engine actually corrected by, or the
 *  answer describes a test nobody ran.
 *
 *  Returns null when the candidate already passes, when there is nothing to
 *  scale, or when the difference is too small to settle within a sane horizon.
 *  All three are real states and none of them should be rendered as a number. */
export function sampleNeededFor(
  c: PatternCandidate,
  outside: OutsideCounts,
  comparisons: number,
  alpha: number,
): SampleNeeded | null {
  if (c.significant) return null;

  const inWins = c.metric.wins;
  const inLoss = c.metric.losses;
  const inDecided = inWins + inLoss;
  const outDecided = outside.wins + outside.losses;
  if (inDecided === 0 || outDecided === 0) return null;

  // A group with no difference at all from the rest cannot be established by
  // volume — more trades of the same thing keep it at no difference forever.
  const inRate  = inWins / inDecided;
  const outRate = outside.wins / outDecided;
  if (inRate === outRate) return null;

  const ratio = outDecided / inDecided;

  // Grow the group one decided trade at a time, holding both observed rates
  // and the group-to-rest proportion fixed. Rounding is the reason this is a
  // loop rather than a formula: Fisher works on whole counts, and the rounded
  // split does not move monotonically with size.
  for (let n = Math.max(inDecided + 1, MIN_DECIDED_FOR_CLAIM); n <= MAX_PROJECTED_DECIDED; n++) {
    const w = Math.round(n * inRate);
    const l = n - w;
    const outN = Math.max(1, Math.round(n * ratio));
    const ow = Math.round(outN * outRate);
    const ol = outN - ow;

    const p = fisherExactTwoSided(w, l, ow, ol);
    if (bonferroni(p, comparisons) < alpha) {
      const total = n + outN;
      return {
        groupDecided: n,
        totalDecided: total,
        additional: Math.max(0, total - (inDecided + outDecided)),
      };
    }
  }
  return null;
}

/** The candidate worth telling the trader about when nothing passed.
 *
 *  The one closest to the bar, which is the only one where "keep going" is
 *  honest advice. Ranking by adjusted p rather than by the size of the gap on
 *  purpose: a huge gap over four trades is further from being established than
 *  a modest one over thirty, and pointing a trader at the four would send them
 *  to chase noise. */
export function closestToSignificance(candidates: PatternCandidate[]): PatternCandidate | null {
  const contenders = candidates.filter(c => !c.significant && c.metric.wins + c.metric.losses > 0);
  if (!contenders.length) return null;
  return contenders.reduce((best, c) => (c.pAdjusted < best.pAdjusted ? c : best));
}
