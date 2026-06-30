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

export function getActiveSessionIdx(): number {
  const hf = getIdtHourFloat();
  return SESS.findIndex(s => hf >= s.start && hf < s.end);
}

/** Returns the session key for "right now", or null if outside all tracked windows. */
export function getActiveSessionKey(): SessionKey | null {
  const idx = getActiveSessionIdx();
  return idx >= 0 ? SESS[idx].key : null;
}
