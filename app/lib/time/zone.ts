// ─────────────────────────────────────────────────────────────────────────────
// The clock the app runs on.
//
// Every "what day is it", "which session is open", and "is this trade today"
// used to resolve against the browser's own timezone or a hardcoded
// Asia/Jerusalem, and the settings page offered a free-text box whose value
// nothing ever read. So a trader could type "Mars" and the app would store it,
// display it back, and keep running on Israel time regardless.
//
// This module is the single answer to "what time is it for THIS trader". It is
// deliberately synchronous and localStorage-backed: session detection and date
// stamping happen during render, and an async read would make the journal
// briefly disagree with itself about what day it is.
// ─────────────────────────────────────────────────────────────────────────────

/** Must match SETTINGS_KEY in lib/settings/types.ts. Deliberately not imported
 *  from there: that module calls `resolveZone` below to migrate an old doc, and
 *  importing back would make the two files a cycle. The same pattern the
 *  collections route already uses for the notebook kind. */
const SETTINGS_KEY = 'onyx_user_settings_v1';

/** The default, and the fallback for anything unrecognised. */
export const DEFAULT_TIMEZONE = 'Asia/Jerusalem';

export interface ZoneOption {
  /** IANA identifier — the only form ever stored. */
  id: string;
  /** What the picker shows. */
  label: string;
  /** Grouping in the picker. */
  group: string;
}

/** The offered zones.
 *
 *  A curated list rather than the full IANA database: the trader is choosing
 *  which market clock they keep, and the ~400-entry raw list buries the six
 *  answers that matter under hundreds of administrative aliases. Every entry
 *  here is a real IANA id, so `Intl` resolves it and DST is handled by the
 *  platform rather than by an offset we would have to maintain. */
export const ZONES: readonly ZoneOption[] = [
  { id: 'Asia/Jerusalem',    label: 'ישראל · ירושלים',            group: 'ברירת מחדל' },

  { id: 'America/New_York',  label: 'ניו יורק · US Eastern',       group: 'ארה״ב' },
  { id: 'America/Chicago',   label: 'שיקגו · US Central',          group: 'ארה״ב' },
  { id: 'America/Denver',    label: 'דנוור · US Mountain',         group: 'ארה״ב' },
  { id: 'America/Los_Angeles', label: 'לוס אנג׳לס · US Pacific',   group: 'ארה״ב' },

  { id: 'Europe/London',     label: 'לונדון',                      group: 'אירופה' },
  { id: 'Europe/Berlin',     label: 'ברלין · פרנקפורט',            group: 'אירופה' },
  { id: 'Europe/Zurich',     label: 'ציריך',                       group: 'אירופה' },
  { id: 'Europe/Moscow',     label: 'מוסקבה',                      group: 'אירופה' },

  { id: 'Asia/Dubai',        label: 'דובאי',                       group: 'אסיה ואוקיאניה' },
  { id: 'Asia/Kolkata',      label: 'מומבאי · דלהי',               group: 'אסיה ואוקיאניה' },
  { id: 'Asia/Singapore',    label: 'סינגפור',                     group: 'אסיה ואוקיאניה' },
  { id: 'Asia/Hong_Kong',    label: 'הונג קונג',                   group: 'אסיה ואוקיאניה' },
  { id: 'Asia/Tokyo',        label: 'טוקיו',                       group: 'אסיה ואוקיאניה' },
  { id: 'Australia/Sydney',  label: 'סידני',                       group: 'אסיה ואוקיאניה' },

  { id: 'UTC',               label: 'UTC · זמן עולמי',             group: 'אחר' },
];

const ZONE_IDS = new Set(ZONES.map(z => z.id));

/** True when `Intl` can actually resolve the id. Guards against a stored value
 *  from an older build, a hand-edited localStorage, or a zone this runtime does
 *  not carry. */
export function isValidZone(id: string): boolean {
  if (!id) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/** Free-text labels written by the old settings field, mapped to real zones.
 *
 *  The previous input stored whatever was typed, and the default it shipped
 *  with was the string "Israel (Asia/Jerusalem)". Reading an IANA id out of
 *  these is what keeps an existing account from being silently reset to the
 *  default the first time it opens the new picker. */
export function resolveZone(stored: string | undefined | null): string {
  const raw = (stored ?? '').trim();
  if (!raw) return DEFAULT_TIMEZONE;
  if (ZONE_IDS.has(raw)) return raw;

  // "Israel (Asia/Jerusalem)" and friends — take the parenthesised id.
  const inParens = /\(([A-Za-z_]+\/[A-Za-z_+\-0-9]+)\)/.exec(raw)?.[1];
  if (inParens && isValidZone(inParens)) return inParens;

  // A bare id the curated list does not carry but the platform knows.
  if (/^[A-Za-z_]+\/[A-Za-z_+\-0-9]+$/.test(raw) && isValidZone(raw)) return raw;
  if (raw.toUpperCase() === 'UTC') return 'UTC';

  // Anything else was free text. It never meant anything; do not pretend it did.
  return DEFAULT_TIMEZONE;
}

// ── Reading the trader's choice ─────────────────────────────────────────────

/** The stored zone, read straight from the settings cache.
 *
 *  Never throws and never blocks. On the server, or before settings have been
 *  hydrated, this is the default — which is also what the previous hardcoded
 *  behaviour was, so nothing regresses while the doc loads. */
export function activeZone(): string {
  if (typeof window === 'undefined') return DEFAULT_TIMEZONE;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_TIMEZONE;
    const doc = JSON.parse(raw) as { timezone?: string; timezoneLabel?: string };
    const id = doc?.timezone ?? doc?.timezoneLabel;
    const resolved = resolveZone(id);
    return isValidZone(resolved) ? resolved : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// ── Clock helpers ───────────────────────────────────────────────────────────

function partsIn(zone: string, d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** `YYYY-MM-DD` for "today" in the trader's zone. */
export function todayISOInZone(zone: string = activeZone(), now: Date = new Date()): string {
  const p = partsIn(zone, now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hour of day as a float (13.5 = 13:30) in the trader's zone. */
export function hourFloatInZone(zone: string = activeZone(), now: Date = new Date()): number {
  const p = partsIn(zone, now);
  // Some engines emit '24' for midnight rather than '00'.
  const h = p.hour === '24' ? 0 : Number(p.hour);
  return h + Number(p.minute) / 60;
}

/** `HH:mm` right now, in the trader's zone. */
export function clockInZone(zone: string = activeZone(), now: Date = new Date()): string {
  const p = partsIn(zone, now);
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** The short name the zone is currently in — "IDT", "EST", "GMT+2". Shown next
 *  to the picker so the trader can confirm the choice took effect without
 *  waiting for a session to open. */
export function zoneAbbreviation(zone: string = activeZone(), now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(now);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function zoneLabel(zone: string): string {
  return ZONES.find(z => z.id === zone)?.label ?? zone;
}
