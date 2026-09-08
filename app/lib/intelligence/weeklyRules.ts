// ─────────────────────────────────────────────────────────────────────────────
// What the weekly report is allowed to claim, in one place.
//
// This number used to decide whether the report existed at all: below five
// closed trades in the week, the service returned null and no report was ever
// written. A trader who took four trades — a week that may have been exactly
// right — got no report and an explanation of the threshold instead, which
// turned their own restraint into a shortfall.
//
// The report is now always written. What this floor governs is narrower and
// honest: below it the report is factual — counts, the trades themselves, and
// a paragraph saying plainly what cannot be concluded from that many. At or
// above it, the model writes the full letter that compares weeks and names a
// mechanism.
//
// The constant is exported so the gate, the report, and the copy on screen all
// read the same number instead of somebody's memory of it.
// ─────────────────────────────────────────────────────────────────────────────

/** Closed trades needed IN THE CURRENT ISO WEEK before the weekly report may
 *  compare, explain, or conclude.
 *
 *  The window is the load-bearing half and the part traders miss: a full
 *  journal counts for nothing here. The full report compares this week against
 *  the last one, so it can only be written once this week has something in it.
 *  Below the floor the report is still written — it just stops at what was
 *  observed. */
export const MIN_TRADES_FOR_WEEKLY_CLAIMS = 5;
