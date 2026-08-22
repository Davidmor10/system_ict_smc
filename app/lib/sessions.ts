import { hourFloatInZone } from './time/zone';

// ─────────────────────────────────────────────────────────────────────────────
// Trading sessions.
//
// These used to be four fixed windows in a `const`. They are now the trader's
// own: they can rename them, move the hours, switch one off, or add their own,
// and every part of the app that asks "which session is this" reads the table
// they configured. The four below are only what a fresh account starts with.
//
// Two things are deliberate:
//
//   · A window may WRAP past midnight (start 22, end 2). The old model could
//     not express that, which quietly ruled out how a lot of people actually
//     think about the Asian session.
//   · Everything resolves through the timezone in settings. A window is a wall
//     clock, and whose wall it is on is the trader's decision.
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionDef {
  /** Stable id. Stored on every trade, so it must never change under a trade
   *  that already carries it — renaming edits `he`, not this. */
  key: string;
  /** What the trader calls it. */
  he: string;
  /** Latin label, used where a mono/LTR line reads better. A custom session
   *  gets the Hebrew name here too rather than an empty string — several
   *  readers print it directly. */
  en: string;
  /** Window start, as an hour float on a 24h clock (16.5 = 16:30). */
  start: number;
  /** Window end. `end <= start` means the window wraps past midnight. */
  end: number;
  /** Off means "not a session I trade" — kept in the table so old trades
   *  filed under it still resolve to a name. */
  enabled: boolean;
}

/** What a fresh account starts with. */
export const DEFAULT_SESSIONS: SessionDef[] = [
  { key: 'asia',   he: 'אסיה',        en: 'ASIA',   start: 2,  end: 7,  enabled: true },
  { key: 'london', he: 'לונדון',      en: 'LONDON', start: 9,  end: 12, enabled: true },
  { key: 'nyam',   he: 'ניו יורק AM', en: 'NY AM',  start: 16, end: 18, enabled: true },
  { key: 'nypm',   he: 'ניו יורק PM', en: 'NY PM',  start: 20, end: 23, enabled: true },
];

/** Kept for the many modules that only need the shipped defaults (server-side
 *  analysis, prompt building) and for anything that must not depend on a
 *  browser. Client code that shows or matches sessions uses sessionTable(). */
export const SESS = DEFAULT_SESSIONS;

export type SessionKey = string;

const SETTINGS_KEY = 'onyx_user_settings_v1';

const clampHour = (n: unknown, fallback: number): number => {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(24, Math.max(0, Math.round(v * 60) / 60));
};

/**
 * Coerce anything that came out of storage into a table the app can trust.
 *
 * A settings doc is user-editable and cross-device; it can arrive truncated,
 * half-migrated, or hand-edited. Every field is defaulted, keys are forced
 * unique, and an empty result falls back to the shipped table — an account
 * with zero sessions would otherwise file every trade under "no session" with
 * no way back through the UI.
 */
export function normalizeSessions(raw: unknown): SessionDef[] {
  if (!Array.isArray(raw)) return DEFAULT_SESSIONS.map(s => ({ ...s }));

  const seen = new Set<string>();
  const out: SessionDef[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<SessionDef>;
    const key = String(r.key ?? '').trim();
    const he = String(r.he ?? '').trim();
    if (!key || !he || seen.has(key)) continue;

    const start = clampHour(r.start, 0);
    const end = clampHour(r.end, 0);
    if (start === end) continue;              // a zero-width window matches nothing

    seen.add(key);
    out.push({
      key, he,
      en: typeof r.en === 'string' && r.en.trim() ? r.en.trim() : he,
      start, end,
      enabled: r.enabled !== false,
    });
  }

  return out.length > 0 ? out : DEFAULT_SESSIONS.map(s => ({ ...s }));
}

/**
 * The trader's session table.
 *
 * Read straight from the settings doc in localStorage rather than through the
 * settings module: this is called from pure helpers all over the app, on every
 * render and inside loops, and it must stay synchronous and dependency-free.
 * On the server, or before settings hydrate, it is the shipped default — which
 * is what the behaviour was before this was configurable, so nothing regresses
 * while the doc loads.
 */
export function sessionTable(): SessionDef[] {
  if (typeof window === 'undefined') return DEFAULT_SESSIONS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SESSIONS;
    const doc = JSON.parse(raw) as { sessions?: unknown };
    if (!doc?.sessions) return DEFAULT_SESSIONS;
    return normalizeSessions(doc.sessions);
  } catch {
    return DEFAULT_SESSIONS;
  }
}

/** The windows currently being matched against — the enabled ones. */
export function activeSessions(table: SessionDef[] = sessionTable()): SessionDef[] {
  return table.filter(s => s.enabled);
}

/** Does an hour fall inside this window, midnight-wrapping included. */
export function inSession(s: SessionDef, hourFloat: number): boolean {
  return s.end > s.start
    ? hourFloat >= s.start && hourFloat < s.end
    : hourFloat >= s.start || hourFloat < s.end;   // wraps past midnight
}

/** The clock the windows are read against — the timezone from settings. */
function zoneHourFloat(): number {
  return hourFloatInZone();
}

/** Pure: maps an hour (0-24) to an index in `table`, or -1. Shared by "what
 *  session is it right now" and "what session was this trade's entry in". */
export function sessionIdxForHour(hourFloat: number, table: SessionDef[] = activeSessions()): number {
  return table.findIndex(s => inSession(s, hourFloat));
}

/** Same, returning the key directly, or null. */
export function sessionForHour(hourFloat: number, table: SessionDef[] = activeSessions()): SessionKey | null {
  const idx = sessionIdxForHour(hourFloat, table);
  return idx >= 0 ? table[idx].key : null;
}

export function getActiveSessionIdx(): number {
  return sessionIdxForHour(zoneHourFloat());
}

export function getActiveSessionKey(): SessionKey | null {
  return sessionForHour(zoneHourFloat());
}

/** The name to show for a stored session key.
 *
 *  Looks through the whole table, disabled rows included: a trade filed under
 *  a session the trader has since switched off still has to render as that
 *  session and not as a raw key. */
export function sessionLabel(key: string | null | undefined, table: SessionDef[] = sessionTable()): string {
  if (!key || key === 'NONE') return 'ללא סשן';
  return table.find(s => s.key === key)?.he
    ?? DEFAULT_SESSIONS.find(s => s.key === key)?.he
    ?? key;
}

/** `HH:MM` for an hour float — the form the editor and the labels print. */
export function hourLabel(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Parse `HH:MM` back to an hour float. Returns null on anything else. */
export function parseHourLabel(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  const v = h + min / 60;
  return v > 24 ? null : v;
}

/** Windows that collide, as pairs of keys — the editor warns on these rather
 *  than refusing them, since a trade only ever lands in the first match. */
export function overlappingSessions(table: SessionDef[]): Array<[string, string]> {
  const on = table.filter(s => s.enabled);
  const clashes: Array<[string, string]> = [];
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      // Sample every quarter hour: cheap, and it catches wrapped windows that
      // interval arithmetic gets wrong at the midnight seam.
      for (let h = 0; h < 24; h += 0.25) {
        if (inSession(on[i], h) && inSession(on[j], h)) { clashes.push([on[i].key, on[j].key]); break; }
      }
    }
  }
  return clashes;
}
