// ─────────────────────────────────────────────────────────────────────────────
// Where a scrolling wheel column lands.
//
// Pure. Extracted from components/form/TimeField so it can be tested at all:
// the whole of it is arithmetic on a scroll offset, and the one thing that
// went wrong in it was arithmetic, not React.
//
// WHAT WENT WRONG. The first version refused a blocked row by springing the
// column back to the current value. That reads fine while the current value is
// legal — and traps anyone whose value is ALREADY above the ceiling. Change a
// trade's date from yesterday to today and 23:50 is suddenly hours after the
// exchange's own clock: every row between 23 and the ceiling springs back to
// 23, so the field cannot be corrected in either direction.
//
// Clamping has no such state. The worst a scroll can do is land on the
// ceiling, and from the ceiling every legal value is reachable.
// ─────────────────────────────────────────────────────────────────────────────

/** Which value a column of `values` is showing, given how far it is scrolled.
 *
 *  `itemPx` is the row height; the column is padded so that a scroll of
 *  `index * itemPx` centres row `index` — see the geometry assertion in
 *  tests/lib/datetimeCss.test.ts.
 *
 *  With a `ceiling`, anything past it resolves to the ceiling itself rather
 *  than to the value under the band. */
export function landedValue(
  values: readonly number[],
  scrollTop: number,
  itemPx: number,
  ceiling?: number,
): number {
  if (values.length === 0) return NaN;
  const raw = Math.round(scrollTop / itemPx);
  const i = Math.max(0, Math.min(values.length - 1, Number.isFinite(raw) ? raw : 0));
  return ceiling === undefined ? values[i] : Math.min(values[i], ceiling);
}
