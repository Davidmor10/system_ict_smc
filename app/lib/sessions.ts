/** Single source of truth for trading-session windows (Israel time). Shared by the
 * dashboard hero and the trade form so a trade's "session" always means the same thing. */
export const SESS = [
  { key: 'asia',   he: 'אסיה',        en: 'ASIA',   start: 2,  end: 7  },
  { key: 'london', he: 'לונדון',      en: 'LONDON', start: 9,  end: 12 },
  { key: 'nyam',   he: 'ניו יורק AM', en: 'NY AM',  start: 16, end: 18 },
  { key: 'nypm',   he: 'ניו יורק PM', en: 'NY PM',  start: 20, end: 23 },
] as const;

export type SessionKey = typeof SESS[number]['key'];

function getIdtHourFloat(): number {
  const idt = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  return idt.getHours() + idt.getMinutes() / 60;
}

/** Pure: maps an arbitrary Israel-time hour (0-24) to a session index, or -1
    if it falls outside every tracked window. Shared by "what session is it
    right now" (getActiveSessionIdx) and "what session was a logged trade's
    entry time in" (the trade form auto-detects instead of asking). */
export function sessionIdxForHour(hourFloat: number): number {
  return SESS.findIndex(s => hourFloat >= s.start && hourFloat < s.end);
}

/** Same as sessionIdxForHour but returns the key directly, or null. */
export function sessionForHour(hourFloat: number): SessionKey | null {
  const idx = sessionIdxForHour(hourFloat);
  return idx >= 0 ? SESS[idx].key : null;
}

export function getActiveSessionIdx(): number {
  return sessionIdxForHour(getIdtHourFloat());
}

/** Returns the session key for "right now", or null if outside all tracked windows. */
export function getActiveSessionKey(): SessionKey | null {
  const idx = getActiveSessionIdx();
  return idx >= 0 ? SESS[idx].key : null;
}

export interface SessionStatus {
  /** 'live' when `now` falls inside a session's window, else 'next'. */
  kind: 'live' | 'next';
  idx: number;
  /** Seconds until that session ends (if live) or starts (if next). Always > 0. */
  secondsLeft: number;
}

/** Seconds from `now`'s wall-clock time to the next occurrence of `targetHour`
    (0-24) today, wrapping to tomorrow if that hour has already passed. Reads
    only getHours/getMinutes/getSeconds, so it works whether `now` is a real
    Date or the "Israel wall-clock in a Date object" trick used below. */
function secondsUntilHour(now: Date, targetHour: number): number {
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const targetSec = targetHour * 3600;
  const diff = targetSec - nowSec;
  return diff > 0 ? diff : diff + 24 * 3600;
}

/** Pure: which session is live (and seconds until it ends), or — if none is —
    the soonest upcoming one (and seconds until it starts). `now`'s hour/minute/
    second are read as-is; callers pass Israel wall-clock time. */
export function sessionStatusForDate(now: Date): SessionStatus {
  const hourFloat = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const liveIdx = sessionIdxForHour(hourFloat);
  if (liveIdx >= 0) {
    return { kind: 'live', idx: liveIdx, secondsLeft: secondsUntilHour(now, SESS[liveIdx].end) };
  }
  let best = { idx: 0, wait: Infinity };
  SESS.forEach((s, i) => {
    const wait = secondsUntilHour(now, s.start);
    if (wait < best.wait) best = { idx: i, wait };
  });
  return { kind: 'next', idx: best.idx, secondsLeft: best.wait };
}

/** sessionStatusForDate() against the real current Israel time. */
export function getSessionStatus(): SessionStatus {
  return sessionStatusForDate(new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })));
}
