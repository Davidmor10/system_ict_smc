// ─────────────────────────────────────────────────────────────────────────────
// Trigger analysis — WHEN does the mistake happen, and when doesn't it.
//
// Pure. No AI, no network, no async.
//
// This is the module the whole feature turns on. Everything before it counts
// behaviour; everything after it explains behaviour. The bridge is a 2×2
// table, built once per (mistake × context dimension × value):
//
//                          mistake     no mistake
//     after a loss             7            1
//     otherwise                2           10
//
// A trader who is told "you exit early 45% of the time" has a statistic. A
// trader who is told "88% after a loss, 17% otherwise" has somewhere to look.
//
// WHY THERE IS A REAL TEST IN HERE
//
// With ten or twenty trades, the difference between 88% and 17% can easily be
// four coin flips landing the same way. The brief's hardest requirement is
// that the system must never fabricate a reason, and the most likely way to
// break it is not a hallucinated sentence — it is an honest-looking table
// built from noise. Fisher's exact test is used rather than a chi-square
// approximation precisely because the samples are small; it is exact at any
// size, and it is cheap.
//
// And because we test roughly nine dimensions with several values each, some
// comparison will clear p < 0.05 by chance almost every time. The reported
// strength therefore uses a Bonferroni-adjusted p, scaled by the number of
// tests actually performed on this run. Raw p is reported alongside it, so a
// human can always see what was adjusted.
// ─────────────────────────────────────────────────────────────────────────────

import type { BehaviorTally } from './behaviors';
import {
  CONTEXT_DIMENSIONS,
  dimensionValue,
  type ContextDimension,
  type TradeContext,
} from './context';

/** A behaviour has to repeat before it is a pattern. Three is the product
 *  decision: below it, one bad afternoon becomes a diagnosis. */
export const MIN_TOTAL_OCCURRENCES = 3;
/** A group needs enough trades for its rate to mean anything. */
export const MIN_GROUP_OPPORTUNITIES = 4;
/** ...and enough of them must be occurrences, so a single event can't define
 *  a trigger all by itself. */
export const MIN_GROUP_OCCURRENCES = 2;
/** The comparison group needs the same courtesy — "always after a loss" says
 *  nothing if the trader has only ever traded after a loss. */
export const MIN_COMPARISON_OPPORTUNITIES = 4;
/** Rates must differ by at least this much in absolute terms. A 12-point gap
 *  on samples this size is not a finding, whatever the p-value says. */
export const MIN_LIFT = 0.25;

export type TriggerStrength = 'strong' | 'moderate' | 'weak';

export interface TriggerFinding {
  dimension:    ContextDimension;
  value:        string;
  /** Inside the group: occurrences, opportunities, rate. */
  withK:        number;
  withN:        number;
  withRate:     number;
  /** Everything else, which is what makes the number mean something. */
  withoutK:     number;
  withoutN:     number;
  withoutRate:  number;
  /** withRate − withoutRate, in rate points. */
  lift:         number;
  /** Two-sided Fisher exact. */
  pValue:       number;
  /** pValue × number of comparisons performed, capped at 1. */
  pAdjusted:    number;
  strength:     TriggerStrength;
}

// ── Fisher's exact test ─────────────────────────────────────────────────────
//
// Moved to lib/stats/fisher.ts. Re-exported here so this module's public
// surface is unchanged — and so the pattern-discovery stack, which had no
// significance test at all, can use the same one rather than a second
// implementation that drifts from this one.

export { fisherExactTwoSided } from '../../stats/fisher';
import { fisherExactTwoSided } from '../../stats/fisher';

// ── analysis ────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10_000) / 10_000; }

interface Candidate {
  dimension: ContextDimension;
  value:     string;
  a: number; b: number; c: number; d: number;
}

/** Every (dimension, value) split worth testing. Splits that cannot support a
 *  conclusion are dropped BEFORE any p-value is computed, so they never
 *  inflate the multiple-comparison correction — being strict about sample
 *  size shouldn't be punished by making the surviving findings look weaker. */
function candidates(
  tally: BehaviorTally,
  contexts: Map<string, TradeContext>,
): Candidate[] {
  const occurred = new Set(tally.events.map(e => e.tradeId));
  const out: Candidate[] = [];

  for (const dimension of CONTEXT_DIMENSIONS) {
    // value → [occurrences, opportunities]
    const groups = new Map<string, [number, number]>();
    for (const tradeId of tally.opportunityTradeIds) {
      const ctx = contexts.get(tradeId);
      if (!ctx) continue;                       // no context = not comparable
      const v = dimensionValue(ctx, dimension);
      const g = groups.get(v) ?? [0, 0];
      g[1] += 1;
      if (occurred.has(tradeId)) g[0] += 1;
      groups.set(v, g);
    }

    const totalK = [...groups.values()].reduce((s, g) => s + g[0], 0);
    const totalN = [...groups.values()].reduce((s, g) => s + g[1], 0);

    for (const [value, [k, n]] of groups) {
      const restK = totalK - k;
      const restN = totalN - n;

      if (n < MIN_GROUP_OPPORTUNITIES) continue;
      if (k < MIN_GROUP_OCCURRENCES) continue;
      if (restN < MIN_COMPARISON_OPPORTUNITIES) continue;
      if (Math.abs(k / n - restK / restN) < MIN_LIFT) continue;

      out.push({ dimension, value, a: k, b: n - k, c: restK, d: restN - restK });
    }
  }
  return out;
}

/** Rank order for ties: the dimension list is ordered so behavioural context
 *  ("after a loss") beats descriptive context ("on NQ"). When two splits
 *  explain the data equally well, say the more useful one. */
const DIMENSION_RANK = new Map<ContextDimension, number>(
  CONTEXT_DIMENSIONS.map((d, i) => [d, i]),
);

/** Find the conditions under which a mistake concentrates.
 *
 *  Returns every qualifying trigger, strongest first. An empty array is a
 *  real and common answer: it means the behaviour is spread evenly across
 *  every context we can see, and the honest reading of that is "we don't know
 *  when this happens" — not "it happens everywhere". */
export function analyzeTriggers(
  tally: BehaviorTally,
  contexts: Map<string, TradeContext>,
): TriggerFinding[] {
  if (tally.occurrences < MIN_TOTAL_OCCURRENCES) return [];

  const cands = candidates(tally, contexts);
  if (!cands.length) return [];

  // Bonferroni over the comparisons actually made. Testing nine dimensions
  // with several values each, something clears p < 0.05 by luck almost every
  // run; without this the system would confidently name a trigger every time
  // it looked, which is precisely the failure the brief forbids.
  const tests = cands.length;

  const findings: TriggerFinding[] = cands.map(c => {
    const withN = c.a + c.b;
    const withoutN = c.c + c.d;
    const withRate = c.a / withN;
    const withoutRate = c.c / withoutN;
    const p = fisherExactTwoSided(c.a, c.b, c.c, c.d);
    const pAdj = Math.min(1, p * tests);

    const strength: TriggerStrength =
      pAdj <= 0.05 && withN >= 8 ? 'strong'
      : pAdj <= 0.25 && withN >= 5 ? 'moderate'
      : 'weak';

    return {
      dimension:   c.dimension,
      value:       c.value,
      withK:       c.a,
      withN,
      withRate:    round2(withRate),
      withoutK:    c.c,
      withoutN,
      withoutRate: round2(withoutRate),
      lift:        round2(withRate - withoutRate),
      pValue:      round4(p),
      pAdjusted:   round4(pAdj),
      strength,
    };
  });

  const strengthRank: Record<TriggerStrength, number> = { strong: 0, moderate: 1, weak: 2 };
  return findings.sort((x, y) =>
    strengthRank[x.strength] - strengthRank[y.strength]
    || (DIMENSION_RANK.get(x.dimension)! - DIMENSION_RANK.get(y.dimension)!)
    || Math.abs(y.lift) - Math.abs(x.lift)
    || x.value.localeCompare(y.value),
  );
}

/** The single trigger worth telling the trader about, or null when the data
 *  supports none. Null is a first-class result — step 3 turns it into a
 *  question rather than a guess. */
export function bestTrigger(
  tally: BehaviorTally,
  contexts: Map<string, TradeContext>,
): TriggerFinding | null {
  return analyzeTriggers(tally, contexts)[0] ?? null;
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __internals = { candidates };
