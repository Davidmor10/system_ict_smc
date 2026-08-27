// ─────────────────────────────────────────────────────────────────────────────
// When a number moving counts as a direction.
//
// Two places compare a metric against its own past: the weekly period
// comparison (this week against last week) and the trader profile (this
// snapshot against the previous one). Both used to answer with a fixed
// threshold — three points of win rate, 0.15R, 0.2 of profit factor — and at a
// real trader's volume a fixed threshold is smaller than one trade. Six wins
// in ten against five in ten cleared it, and Fisher's exact test on that table
// returns p = 1.00: nothing at all, reported as a trend.
//
// The rule lives here so the two callers cannot drift apart on it, and so
// there is one place to read to find out what the product means by "up".
//
//   proportions (win rate)  — Fisher exact on the two win/loss splits,
//                             corrected for the tests performed in the pass.
//   means and ratios        — not proportions, so no test applies. The floor
//                             is raised to what one trade could account for:
//                             a mean of R moves by about 1/n, a ratio by about
//                             its own size over n.
//
// Both read the SMALLER of the two samples, because that is the one the claim
// is actually resting on.
// ─────────────────────────────────────────────────────────────────────────────

import { fisherExactTwoSided, bonferroni } from '../stats/fisher';

/** The decided split behind a win rate. A rate on its own cannot be tested. */
export interface DecidedSplit {
  wins:   number;
  losses: number;
}

/** How many significance tests one comparison pass performs — the divisor the
 *  correction is computed over.
 *
 *  One, and deliberately not three. Average R and profit factor are compared
 *  in the same pass, but neither goes through a test: they are means and
 *  ratios, and their false positives are held off by the one-trade floor
 *  instead. Multiplying the single p-value by the count of its untested
 *  siblings would not be a correction for multiplicity, it would be a penalty
 *  — and a large one at a real trader's volume: 8 wins in 10 against 3 in 10
 *  is p = 0.07, and tripling that buries a fifty point swing as "no change".
 *
 *  It stays a named constant, and stays inside `bonferroni`, so that adding a
 *  second tested metric raises it rather than being forgotten. */
const FISHER_TESTS = 1;

/** Looser than the 0.05 the pattern engine uses, and for a reason about what
 *  the number is for rather than about taste.
 *
 *  Pattern discovery searches roughly a hundred overlapping slices for the
 *  best one and then tells the trader it is their edge — a false positive
 *  there ends with someone sizing up on a coin flip, so it is corrected hard
 *  and judged strictly. This is one pre-specified comparison of two periods
 *  chosen by the calendar rather than by their result, and its output is a
 *  description. Nothing is recommended off it; the mechanism claim that gets
 *  explained to the trader sits behind its own sample floor in rootCause.
 *
 *  At a real trader's volume the difference decides whether the comparison can
 *  ever say anything: a fifty point swing over ten trades a side is p = 0.07,
 *  and calling that "no change" is its own kind of false report. */
const ALPHA = 0.10;

/** Did a win rate move by more than chance, between these two splits?
 *
 *  A degenerate table — a period with nothing decided — comes back p = 1 from
 *  the test itself, which is the honest answer: with nothing to compare,
 *  nothing is surprising. */
export function winRateMoved(now: DecidedSplit, before: DecidedSplit): boolean {
  const p = fisherExactTwoSided(now.wins, now.losses, before.wins, before.losses);
  return bonferroni(p, FISHER_TESTS) < ALPHA;
}

/** Decided trades in the smaller of the two samples. */
export function commonSample(now: DecidedSplit, before: DecidedSplit): number {
  return Math.min(now.wins + now.losses, before.wins + before.losses);
}

/** A floor no smaller than one trade's influence on a mean of R.
 *
 *  With no sample the floor is infinite, which reads as flat — correctly,
 *  since there is nothing there to have moved. */
export function meanFloor(fixed: number, n: number): number {
  return Math.max(fixed, n > 0 ? 1 / n : Infinity);
}

/** The same, for a ratio: one trade moves it by roughly its own size over n.
 *  A non-finite ratio (no losses at all) has no per-trade size to measure, so
 *  the fixed floor stands and `computeTrend` decides on the infinity itself. */
export function ratioFloor(fixed: number, current: number, n: number): number {
  if (n <= 0) return Infinity;
  if (!Number.isFinite(current)) return fixed;
  return Math.max(fixed, Math.abs(current) / n);
}
