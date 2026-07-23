import type { GroupPerformance } from './types';

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
  return { strongest, weakest };
}
