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
