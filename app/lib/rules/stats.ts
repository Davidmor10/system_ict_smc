// ─────────────────────────────────────────────────────────────────────────────
// Rule-compliance statistics — pure, no I/O. Rolls the per-day, per-rule status
// (from the engine for automatic rules, from stored user reports for manual
// ones) into today / this-week / this-month compliance, a trend vs. the previous
// week, a clean-day streak, a daily series, and the most-broken rules.
//
// Honesty rules carried over: a day/rule with no signal is `no_data` (never
// counted as followed OR violated), and every rate is reported with the number
// of evaluated rule-days behind it so a tiny sample is never dressed up.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { ruleTitle, type Rule } from './types';
import type { RuleCheck } from './types';
import { checkRule } from './engine';

export type DayRuleStatus = 'followed' | 'violated' | 'no_data';

export interface PeriodCompliance {
  /** Rule-days the rule was kept. */
  followed: number;
  /** Rule-days the rule was broken. */
  violated: number;
  /** followed + violated — the sample the rate rests on. */
  evaluated: number;
  /** % of evaluated rule-days that were followed; null when nothing was evaluated. */
  rate: number | null;
  days: number;
}

export interface RuleStatsResult {
  today: PeriodCompliance;
  week: PeriodCompliance;
  month: PeriodCompliance;
  /** week.rate − previousWeek.rate (percentage points), or null if either is unknown. */
  weekTrend: number | null;
  /** Consecutive active days back from today with zero violations. */
  streak: number;
  /** Last 14 days, oldest → newest, for a sparkline. */
  daily: { date: string; rate: number | null; violated: number }[];
  /** Most-broken active rules over the last 30 days, most first (max 5). */
  topBroken: { ruleId: string; title: string; violated: number }[];
}

function isoMinusDays(iso: string, d: number): string {
  // UTC throughout so the string round-trips exactly (no local-tz day shift).
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - d);
  return dt.toISOString().slice(0, 10);
}
function daysRange(todayISO: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => isoMinusDays(todayISO, count - 1 - i));
}

function ruleDayStatus(rule: Rule, dayTrades: TradeEntry[], reported: 'followed' | 'violated' | undefined): DayRuleStatus {
  if (rule.verificationMode === 'automatic' && rule.conditionType) {
    let anyFollowed = false;
    for (const t of dayTrades) {
      const st = checkRule(rule, t, dayTrades).status;
      if (st === 'violated') return 'violated';
      if (st === 'followed') anyFollowed = true;
    }
    return anyFollowed ? 'followed' : 'no_data';
  }
  return reported ?? 'no_data';
}

export function computeRuleStats(
  rules: Rule[],
  trades: TradeEntry[],
  userChecks: RuleCheck[],
  todayISO: string,
  legacyViolations: { ruleId: string; date: string }[] = [],
): RuleStatsResult {
  const active = rules.filter(r => r.isActive);

  const byDay = new Map<string, TradeEntry[]>();
  for (const t of trades) { const a = byDay.get(t.dateISO); if (a) a.push(t); else byDay.set(t.dateISO, [t]); }

  // Manual report status per (ruleId, date). Legacy day-violations first, then
  // newer user checks override them.
  const reported = new Map<string, 'followed' | 'violated'>();
  for (const v of legacyViolations) reported.set(`${v.ruleId}:${v.date}`, 'violated');
  for (const c of userChecks) {
    if (c.date && (c.status === 'followed' || c.status === 'violated')) reported.set(`${c.ruleId}:${c.date}`, c.status);
  }
  const lookup = (ruleId: string, date: string) => reported.get(`${ruleId}:${date}`);

  const period = (days: string[]): PeriodCompliance => {
    let followed = 0, violated = 0;
    for (const date of days) {
      const dt = byDay.get(date) ?? [];
      for (const rule of active) {
        const st = ruleDayStatus(rule, dt, lookup(rule.id, date));
        if (st === 'followed') followed++;
        else if (st === 'violated') violated++;
      }
    }
    const evaluated = followed + violated;
    return { followed, violated, evaluated, rate: evaluated ? (followed / evaluated) * 100 : null, days: days.length };
  };

  const dayCounts = (date: string): { followed: number; violated: number } => {
    const dt = byDay.get(date) ?? [];
    let followed = 0, violated = 0;
    for (const rule of active) {
      const st = ruleDayStatus(rule, dt, lookup(rule.id, date));
      if (st === 'followed') followed++;
      else if (st === 'violated') violated++;
    }
    return { followed, violated };
  };

  const today = period([todayISO]);
  const week = period(daysRange(todayISO, 7));
  const prevWeek = period(daysRange(isoMinusDays(todayISO, 7), 7));
  const month = period(daysRange(todayISO, 30));
  const weekTrend = week.rate != null && prevWeek.rate != null ? week.rate - prevWeek.rate : null;

  // Clean-day streak — consecutive active days (back from today) with no violations.
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    const { followed, violated } = dayCounts(isoMinusDays(todayISO, i));
    if (violated > 0) break;
    if (followed > 0) streak++;
  }

  const daily = daysRange(todayISO, 14).map(date => {
    const { followed, violated } = dayCounts(date);
    const evaluated = followed + violated;
    return { date, rate: evaluated ? (followed / evaluated) * 100 : null, violated };
  });

  // Most-broken active rules over the last 30 days.
  const brokenById = new Map<string, number>();
  for (const date of daysRange(todayISO, 30)) {
    const dt = byDay.get(date) ?? [];
    for (const rule of active) {
      if (ruleDayStatus(rule, dt, lookup(rule.id, date)) === 'violated') {
        brokenById.set(rule.id, (brokenById.get(rule.id) ?? 0) + 1);
      }
    }
  }
  const topBroken = [...brokenById.entries()]
    .map(([ruleId, violated]) => ({ ruleId, violated, title: ruleTitle(active.find(r => r.id === ruleId)!) }))
    .sort((a, b) => b.violated - a.violated)
    .slice(0, 5);

  return { today, week, month, weekTrend, streak, daily, topBroken };
}
