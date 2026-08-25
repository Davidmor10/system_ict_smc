// ─────────────────────────────────────────────────────────────────────────────
// The weekly report's entry rule, in one place.
//
// It lived as a private constant in the service while the empty-state message
// on screen quoted a different number entirely — the screen said three trades,
// the code required five. A trader with four closed trades this week was told
// the report would appear and then watched it not appear, with nothing to
// explain the gap.
//
// The rule is exported so the message is built from it rather than from
// somebody's memory of it.
// ─────────────────────────────────────────────────────────────────────────────

/** Closed trades needed IN THE CURRENT ISO WEEK before a weekly report is
 *  written.
 *
 *  The window is the load-bearing half and the part traders miss: a full
 *  journal counts for nothing here. The report compares this week against the
 *  last one, so it can only be written once this week has something in it. */
export const MIN_TRADES_FOR_WEEKLY = 5;
