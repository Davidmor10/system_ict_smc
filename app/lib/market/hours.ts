// ─────────────────────────────────────────────────────────────────────────────
// When the exchange is shut.
//
// Pure. No AI, no network, no async.
//
// IT VALIDATES THE TRADE, NOT THE CLOCK.
//
// The obvious reading of "block trades when the market is closed" is to lock
// the form on a Saturday. That would be the wrong feature: traders write up
// their week at the weekend, and a journal that refuses entries exactly when
// somebody sits down to catch up is a journal they stop using. What cannot be
// true is a trade that HAPPENED while the exchange was shut, and that is what
// this checks.
//
// ES AND NQ TRADE ON CME, whose week runs from Sunday evening to Friday
// evening New York time. In Israel that is a closure from Saturday 00:00 to
// Monday 01:00 — Friday is a full trading day, which is why the rule below
// does not name it.
//
// The daily maintenance break (an hour each evening) is deliberately NOT
// enforced. It shifts with US daylight saving, a trade logged a few minutes
// off would trip it, and refusing a real trade over a rounding error is worse
// than accepting one inside a one-hour gap.
// ─────────────────────────────────────────────────────────────────────────────

/** Day-of-week as JavaScript numbers them, for readability below. */
const SUN = 0, FRI = 5, SAT = 6;

/** When the weekly close begins, in the trader's zone. Saturday 00:00. */
export const CLOSE_DAY = SAT;
/** When the week reopens: Monday, at this hour. */
export const REOPEN_HOUR = 1;

export interface MarketClosure {
  /** Why, in the trader's language. */
  reason: string;
}

/** Is this moment inside the weekly closure?
 *
 *  `day` is 0–6 with Sunday as 0, and `hour` is a float on a 24h clock, both
 *  already resolved in the trader's own timezone — this function does no zone
 *  arithmetic of its own, because the wall clock is the trader's decision and
 *  is resolved once, in lib/time/zone.
 *
 *  Returns null when the market was open, so a caller can use it as a guard. */
export function closureAt(day: number, hour: number): MarketClosure | null {
  if (day === SAT) {
    return { reason: 'בשבת אין מסחר. הבורסה סוגרת בשישי בערב ופותחת שוב בלילה שבין ראשון לשני.' };
  }
  if (day === SUN && hour < 24) {
    // Sunday is closed all day in Israel time: the week reopens at 01:00 on
    // Monday, not on Sunday evening.
    return { reason: 'ביום ראשון אין מסחר. הבורסה פותחת בלילה שבין ראשון לשני, בערך ב-01:00.' };
  }
  if (day === 1 && hour < REOPEN_HOUR) {
    return { reason: 'בשעה הזאת הבורסה עוד סגורה. היא פותחת בערך ב-01:00 בלילה שבין ראשון לשני.' };
  }
  return null;
}

/** Parse a form's date and time and say whether that moment was closed.
 *
 *  Lenient about a missing or malformed time: a trader who has not filled the
 *  hour yet should get the day-level answer, not a validation error about a
 *  field they are still typing. */
export function closureFor(dateISO: string, time?: string | null): MarketClosure | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  // Constructed as UTC and read as UTC, so the day-of-week is the one written
  // on the form and never shifts with the runner's own timezone.
  const at = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(at.getTime())) return null;

  const parsed = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  const hour = parsed ? Number(parsed[1]) + Number(parsed[2]) / 60 : 12;

  return closureAt(at.getUTCDay(), hour);
}

/** Is this date in the future, relative to the trader's own today?
 *
 *  A separate question from the closure, and a more common mistake: a mistyped
 *  year puts a trade in 2035, and it then joins every statistic, trend and
 *  behaviour count as though it had happened. */
export function isFutureDate(dateISO: string, todayISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  return dateISO > todayISO;
}

export const FUTURE_REASON = 'התאריך הזה עוד לא הגיע. אפשר לתעד רק עסקה שכבר קרתה.';
export const FUTURE_TIME_REASON = 'השעה הזאת עוד לא הגיעה. אפשר לתעד רק עסקה שכבר קרתה.';

/** Minutes since midnight, or null if this is not a time. */
export function minutesOf(time: string | null | undefined): number | null {
  const hit = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!hit) return null;
  const h = Number(hit[1]), m = Number(hit[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Is this a moment later today than it is right now?
 *
 *  ONLY ON TODAY. A time of day says nothing on its own — 23:50 is perfectly
 *  ordinary on any day but this one — so the date has to match before the
 *  clock is consulted at all.
 *
 *  Silent when either value is missing or malformed: a trader mid-way through
 *  typing an hour is not making a mistake yet. */
export function isFutureTime(
  dateISO: string, time: string | null | undefined, todayISO: string, nowTime: string | null | undefined,
): boolean {
  if (dateISO !== todayISO) return false;
  const at = minutesOf(time);
  const now = minutesOf(nowTime);
  if (at === null || now === null) return false;
  return at > now;
}

/** Everything wrong with this date and time, or null when nothing is.
 *
 *  `nowTime` is the trader's own wall clock as HH:MM. Optional, and when it is
 *  left out the hour is simply not checked — the caller that has a clock is
 *  the form, and the callers that only have a date should not be made to
 *  invent one. */
export function dateProblem(
  dateISO: string,
  time: string | null | undefined,
  todayISO: string,
  nowTime?: string | null,
): string | null {
  // Ordered by how wrong it is. A date that has not arrived is a bigger
  // mistake than an hour that has not, and both are bigger than an hour the
  // exchange happened to be shut for.
  if (isFutureDate(dateISO, todayISO)) return FUTURE_REASON;
  if (isFutureTime(dateISO, time, todayISO, nowTime)) return FUTURE_TIME_REASON;
  return closureFor(dateISO, time)?.reason ?? null;
}
