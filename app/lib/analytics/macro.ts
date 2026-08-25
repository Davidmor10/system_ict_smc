// ─────────────────────────────────────────────────────────────────────────────
// Scheduled US releases — the days the market is moved by something other than
// the trader.
//
// WHY THIS IS NOT A NEWS FEED
//
// The obvious build is "fetch an economic calendar". That would give us CPI,
// FOMC, PPI, retail sales, every central bank — and one external dependency
// whose outage silently reclassifies history. A trade analysed on Tuesday as
// "a CPI day" and on Wednesday as "a quiet day", because a request failed, is
// worse than not having the feature: the trader cannot tell which run to
// believe.
//
// So this module computes only what is derivable from the calendar itself, and
// says nothing about the rest.
//
// WHAT IS DERIVABLE
//
// The US Employment Situation report ("NFP") is released at 08:30 America/New_York
// on the first Friday of most months. That is a date rule, not a data feed: it
// is the same answer on every machine, every run, forever, with no network and
// nothing to go stale.
//
// It is also, for index futures, the single largest scheduled mover of the
// month — which is why it is worth having on its own even without the rest.
//
// WHAT IS NOT, AND IS THEREFORE ABSENT
//
// FOMC decisions and CPI releases have no date rule. FOMC meets eight times a
// year on dates the Fed publishes years ahead; CPI lands somewhere in the
// second week on a day the BLS chooses. Both would have to be a hardcoded
// table, and a hardcoded table of dates nobody re-checks is a machine for
// producing confident wrong answers two years from now.
//
// `SCHEDULED_RELEASES` below is that table, deliberately empty, with the shape
// and the coverage window it would need. Fill it and the second comparison
// switches on by itself. Leave it and nothing claims to know about FOMC or CPI
// — including, and this is the point, never labelling an FOMC day "quiet".
//
// THE HONESTY RULE
//
// `firstFridayOfMonth` is exact — it is arithmetic on a calendar. Whether the
// BLS released on that exact Friday in a given month is a separate question
// this module does not claim to answer: in a handful of months the release
// slips to the second Friday. That is why every label here names the rule that
// was computed ("the first Friday of the month") and not the conclusion
// ("employment report day"). A slipped month dilutes the comparison — it puts
// a couple of ordinary days in the event group — which pushes any finding
// toward "no difference". It cannot manufacture a difference that is not
// there, and that is the direction an error is allowed to point.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { DEFAULT_TIMEZONE, todayISOInZone } from '../time/zone';

/** Where the US releases are timed from. Not the trader's zone — the release
 *  happens at a New York wall-clock time regardless of who is watching. */
export const RELEASE_ZONE = 'America/New_York';

/** 08:30 New York, the Employment Situation release time. */
export const NFP_RELEASE_LOCAL = '08:30';

/** The tight window around a release, in minutes before and after.
 *
 *  Asymmetric on purpose: the pre-release minutes are thin and hesitant, and
 *  the move itself is after the number prints. Half an hour before catches
 *  someone positioning into it; an hour after catches the move and its first
 *  retrace. */
export const WINDOW_BEFORE_MIN = 30;
export const WINDOW_AFTER_MIN  = 60;

// ── calendar arithmetic ──────────────────────────────────────────────────────

/** `YYYY-MM-DD` of the first Friday of the given month. Pure arithmetic on the
 *  proleptic Gregorian calendar — no zone, no clock, no ambiguity. */
export function firstFridayOfMonth(year: number, month1to12: number): string {
  // Day-of-week of the 1st, in UTC so no local zone can shift it.
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const dow = first.getUTCDay();          // 0=Sun .. 5=Fri
  const day = 1 + ((5 - dow + 7) % 7);    // walk forward to the first Friday
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** How far `zone`'s wall clock runs ahead of UTC at a given instant, in ms. */
function zoneOffsetMs(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  const hour = get('hour') === 24 ? 0 : get('hour');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asIfUtc - at.getTime();
}

/** The instant at which `zone`'s wall clock reads `dateISO hh:mm`.
 *
 *  The inverse of a timezone conversion, which `Intl` does not offer directly:
 *  it maps an instant to a wall clock, and we need the other direction. The
 *  offset depends on the instant we are solving for, so the first pass guesses
 *  with the offset at the naive instant and the second corrects it. Two passes
 *  are enough for every real zone — the correction only ever matters within a
 *  few hours of a DST transition, and one refinement lands inside it. */
export function wallClockToInstant(zone: string, dateISO: string, hhmm: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm]  = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  let ts = naive - zoneOffsetMs(zone, new Date(naive));
  ts     = naive - zoneOffsetMs(zone, new Date(ts));
  return new Date(ts);
}

/** The instant of the NFP release for the month containing `dateISO`. */
export function nfpInstantForMonth(year: number, month1to12: number): Date {
  return wallClockToInstant(RELEASE_ZONE, firstFridayOfMonth(year, month1to12), NFP_RELEASE_LOCAL);
}

/** Is `dateISO`, read on the trader's own calendar, the day the NFP release
 *  fell on for them?
 *
 *  Not a string comparison against the New York date. At 08:30 New York it is
 *  already the next day in Sydney, so a Sydney trader's "NFP day" is a
 *  different calendar square than a New York trader's. The release instant is
 *  computed once and then asked what day it was in the trader's zone. */
export function isReleaseDay(dateISO: string, zone: string = DEFAULT_TIMEZONE): boolean {
  const [y, m] = dateISO.split('-').map(Number);
  if (!y || !m) return false;
  // The release for this month, and for the neighbours — near a month boundary
  // the trader's local day for one of them can land in the other month.
  const candidates = [
    nfpInstantForMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1),
    nfpInstantForMonth(y, m),
    nfpInstantForMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1),
  ];
  return candidates.some(inst => todayISOInZone(zone, inst) === dateISO);
}

/** Minutes between the trade's entry and the release it is nearest to, or
 *  null when the trade carries no usable entry time.
 *
 *  Negative is before the release, positive after. */
export function minutesFromRelease(
  dateISO: string,
  timeHHmm: string,
  zone: string = DEFAULT_TIMEZONE,
): number | null {
  if (!/^\d{1,2}:\d{2}/.test(timeHHmm || '')) return null;
  const [y, m] = dateISO.split('-').map(Number);
  if (!y || !m) return null;

  const entry = wallClockToInstant(zone, dateISO, timeHHmm.slice(0, 5));
  const releases = [
    nfpInstantForMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1),
    nfpInstantForMonth(y, m),
    nfpInstantForMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1),
  ];
  let best: number | null = null;
  for (const r of releases) {
    const diff = (entry.getTime() - r.getTime()) / 60_000;
    if (best === null || Math.abs(diff) < Math.abs(best)) best = diff;
  }
  return best === null ? null : Math.round(best);
}

/** Was the trade entered inside the tight window around the release. */
export function isInReleaseWindow(
  dateISO: string,
  timeHHmm: string,
  zone: string = DEFAULT_TIMEZONE,
): boolean {
  const mins = minutesFromRelease(dateISO, timeHHmm, zone);
  if (mins === null) return false;
  return mins >= -WINDOW_BEFORE_MIN && mins <= WINDOW_AFTER_MIN;
}

// ── the table this module deliberately ships empty ───────────────────────────

export interface ScheduledRelease {
  /** `YYYY-MM-DD` in America/New_York — the date the release is announced on. */
  date: string;
  /** `HH:mm` America/New_York. FOMC decisions are 14:00; most data is 08:30. */
  at: string;
  kind: 'fomc' | 'cpi' | 'ppi' | 'other';
}

/** Dated releases that have no date rule.
 *
 *  Empty, and empty is a position rather than an omission: an entry here is a
 *  claim that a specific release happened on a specific day, and the only
 *  honest source for that claim is the Fed's and the BLS's own published
 *  schedules. Guessing them from memory is exactly the failure mode this file
 *  exists to avoid.
 *
 *  Fill it and `SCHEDULED_COVERAGE` together — the coverage window is what
 *  stops a trade from before the table starts being counted as a day on which
 *  nothing happened. */
export const SCHEDULED_RELEASES: readonly ScheduledRelease[] = [];

/** The date range `SCHEDULED_RELEASES` is complete for, or null when there is
 *  no table. Trades outside it are `unknown` to the dated comparison and are
 *  excluded from it — never filed under "quiet". */
export const SCHEDULED_COVERAGE: { from: string; to: string } | null = null;

export type ScheduledVerdict = 'release' | 'quiet' | 'unknown';

/** Where a trade sits relative to the dated table. `unknown` whenever the
 *  table cannot speak for that date, which is currently always. */
export function scheduledVerdict(dateISO: string, zone: string = DEFAULT_TIMEZONE): ScheduledVerdict {
  if (!SCHEDULED_COVERAGE) return 'unknown';
  if (dateISO < SCHEDULED_COVERAGE.from || dateISO > SCHEDULED_COVERAGE.to) return 'unknown';
  const hit = SCHEDULED_RELEASES.some(r => todayISOInZone(zone, wallClockToInstant(RELEASE_ZONE, r.date, r.at)) === dateISO);
  return hit ? 'release' : 'quiet';
}

// ── the split the analytics engine consumes ──────────────────────────────────

export interface MacroSplit {
  /** Trades taken on the trader's local day of the release. */
  releaseDay: TradeEntry[];
  /** Every other day. Complete — the day rule has no gaps. */
  otherDays: TradeEntry[];
  /** Trades entered inside the tight window, a subset of `releaseDay`. Only
   *  populated for trades that recorded an entry time. */
  inWindow: TradeEntry[];
  /** Trades with a usable time that were NOT in the window, on any day. The
   *  counterpart `inWindow` is compared against, so the comparison is between
   *  two groups measured the same way. */
  outOfWindow: TradeEntry[];
}

export function splitByRelease(trades: TradeEntry[], zone: string = DEFAULT_TIMEZONE): MacroSplit {
  const releaseDay: TradeEntry[] = [];
  const otherDays:  TradeEntry[] = [];
  const inWindow:   TradeEntry[] = [];
  const outOfWindow: TradeEntry[] = [];

  for (const t of trades) {
    if (!t.dateISO) continue;
    if (isReleaseDay(t.dateISO, zone)) releaseDay.push(t);
    else otherDays.push(t);

    if (minutesFromRelease(t.dateISO, t.time, zone) === null) continue;
    if (isInReleaseWindow(t.dateISO, t.time, zone)) inWindow.push(t);
    else outOfWindow.push(t);
  }

  return { releaseDay, otherDays, inWindow, outOfWindow };
}
