// ─────────────────────────────────────────────────────────────────────────────
// Fisher's exact test, two-sided. Pure.
//
// Lives here, outside both analysis stacks, because both need it and only one
// had it. The behaviour layer has tested every split against this since it was
// built; the pattern discovery that feeds the dashboard and "what actually
// works for you" tested nothing at all, and shipped the largest win-rate gap
// out of roughly a hundred overlapping slices as a finding.
//
// Exact rather than chi-square, for the reason that matters at this scale: a
// trader with thirty trades produces cells of two and three, and the
// approximation is not trustworthy there. This is.
// ─────────────────────────────────────────────────────────────────────────────

const LOG_FACT: number[] = [0, 0];
function logFactorial(n: number): number {
  for (let i = LOG_FACT.length; i <= n; i += 1) {
    LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  }
  return LOG_FACT[n];
}

/** Hypergeometric probability of one specific 2×2 table with fixed margins. */
function tableProbability(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  return Math.exp(
    logFactorial(a + b) + logFactorial(c + d) + logFactorial(a + c) + logFactorial(b + d)
    - logFactorial(n) - logFactorial(a) - logFactorial(b) - logFactorial(c) - logFactorial(d),
  );
}

/** Two-sided Fisher exact test.
 *
 *  Sums the probability of every table with these margins that is at least as
 *  unlikely as the one observed — the standard two-sided construction.
 *
 *  Returns 1 for a degenerate table (an empty row or column), which is the
 *  honest answer — with nothing to compare, nothing is surprising. */
export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  if (a < 0 || b < 0 || c < 0 || d < 0) return 1;
  const rowA = a + b, rowB = c + d, colA = a + c, colB = b + d;
  if (rowA === 0 || rowB === 0 || colA === 0 || colB === 0) return 1;

  const observed = tableProbability(a, b, c, d);
  // Floating point: a table mathematically equal to the observed one can come
  // back a hair larger and be wrongly excluded from the tail.
  const tolerance = observed * 1e-7;

  const lo = Math.max(0, colA - rowB);
  const hi = Math.min(rowA, colA);
  let total = 0;
  for (let x = lo; x <= hi; x += 1) {
    const p = tableProbability(x, rowA - x, colA - x, rowB - (colA - x));
    if (p <= observed + tolerance) total += p;
  }
  return Math.min(1, total);
}

/** Bonferroni: multiply by the number of comparisons actually performed.
 *
 *  Conservative, and chosen for that reason. The alternative failure — telling
 *  a trader that a slice of eight trades is their edge, and watching them size
 *  up on it — costs them money. Missing a real pattern for another month costs
 *  them a month. */
export function bonferroni(pValue: number, comparisons: number): number {
  return Math.min(1, pValue * Math.max(1, comparisons));
}
