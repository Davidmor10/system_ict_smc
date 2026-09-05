// ─────────────────────────────────────────────────────────────────────────────
// When a number moving counts as a direction.
//
// Several places compare a measurement against another one: the weekly period
// comparison (this week against last week), the trader profile (this snapshot
// against the previous one), the discipline panel (this week's compliance
// against last week's), a rule's average R when kept against when broken. They
// used to answer with a fixed
// threshold — three points of win rate, 0.15R, 0.2 of profit factor — and at a
// real trader's volume a fixed threshold is smaller than one trade. Six wins
// in ten against five in ten cleared it, and Fisher's exact test on that table
// returns p = 1.00: nothing at all, reported as a trend.
//
// The rule lives here — beside fisher.ts and evidence.ts, the shared home both
// analysis stacks already reach into — so the callers cannot drift apart on it,
// and so there is one place to read to find out what the product means by
// "up", "improves" or "better".
//
//   proportions (win rate)  — Fisher exact on the two win/loss splits,
//                             corrected for the tests performed in the pass.
//   means (average R)       — not a proportion, so Fisher does not apply. The
//                             floor is the standard error of the difference,
//                             read from how widely the trades were actually
//                             spread. It used to be 1/n, which assumed every
//                             trade lands about 1R from the mean; they land
//                             three times further, and 83% of identical weeks
//                             were reported as having moved.
//   ratios (profit factor)  — no test either, and no spread to read. The floor
//                             stays what one trade could account for: about
//                             the ratio's own size over n.
//
// The ratio floor reads the SMALLER of the two samples, because that is the one
// the claim is actually resting on; the mean floor reads both, because both
// contribute to how far the difference could have wandered.
// ─────────────────────────────────────────────────────────────────────────────

import { fisherExactTwoSided, bonferroni } from './fisher';

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
 *  since there is nothing there to have moved.
 *
 *  KEPT ONLY FOR CALLERS THAT HAVE NO SPREAD TO OFFER — a previous profile
 *  snapshot written before the spread was recorded, and nothing else. Prefer
 *  `meanDiffFloor`: 1/n is far too small for a mean of R, and the note below
 *  says by how much. */
export function meanFloor(fixed: number, n: number): number {
  return Math.max(fixed, n > 0 ? 1 / n : Infinity);
}

/** The mean of R, and how widely the trades behind it were spread. */
export interface MeanSample {
  n: number;
  /** Sample standard deviation, or null when there is nothing to spread. */
  sd: number | null;
}

/** Two-sided z at the ALPHA above. Not a t: at these sample sizes the
 *  difference is inside the noise the floor is guarding against anyway, and a
 *  named constant is easier to read than a table lookup. */
const Z = 1.645;

/** How far two average-R figures must differ before the difference is a
 *  direction rather than the spread of R showing through.
 *
 *  WHY 1/n WAS WRONG, AND BADLY. The old floor read "a mean of R moves by
 *  about 1/n", which is true only if every trade lands about 1R from the mean.
 *  They do not: a 3R winner and a 1R loser sit four apart, so the standard
 *  error over ten trades is near 0.45R while the floor it had to clear was
 *  0.15R. Simulated on two weeks drawn from ONE distribution — the same
 *  trader, the same edge, nothing changed — 83% of them were labelled as
 *  having moved. That label is not decoration: `avgRR.trend === 'down'` is
 *  what makes intelligence/rootCause name exit management as the mechanism,
 *  and the narrative then explains to the trader that they are cutting
 *  winners short.
 *
 *  So the floor comes from the spread of the trades themselves. `fixed` still
 *  applies underneath it — a difference smaller than that is not worth
 *  reporting however tight the sample. */
export function meanDiffFloor(fixed: number, now: MeanSample, before: MeanSample): number {
  if (now.n <= 0 || before.n <= 0) return Infinity;
  // No spread recorded on one side: fall back to the old floor rather than
  // asserting a move off a number that is not there.
  if (now.sd === null || before.sd === null) {
    return meanFloor(fixed, Math.min(now.n, before.n));
  }
  const se = Math.sqrt((now.sd ** 2) / now.n + (before.sd ** 2) / before.n);
  return Math.max(fixed, Z * se);
}

/** The same, for a rate expressed in percentage POINTS rather than as a
 *  fraction: one trade in a slice of n moves it by 100/n.
 *
 *  A slice of fifteen trades moves nearly seven points on a single result, so
 *  a fixed three-point floor over a rate is not a floor at all. */
export function pointFloor(fixed: number, n: number): number {
  return Math.max(fixed, n > 0 ? 100 / n : Infinity);
}

/** The same, for a ratio: one trade moves it by roughly its own size over n.
 *  A non-finite ratio (no losses at all) has no per-trade size to measure, so
 *  the fixed floor stands and `computeTrend` decides on the infinity itself. */
export function ratioFloor(fixed: number, current: number, n: number): number {
  if (n <= 0) return Infinity;
  if (!Number.isFinite(current)) return fixed;
  return Math.max(fixed, Math.abs(current) / n);
}
