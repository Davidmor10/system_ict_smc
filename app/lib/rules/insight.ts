// ─────────────────────────────────────────────────────────────────────────────
// Rule-card "computed logic" layer — turns already-computed performance/history
// numbers into the three per-rule presentation values the Rules page needs:
// an impact tag, a confidence level + percentage, and a one-sentence AI-style
// insight. Everything here is a pure function of numbers the app already
// computed elsewhere (RulePerformance, RuleHistory) — nothing is invented, and
// nothing ever claims a strong conclusion on a small sample.
//
// The per-rule "AI insight" is a heuristic over real data today, not a live
// model call — same "facts first" discipline as the rest of the app. Swapping
// it for an actual AI/backend call later only touches this file.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import type { RulePerformance } from './performance';
import type { Rule } from './types';
import { ruleTitle } from './types';

// ── Impact — association strength between keeping the rule and R, never shown
//    as more than "high/medium/low" until both sides clear the same sample
//    gate the rest of the performance section already uses (RulePerformance.hasEnough). ──

export type ImpactLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface RuleImpact {
  level: ImpactLevel;
  label: string;
  color: string;
}

const IMPACT_COLOR: Record<ImpactLevel, string> = {
  high: '#d4af37',
  medium: 'rgba(255,255,255,0.7)',
  low: 'rgba(255,255,255,0.4)',
  unknown: '#52525b',
};
const IMPACT_LABEL: Record<ImpactLevel, string> = {
  high: 'השפעה גבוהה',
  medium: 'השפעה בינונית',
  low: 'השפעה נמוכה',
  unknown: 'לא ידוע',
};

/** Always returns a tag — "unknown" (not hidden) until the comparison clears
    the same MIN_PER_SIDE gate the rest of the performance block uses. */
export function ruleImpact(perf: RulePerformance): RuleImpact {
  const level: ImpactLevel = !perf.hasEnough || perf.followedAvgR == null || perf.violatedAvgR == null
    ? 'unknown'
    : (() => {
        const delta = perf.followedAvgR! - perf.violatedAvgR!;
        if (delta >= 1.5) return 'high';
        if (delta >= 0.5) return 'medium';
        return 'low';
      })();
  return { level, label: IMPACT_LABEL[level], color: IMPACT_COLOR[level] };
}

// ── Confidence — how much weight the followed/violated split itself deserves,
//    based on how many times the rule was ever observed (followed OR violated),
//    not just the decided-R subset `hasEnough` gates. Saturates toward a 97%
//    cap that's only ever approached, never claimed, on a huge sample — and the
//    "high" *label* only ever applies once total observations clear 40, so a
//    small sample can never read as "high confidence" even if the curve's
//    numeric value is climbing. ──

export type RuleConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

export interface RuleConfidence {
  level: RuleConfidenceLevel;
  /** 0-97, or null when the rule has never been observed at all. */
  percent: number | null;
}

const CONFIDENCE_CAP = 97;
const CONFIDENCE_REF = 15; // "proportional to a 15-sample reference" per the low-confidence tier

const CONFIDENCE_LABEL: Record<RuleConfidenceLevel, string> = {
  high: 'ביטחון גבוה',
  medium: 'ביטחון בינוני',
  low: 'ביטחון נמוך',
  none: '—',
};

export function ruleConfidence(perf: RulePerformance): RuleConfidence {
  const total = perf.followedTrades + perf.violatedTrades;
  if (total === 0) return { level: 'none', percent: null };
  const percent = CONFIDENCE_CAP * (1 - 1 / (1 + total / CONFIDENCE_REF));
  const level: RuleConfidenceLevel = total >= 40 ? 'high' : total >= 15 ? 'medium' : 'low';
  return { level, percent };
}

export function confidenceLabel(c: RuleConfidence): string {
  const base = CONFIDENCE_LABEL[c.level];
  return c.percent == null ? base : `${base} · ${Math.round(c.percent)}%`;
}

// ── Per-rule AI insight — one sentence, grounded only in this rule's own
//    numbers. Checked in priority order: an active discipline risk (violations
//    clustering right after a loss) first, then a proven edge (a big R delta),
//    then a positive habit (near-total adherence), and only then the honest
//    "not enough data" fallback. ──

export interface RuleInsight {
  text: string;
  basis: 'after_loss' | 'delta' | 'adherence' | 'insufficient';
}

const AFTER_LOSS_MIN_VIOLATIONS = 3;
const AFTER_LOSS_RATIO = 0.6;
const STRONG_DELTA_R = 1.0;
const HIGH_ADHERENCE_MIN_TOTAL = 10;
const HIGH_ADHERENCE_MAX_VIOLATION_RATE = 0.15;

const INSUFFICIENT_INSIGHT: RuleInsight = { text: 'עדיין אין מספיק נתונים כדי לזהות דפוס אמין בחוק הזה.', basis: 'insufficient' };

/** Chronologically-last CLOSED (WIN/LOSS) trade strictly before `beforeDateISO`,
    from a list already sorted ascending by date+time — the day-level violation
    signal has no exact time, so "right before the violation" means the last
    decided trade on the last trading day before it. */
function lastClosedBefore(sortedClosed: TradeEntry[], beforeDateISO: string): TradeEntry | null {
  let last: TradeEntry | null = null;
  for (const t of sortedClosed) {
    if (t.dateISO >= beforeDateISO) break;
    last = t;
  }
  return last;
}

export function ruleInsight(rule: Rule, perf: RulePerformance, violationDates: string[], trades: TradeEntry[]): RuleInsight {
  void rule; // reserved for future per-rule phrasing (e.g. naming the rule); kept generic today, matching the spec's examples

  if (violationDates.length >= AFTER_LOSS_MIN_VIOLATIONS) {
    const closedSorted = [...trades]
      .filter(t => t.result === 'WIN' || t.result === 'LOSS')
      .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
    let afterLoss = 0;
    for (const d of violationDates) {
      if (lastClosedBefore(closedSorted, d)?.result === 'LOSS') afterLoss++;
    }
    if (afterLoss / violationDates.length >= AFTER_LOSS_RATIO) {
      return { text: 'רוב ההפרות של החוק הזה קורות מיד אחרי עסקה מפסידה — כנראה שההפסד מערער לך את המשמעת לרגע.', basis: 'after_loss' };
    }
  }

  if (perf.hasEnough && perf.followedAvgR != null && perf.violatedAvgR != null) {
    const delta = perf.followedAvgR - perf.violatedAvgR;
    if (delta >= STRONG_DELTA_R) {
      return { text: `שמירה על החוק הזה משפרת את ה-R הממוצע שלך בכ-${delta.toFixed(1)}R — אחד ההרגלים המשתלמים ביותר שיש לך.`, basis: 'delta' };
    }
  }

  const total = perf.followedTrades + perf.violatedTrades;
  if (total >= HIGH_ADHERENCE_MIN_TOTAL && perf.violatedTrades / total <= HIGH_ADHERENCE_MAX_VIOLATION_RATE) {
    return { text: 'זהו אחד ההרגלים החזקים ביותר שלך — אתה עומד בחוק הזה כמעט תמיד.', basis: 'adherence' };
  }

  return INSUFFICIENT_INSIGHT;
}

// ── Dashboard-wide insights — 2-3 sentences about the whole rule set, for the
//    sidebar. Only ever returned once at least one rule has real data. ──

const MIN_CATEGORY_SAMPLE = 5;
const STRONG_CATEGORY_RATE = 0.7;
const WEAK_CATEGORY_RATE = 0.5;

export function dashboardRuleInsights(
  rules: Rule[],
  perfByRuleId: Map<string, RulePerformance>,
  catLabel: (category: string) => string,
): string[] {
  const withData = rules.filter(r => {
    const p = perfByRuleId.get(r.id);
    return !!p && p.followedTrades + p.violatedTrades > 0;
  });
  if (withData.length === 0) return [];

  const insights: string[] = [];

  const byCat = new Map<string, { followed: number; violated: number }>();
  for (const r of withData) {
    const p = perfByRuleId.get(r.id)!;
    const c = byCat.get(r.category) ?? { followed: 0, violated: 0 };
    c.followed += p.followedTrades;
    c.violated += p.violatedTrades;
    byCat.set(r.category, c);
  }
  const catRates = [...byCat.entries()]
    .map(([category, v]) => ({ category, total: v.followed + v.violated, rate: v.followed / (v.followed + v.violated) }))
    .filter(c => c.total >= MIN_CATEGORY_SAMPLE);

  if (catRates.length > 0) {
    const best = [...catRates].sort((a, b) => b.rate - a.rate)[0];
    if (best.rate >= STRONG_CATEGORY_RATE) {
      insights.push(`${catLabel(best.category)} הוא ההרגל החזק ביותר שלך — אתה עומד בו ${Math.round(best.rate * 100)}% מהזמן.`);
    }
  }

  let bestDelta: { rule: Rule; delta: number } | null = null;
  for (const r of withData) {
    const p = perfByRuleId.get(r.id)!;
    if (p.hasEnough && p.followedAvgR != null && p.violatedAvgR != null) {
      const delta = p.followedAvgR - p.violatedAvgR;
      if (delta >= STRONG_DELTA_R && (!bestDelta || delta > bestDelta.delta)) bestDelta = { rule: r, delta };
    }
  }
  if (bestDelta) {
    insights.push(`שמירה על "${ruleTitle(bestDelta.rule)}" משפרת את ה-R הממוצע שלך בכ-${bestDelta.delta.toFixed(1)}.`);
  }

  if (catRates.length > 1) {
    const worst = [...catRates].sort((a, b) => a.rate - b.rate)[0];
    if (worst.rate <= WEAK_CATEGORY_RATE) {
      insights.push(`${catLabel(worst.category)} הוא התחום שבו אתה נשבר הכי הרבה — ${Math.round(worst.rate * 100)}% עמידה בלבד.`);
    }
  }

  return insights.slice(0, 3);
}
