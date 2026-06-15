// ─────────────────────────────────────────────────────────────────────────────
// Date Engine — self-calculating trading-week range.
// Single source of truth for "which Mon–Fri window the macro terminal shows".
//
// Pure and deterministic: pass a `now` to evaluate any calendar position (tests,
// SSR pinning); defaults to the live system clock so callers get the *current*
// week for free. All math runs in UTC, anchored to the host's local calendar
// day, so labels and ISO dates never drift by a timezone (no off-by-one).
// ─────────────────────────────────────────────────────────────────────────────

/** A half-open-free inclusive ISO date window, `YYYY-MM-DD` .. `YYYY-MM-DD`. */
export interface DateRange {
  /** Range start (Monday), ISO `YYYY-MM-DD`. */
  startISO: string;
  /** Range end (Friday), ISO `YYYY-MM-DD`. */
  endISO: string;
}

export interface WeeklyRange extends DateRange {
  /** Display label, e.g. `JUN 15 – JUN 19`. */
  label: string;
  /** True when `now` fell on Sat/Sun and the range rolled to the next week. */
  rolledOverWeekend: boolean;
}

// ── Primitives ───────────────────────────────────────────────────────────────

/**
 * Pin a `Date` to UTC noon on the host's *local* calendar day. Using noon keeps
 * the day index stable under DST and any host timezone; using the local Y/M/D
 * keeps "today" matching the user's wall clock rather than the server's UTC day.
 */
function toUtcNoon(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
}

function addUtcDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift an ISO `YYYY-MM-DD` by `n` days, returning ISO. Timezone-stable. */
export function addIsoDays(iso: string, n: number): string {
  return toISODate(addUtcDays(new Date(`${iso}T12:00:00Z`), n));
}

function formatRangeLabel(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`.toUpperCase();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the active weekly range — the current Monday through the upcoming
 * Friday — for `now`.
 *
 * Weekend handling: Saturday and Sunday are not trading days, so the range rolls
 * FORWARD to the *upcoming* Monday–Friday rather than looking back at a week that
 * is already closed. `rolledOverWeekend` flags that this happened so the UI can
 * label the feed as next week's if it wants to. On Mon–Fri the range is simply
 * the Monday and Friday bracketing today.
 */
export function getWeeklyRange(now: Date = new Date()): WeeklyRange {
  const today = toUtcNoon(now);
  const dow = today.getUTCDay(); // 0 = Sun … 6 = Sat

  const rolledOverWeekend = dow === 0 || dow === 6;

  // Offset from `today` to this week's Monday. On the weekend, jump forward to
  // the next Monday instead of back into the finished week.
  let mondayOffset: number;
  if (dow === 0) mondayOffset = 1; // Sun → +1
  else if (dow === 6) mondayOffset = 2; // Sat → +2
  else mondayOffset = -(dow - 1); // Mon..Fri → back to this Monday

  const monday = addUtcDays(today, mondayOffset);
  const friday = addUtcDays(monday, 4);

  return {
    startISO: toISODate(monday),
    endISO: toISODate(friday),
    label: formatRangeLabel(monday, friday),
    rolledOverWeekend,
  };
}
