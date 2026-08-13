// ─────────────────────────────────────────────────────────────────────────────
// The sample floors, in one place. Pure — constants and one predicate.
//
// WHY THIS FILE EXISTS
//
// Onyx analyses the same trades through two independent stacks:
//
//   lib/intelligence   pattern discovery, trader profile, hypothesis, scores,
//                      the weekly narrative
//   lib/coach-pipeline the behaviour layer — detection, triggers, evidence
//                      tiers, experiments, the daily insight
//
// They answer different questions and both are wanted. What is not wanted is
// the two of them disagreeing about how much evidence it takes to say
// something out loud — a dashboard announcing an edge on the same morning the
// daily insight says there is not enough data yet. That contradiction is
// invisible in code review, because each side is individually reasonable; it
// only shows up on the screen, to the trader, at which point both surfaces
// lose their credibility together.
//
// So the floors live here and both stacks import them. A number that means the
// same thing in two places is defined once; numbers that genuinely mean
// different things are NOT forced together, and stay local to their module
// with their own reasoning attached.
// ─────────────────────────────────────────────────────────────────────────────

/** Decided trades a group needs before anything may be claimed about it.
 *
 *  Below this the arithmetic still runs and the result is still displayed —
 *  as a count, which is a fact — but no comparison, mechanism, edge or
 *  pattern may be asserted from it. Eight is where a two-sided exact test can
 *  first return something meaningfully small, and it is small enough that a
 *  trader reaches it in a normal fortnight.
 *
 *  Used by: pattern significance (analytics/patterns), the root-cause
 *  mechanism floor (intelligence/rootCause), and the behaviour layer's
 *  investigating threshold (coach-pipeline/behavior/evidence). */
export const MIN_DECIDED_FOR_CLAIM = 8;

/** Decided trades before a claim may be called established rather than
 *  provisional. Roughly a month of trading.
 *
 *  Used by: the behaviour layer's `confirmed` lifecycle step. */
export const MIN_DECIDED_FOR_CONFIRMED = 15;

/** Does this group carry enough decided trades to support a claim at all. */
export function canSupportClaim(decided: number): boolean {
  return decided >= MIN_DECIDED_FOR_CLAIM;
}
