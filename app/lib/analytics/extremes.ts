import type { GroupPerformance } from './types';
import { bonferroni, fisherExactTwoSided } from '../stats/fisher';
import { PATTERN_ALPHA } from './patterns';

/** Did the best and worst groups really differ, or is this the spread that any
 *  handful of equal groups produces?
 *
 *  THE SPREAD IS NOT THE TEST, and using it as one is how this file shipped.
 *  Picking the highest and lowest of several noisy win rates finds a gap every
 *  single time — that is what taking a maximum does. Simulated against a
 *  trader with an IDENTICAL true win rate in every session, the old
 *  three-point spread threshold named a best and a worst session on 89% of
 *  three-session histories and effectively 100% of anything larger. It got
 *  worse with more data, because more groups became eligible to be extreme.
 *
 *  Corrected for every pair the selection ranged over, not for one: the pair
 *  reported is the most extreme of them, and testing only it prices in none of
 *  the looking. */
export function winRateSeparated(
  strongest: GroupPerformance,
  weakest: GroupPerformance,
  pool: number,
): boolean {
  const comparisons = Math.max(1, (pool * (pool - 1)) / 2);
  const p = fisherExactTwoSided(strongest.wins, strongest.losses, weakest.wins, weakest.losses);
  return bonferroni(p, comparisons) < PATTERN_ALPHA;
}

/** The single, shared guarantee for every "strongest vs weakest" pair in the
    app — instrument, session, hour, weekday, week, or any future dimension.
    Strongest and weakest are ALWAYS different groups that genuinely differ:
    when only one group is eligible, or the two extremes are the same group, or
    the spread between them is below `minDelta`, `weakest` is null. This is what
    prevents any dimension from ever asserting the same subject as both a
    strength and a weakness (e.g. "your strength is MNQ" AND "you struggle with
    MNQ", or "best session NY AM" AND "weakest session NY AM") — a contradiction
    that must be impossible by construction, not caught case-by-case. */
export function pairedExtremes(
  groups: GroupPerformance[],
  value: (g: GroupPerformance) => number,
  isEligible: (g: GroupPerformance) => boolean,
  minDelta = 0,
  /** Whether the two extremes are far enough apart to be worth asserting,
   *  given how many groups the selection ranged over. Omitted only where the
   *  extreme is a historical fact rather than a tendency — "your best week was
   *  the week of the 12th" needs no test, because it is not a claim about what
   *  happens next. */
  separated?: (strongest: GroupPerformance, weakest: GroupPerformance, pool: number) => boolean,
): { strongest: GroupPerformance | null; weakest: GroupPerformance | null } {
  const pool = groups.filter(isEligible);
  if (pool.length === 0) return { strongest: null, weakest: null };

  const strongest = pool.reduce((best, g) => (value(g) > value(best) ? g : best));
  if (pool.length < 2) return { strongest, weakest: null };

  const weakest = pool.reduce((best, g) => (value(g) < value(best) ? g : best));
  // Same group, identical metric, or too small a spread → there is no honest
  // strong/weak split to draw, so we assert only the strength.
  if (weakest === strongest || value(strongest) === value(weakest) || value(strongest) - value(weakest) < minDelta) {
    return { strongest, weakest: null };
  }
  // ...and a spread that clears the threshold still has to clear the test.
  if (separated && !separated(strongest, weakest, pool.length)) {
    return { strongest, weakest: null };
  }
  return { strongest, weakest };
}
