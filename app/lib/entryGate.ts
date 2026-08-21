// ─────────────────────────────────────────────────────────────────────────────
// The entry gate's arithmetic — the screen a member lands on after signing in.
//
// Everything here is pure and takes its "now" as an argument, because every one
// of these values is a countdown and a countdown you cannot freeze is a
// countdown you cannot test.
//
// The bias helpers are the one exception: they touch localStorage, and they
// deliberately read and write the SAME record the dashboard's daily plan uses
// (`onyx_dash_planobj_<local date>`), so a direction declared here is the one
// `getTodaysDeclaredBias()` finds when the trade form opens. Writing a second
// store would have been easier and would have quietly split the truth in two.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rule } from './rules/types';

export type BiasChoice = 'bull' | 'bear' | 'neutral';

export const BIAS_META: Record<BiasChoice, { he: string; en: string; color: string }> = {
  bull:    { he: 'שורי',       en: 'BULLISH',    color: '#4a7c59' },
  bear:    { he: 'דובי',       en: 'BEARISH',    color: '#8b3a3a' },
  neutral: { he: 'חסר החלטה',  en: 'INDECISIVE', color: '#d4af37' },
};

const p2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in LOCAL time — the same key dailyBias.ts builds.
 *
 *  Not UTC, and not the settings timezone: dailyBias.ts uses the device's local
 *  date, and a key that disagrees with it by even an hour means the bias
 *  declared here cannot be found by the trade form. If that ever moves, both
 *  files move together. */
export function planDayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

export function planStorageKey(now: Date = new Date()): string {
  return `onyx_dash_planobj_${planDayKey(now)}`;
}

export interface DeclaredBias { bias: BiasChoice; at: number | null }

/** What the trader declared today, or null. */
export function readDeclaredBias(now: Date = new Date()): DeclaredBias | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(planStorageKey(now));
    if (!raw) return null;
    const o = JSON.parse(raw) as { bias?: string; biasAt?: number };
    if (!o || typeof o !== 'object') return null;
    const bias = o.bias as BiasChoice;
    if (!bias || !(bias in BIAS_META)) return null;
    return { bias, at: typeof o.biasAt === 'number' ? o.biasAt : null };
  } catch {
    return null;
  }
}

/**
 * Store today's direction.
 *
 * Read-modify-write, never overwrite: the plan object belongs to the dashboard
 * and carries fields this screen knows nothing about. Clobbering it would erase
 * the trader's plan to save a two-letter string.
 */
export function writeDeclaredBias(bias: BiasChoice, now: Date = new Date()): DeclaredBias {
  const at = now.getTime();
  if (typeof window !== 'undefined') {
    try {
      const key = planStorageKey(now);

      // Reading the old record gets its OWN try. A plan that got corrupted
      // must not stop today's declaration from being saved — there is simply
      // nothing left to preserve, so we start a fresh object and write.
      let doc: Record<string, unknown> = {};
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            doc = parsed as Record<string, unknown>;
          }
        }
      } catch { /* unreadable plan — overwritten below rather than lost twice */ }

      doc.bias = bias;
      doc.biasAt = at;
      window.localStorage.setItem(key, JSON.stringify(doc));
    } catch { /* private mode, quota — the in-page state still updates */ }
  }
  return { bias, at };
}

// ── Clocks ───────────────────────────────────────────────────────────────────

/** `HH:MM:SS` remaining until `targetHour` (a float, 16.5 = 16:30), wrapping
 *  past midnight. */
export function countdownTo(targetHour: number, nowHour: number): string {
  let delta = targetHour - nowHour;
  if (delta < 0) delta += 24;
  const total = Math.floor(delta * 3600);
  return `${p2(Math.floor(total / 3600))}:${p2(Math.floor(total / 60) % 60)}:${p2(total % 60)}`;
}

/** New York is treated as open between 16:30 and 23:00 in the app's session
 *  clock — the same window the journal stamps trades against. */
export const NY_OPEN_HOUR = 16.5;
export const NY_CLOSE_HOUR = 23;

export function isNewYorkOpen(nowHour: number): boolean {
  return nowHour >= NY_OPEN_HOUR && nowHour < NY_CLOSE_HOUR;
}

// ── Rule of the day ──────────────────────────────────────────────────────────

/**
 * One active rule, chosen by the date rather than at random.
 *
 * Stable within a day (reloading does not reshuffle it) and moves on across
 * days. Returns null when the trader has not written any active rule yet —
 * which is a real state on a new account, not an edge case.
 */
export function ruleOfTheDay(rules: Rule[], now: Date = new Date()): Rule | null {
  const active = rules.filter(r => r.isActive && !r.deleted);
  if (active.length === 0) return null;
  const seed = now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate();
  return active[seed % active.length];
}

// ── Macro ────────────────────────────────────────────────────────────────────

export interface MacroLike {
  title: string;
  impact: string;
  dateIsrael: string;
  timeIsrael: string;
  currency?: string;
}

export interface NextMacro {
  event: MacroLike;
  /** Whole minutes from now until the event. */
  minutes: number;
}

export const IMPACT_HE: Record<string, string> = {
  High: 'גבוהה', Medium: 'בינונית', Low: 'נמוכה', Holiday: 'חג',
};

const HHMM = /^(\d{1,2}):(\d{2})$/;

function minutesOfDay(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The next event that has not happened yet.
 *
 * All-day rows (the feed leaves `timeIsrael` empty for those) are skipped: this
 * cell is a countdown, and there is nothing to count down to.
 */
export function nextMacro(
  events: MacroLike[],
  todayISO: string,
  nowMinutes: number,
): NextMacro | null {
  let best: NextMacro | null = null;

  for (const e of events) {
    const at = minutesOfDay(e.timeIsrael ?? '');
    if (at === null) continue;
    const dayDelta = daysBetween(todayISO, e.dateIsrael);
    if (dayDelta === null || dayDelta < 0) continue;
    const minutes = dayDelta * 1440 + at - nowMinutes;
    if (minutes <= 0) continue;
    if (!best || minutes < best.minutes) best = { event: e, minutes };
  }

  return best;
}

/** "43 דק׳" under an hour and a half, "2 שע׳ 05 דק׳" beyond it. */
export function humanizeMinutes(mins: number): string {
  if (mins <= 90) return `${Math.max(1, mins)} דק׳`;
  return `${Math.floor(mins / 60)} שע׳ ${p2(mins % 60)} דק׳`;
}
