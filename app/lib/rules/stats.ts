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
import { pointFloor } from '../stats/movement';

/** The smallest week-over-week move in compliance worth calling a direction,
 *  before the sample is taken into account. Raised to whatever one rule-day is
 *  worth on the thinner of the two weeks — see `weekTrendOf`. */
const WEEK_TREND_FLOOR = 3;

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
  /** week.rate − previousWeek.rate in percentage points, or null when there is
   *  no direction to report — either week unknown, or a move small enough that
   *  one rule-day explains it. */
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

/** A manual report for one (rule, day), carrying its evidence line and when it
 *  was made. */
interface Reported { status: 'followed' | 'violated'; evidence: string; at: number }

/** A day-level violation as the trade form and the rules page store it. */
export interface StoredViolation {
  ruleId: string;
  date:   string;
  /** When it was written. Absent on rows predating the sync stamp. */
  updatedAt?: number;
}

/** One rule's status on one day, with the evidence behind it. Automatic rules are
    judged from that day's trades (any violation makes the day a violation);
    manual rules from the stored report. */
function ruleDayDetail(rule: Rule, dayTrades: TradeEntry[], reported: Reported | undefined): { status: DayRuleStatus; evidence: string } {
  if (rule.verificationMode === 'automatic' && rule.conditionType) {
    let followedEvidence = '';
    for (const t of dayTrades) {
      const r = checkRule(rule, t, dayTrades);
      if (r.status === 'violated') return { status: 'violated', evidence: r.evidence };
      if (r.status === 'followed' && !followedEvidence) followedEvidence = r.evidence;
    }
    return followedEvidence ? { status: 'followed', evidence: followedEvidence } : { status: 'no_data', evidence: '' };
  }
  return reported ? { status: reported.status, evidence: reported.evidence } : { status: 'no_data', evidence: '' };
}

function ruleDayStatus(rule: Rule, dayTrades: TradeEntry[], reported: Reported | undefined): DayRuleStatus {
  return ruleDayDetail(rule, dayTrades, reported).status;
}

/** Shared lookup tables both the period rollup and the per-rule history need. */
function buildContext(trades: TradeEntry[], userChecks: RuleCheck[], legacyViolations: StoredViolation[]) {
  const byDay = new Map<string, TradeEntry[]>();
  for (const t of trades) { const a = byDay.get(t.dateISO); if (a) a.push(t); else byDay.set(t.dateISO, [t]); }

  // THE NEWEST REPORT WINS, NOT THE ONE FROM A PARTICULAR SOURCE.
  //
  // Two things write a (rule, day) verdict: the trade form, when the trader
  // ticks which rules a trade broke, and the rules page, when they press
  // kept/broken on a rule card. This used to apply the violations first and
  // the rule-page checks second, so the ordering was by SOURCE — and a "kept"
  // pressed in the morning silently overrode a breach the trader recorded
  // against an actual trade that afternoon. The compliance rate then said the
  // rule was kept on a day the trader had told it otherwise.
  //
  // Ordered by when each was written instead. On an exact tie the violation
  // wins: a recorded breach is something the trader observed, and "kept" is
  // the absence of an observation.
  const reported = new Map<string, Reported>();
  const put = (key: string, next: Reported) => {
    const cur = reported.get(key);
    const newer = !cur || next.at > cur.at;
    const tieToViolation = cur != null && next.at === cur.at && next.status === 'violated';
    if (newer || tieToViolation) reported.set(key, next);
  };
  for (const v of legacyViolations) {
    put(`${v.ruleId}:${v.date}`, { status: 'violated', evidence: 'דווח ידנית כהופר', at: v.updatedAt ?? 0 });
  }
  for (const c of userChecks) {
    if (c.date && (c.status === 'followed' || c.status === 'violated')) {
      put(`${c.ruleId}:${c.date}`, {
        status: c.status,
        evidence: c.evidence || '',
        at: c.updatedAt ?? c.detectedAt ?? 0,
      });
    }
  }
  return { byDay, reported };
}

export interface RuleHistory {
  /** Most recent day the rule was kept / broken (ISO), or null within the lookback. */
  lastFollowed: string | null;
  lastViolated: string | null;
  /** Consecutive kept days back from today, stopping at the first violation. */
  streak: number;
  /** Most recent violations with their evidence, newest first (max 3). */
  recentViolations: { date: string; evidence: string }[];
  /** Every violation date within the lookback, newest first — uncapped (unlike
      `recentViolations`), so pattern detection (e.g. "clusters after a loss")
      has the full picture, not just the 3 dates the UI lists. */
  violationDates: string[];
}

/** Per-rule timeline — powers the streak / last-kept / last-broken line and the
    "recent violations" list on the rule card. Pure; derived, never stored. */
export function computeRuleHistory(
  rule: Rule,
  trades: TradeEntry[],
  userChecks: RuleCheck[],
  todayISO: string,
  legacyViolations: StoredViolation[] = [],
  lookbackDays = 90,
): RuleHistory {
  const { byDay, reported } = buildContext(trades, userChecks, legacyViolations);
  let lastFollowed: string | null = null;
  let lastViolated: string | null = null;
  let streak = 0;
  let streakBroken = false;
  const recentViolations: { date: string; evidence: string }[] = [];
  const violationDates: string[] = [];

  for (let i = 0; i < lookbackDays; i++) {
    const date = isoMinusDays(todayISO, i);
    const d = ruleDayDetail(rule, byDay.get(date) ?? [], reported.get(`${rule.id}:${date}`));
    if (d.status === 'violated') {
      if (!lastViolated) lastViolated = date;
      if (recentViolations.length < 3) recentViolations.push({ date, evidence: d.evidence });
      violationDates.push(date);
      streakBroken = true;
    } else if (d.status === 'followed') {
      if (!lastFollowed) lastFollowed = date;
      if (!streakBroken) streak++;
    }
  }
  return { lastFollowed, lastViolated, streak, recentViolations, violationDates };
}

/** The week-over-week move, or null when it is not a move.
 *
 *  It was the raw difference of two rates, shown with an arrow and a colour. In
 *  a week where five rule-days were evaluated, one violation moves the rate
 *  twenty points — so the panel reported a direction, in green or red, off a
 *  single broken rule. The floor is raised to what one rule-day is worth on the
 *  thinner of the two weeks, which is the week the comparison rests on. */
function weekTrendOf(week: PeriodCompliance, prevWeek: PeriodCompliance): number | null {
  if (week.rate == null || prevWeek.rate == null) return null;
  const delta = week.rate - prevWeek.rate;
  const floor = pointFloor(WEEK_TREND_FLOOR, Math.min(week.evaluated, prevWeek.evaluated));
  // Strictly greater: a move of exactly one rule-day's worth is a move one
  // rule-day explains, which is the thing this floor exists to refuse.
  return Math.abs(delta) > floor ? delta : null;
}

export function computeRuleStats(
  rules: Rule[],
  trades: TradeEntry[],
  userChecks: RuleCheck[],
  todayISO: string,
  legacyViolations: StoredViolation[] = [],
): RuleStatsResult {
  const active = rules.filter(r => r.isActive);
  const { byDay, reported } = buildContext(trades, userChecks, legacyViolations);
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
  const weekTrend = weekTrendOf(week, prevWeek);

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
