// ─────────────────────────────────────────────────────────────────────────────
//  Israel-time (IDT) trading session windows — single source of truth.
//  Times are minutes-from-midnight in Asia/Jerusalem.
// ─────────────────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  label: string;
  start: number; // minutes from midnight (IDT)
  end: number;   // minutes from midnight (IDT)
}

export const SESSIONS: Session[] = [
  { id: 'ASIA',   label: 'אסיה',         start: 2 * 60,       end: 7 * 60       },
  { id: 'LONDON', label: 'לונדון',        start: 9 * 60,       end: 12 * 60      },
  { id: 'NY_AM',  label: 'ניו יורק AM',   start: 16 * 60,      end: 18 * 60 + 30 },
  { id: 'NY_PM',  label: 'ניו יורק PM',   start: 20 * 60 + 30, end: 23 * 60      },
];

const DAY = 24 * 3600;

/** Current Israel time as seconds-from-midnight + a HH:MM:SS clock string. */
export function israelClock(): { sec: number; clock: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  let h = g('hour');
  if (h === 24) h = 0; // some runtimes emit 24 at midnight
  const m = g('minute'), s = g('second');
  const p = (n: number) => String(n).padStart(2, '0');
  return { sec: h * 3600 + m * 60 + s, clock: `${p(h)}:${p(m)}:${p(s)}` };
}

export interface SessionStatus {
  inSession: boolean;
  remaining: number; // seconds until current session ends, or next session starts
  session: Session;  // the active session, or the upcoming one
}

/** Determine active/next session and the countdown (in seconds) from now. */
export function getSessionStatus(nowSec: number): SessionStatus {
  const active = SESSIONS.find(s => nowSec >= s.start * 60 && nowSec < s.end * 60);
  if (active) return { inSession: true, remaining: active.end * 60 - nowSec, session: active };

  const ordered = [...SESSIONS].sort((a, b) => a.start - b.start);
  const upcoming = ordered.find(s => s.start * 60 > nowSec);
  if (upcoming) return { inSession: false, remaining: upcoming.start * 60 - nowSec, session: upcoming };

  // Past the last session — next is the first session tomorrow.
  const first = ordered[0];
  return { inSession: false, remaining: DAY - nowSec + first.start * 60, session: first };
}

/** Format a positive seconds count as HH:MM:SS. */
export function fmtHMS(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
