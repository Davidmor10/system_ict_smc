// ─────────────────────────────────────────────────────────────────────────────
// Moving a wall clock from one zone to another.
//
// WHY THE IMPORTER NEEDS THIS
//
// A TradingView export carries times like "2026-09-08 16:56:00" with no zone
// on them. They are wall-clock readings in whatever zone the account's charts
// are set to. Onyx files a trade under a date and an hour in the TRADER's
// zone — the hour decides which session it belongs to — so an export read in
// the wrong zone does not fail loudly, it silently files every trade under the
// wrong session. That is the single most dangerous thing about this import.
//
// So the portfolio records the zone its file is in, and everything passes
// through here on the way in.
//
// Pure, and no Date parsing of the string form: `new Date('2026-09-08 16:56')`
// is implementation-defined and has been read as UTC by some engines and as
// local by others.
// ─────────────────────────────────────────────────────────────────────────────

/** Milliseconds a zone is ahead of UTC at a given instant. DST-aware, because
 *  it asks Intl what the clock actually reads there rather than assuming. */
function offsetMsAt(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);

  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  // hourCycle quirk: some engines render midnight as 24.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - at.getTime();
}

export interface WallClock {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

/** The instant at which a given zone's clock reads this wall time.
 *
 *  Two passes, and the second is not optional. The offset depends on the
 *  instant, and the instant is what we are solving for — one pass is wrong by
 *  an hour for any reading within an hour of a DST change.
 *
 *  An ambiguous reading (the hour that repeats when clocks go back) resolves to
 *  one of the two instants rather than raising: a journal that refuses to
 *  import a trade because it happened during the fold is worse than one that
 *  files it an hour out, once a year. */
export function wallClockToInstant(w: WallClock, zone: string): Date {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const first = naive - offsetMsAt(zone, new Date(naive));
  const second = naive - offsetMsAt(zone, new Date(first));
  return new Date(second);
}

/** What a zone's clock reads at a given instant. */
export function instantToWallClock(at: Date, zone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour') % 24, minute: get('minute'), second: get('second'),
  };
}

/** "2026-09-08 16:56:00" → its parts, or null when it is not that shape.
 *
 *  Strict on purpose. A row whose timestamp cannot be read must be reported to
 *  the trader, not guessed at — the whole point of the preview screen. */
export function parseWallClock(text: string): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const w: WallClock = {
    year: +m[1], month: +m[2], day: +m[3],
    hour: +m[4], minute: +m[5], second: m[6] ? +m[6] : 0,
  };
  if (w.month < 1 || w.month > 12 || w.day < 1 || w.day > 31) return null;
  if (w.hour > 23 || w.minute > 59 || w.second > 59) return null;
  return w;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateISO(w: WallClock): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
/** "16:56" — the journal's own time format. */
export function toHHMM(w: WallClock): string {
  return `${pad(w.hour)}:${pad(w.minute)}`;
}
/** "16:56:00" — kept where the seconds are part of what the trader sees. */
export function toHHMMSS(w: WallClock): string {
  return `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

/** Read a wall clock in `from` and re-express it in `to`. A no-op when the two
 *  zones agree, which is the common case and must not cost an Intl round trip
 *  or introduce a rounding difference. */
export function reinterpret(w: WallClock, from: string, to: string): WallClock {
  if (from === to) return w;
  return instantToWallClock(wallClockToInstant(w, from), to);
}
