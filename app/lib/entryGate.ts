// ─────────────────────────────────────────────────────────────────────────────
// The entry gate's arithmetic — the screen a member lands on after signing in.
//
// Everything here is pure and takes its "now" as an argument, because every one
// of these values is a countdown and a countdown you cannot freeze is a
// countdown you cannot test.
//
// This file used to also own the day's declared direction — read and written
// against the dashboard's daily plan record. That whole idea is gone: the
// direction is asked for once, on the trade itself. Two places that could each
// hold a direction for the same day is a disagreement waiting to be shipped.
//
// The plan record (`onyx_dash_planobj_<date>`) still exists and still holds the
// day's notes. Only the bias fields inside it are no longer read or written,
// and the ones already there are simply ignored — nothing is deleted from
// anybody's device to make this change.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rule } from './rules/types';

/** Two-digit pad, for the clocks below. */
const p2 = (n: number) => String(n).padStart(2, '0');

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
