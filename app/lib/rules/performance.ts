// ─────────────────────────────────────────────────────────────────────────────
// Per-rule performance — pure. Splits the journal into trades where the rule was
// FOLLOWED vs. VIOLATED and reports the average R of each side with the sample
// size + confidence. Automatic rules are judged on the fly by the engine; manual
// (user_report) rules use the stored user checks. `unknown` trades are excluded.
//
// This is an ASSOCIATION, never causation — the UI must present it as "when you
// kept the rule vs. when you broke it", with the sample size shown, and hide it
// entirely until both sides have enough decided trades.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { confidenceFor } from '../analytics';
import type { Confidence } from '../analytics/types';
import type { Rule, RuleCheck, RuleCheckStatus } from './types';
import { checkRule, type RuleCheckContext } from './engine';
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';
import { meanFloor } from '../stats/movement';

/** Each side needs at least this many decided (WIN/LOSS) trades before the
    comparison is shown.

    It was three. Three against three is a comparison of two coins, and it was
    put on screen beside a confidence label as though the label rescued it. The
    floor is the one the rest of the app already uses for a claim about a
    trader — see lib/stats/evidence, which exists so this number lives in one
    place instead of being chosen locally. */
export const MIN_PER_SIDE = MIN_DECIDED_FOR_CLAIM;

/** How much of a gap in average R is worth calling a gap, before the sample is
    taken into account. Raised to what one trade could account for on the
    thinner side — see `differenceIsReal`. */
const R_GAP_FLOOR = 0.15;

export interface RulePerformance {
  followedTrades: number;
  violatedTrades: number;
  /** Average realized R when the rule was kept / broken (null if no decided trades). */
  followedAvgR: number | null;
  violatedAvgR: number | null;
  /** Decided (WIN/LOSS) trades the comparison rests on. Always surfaced. */
  sampleSize: number;
  confidence: Confidence;
  /** True only when BOTH sides clear MIN_PER_SIDE — the gate for showing the compare. */
  hasEnough: boolean;
  /** True when the two averages are further apart than one trade on the
   *  thinner side could account for.
   *
   *  Separate from `hasEnough` on purpose, and this is the whole distinction:
   *  `hasEnough` says the two numbers are worth SHOWING side by side, and this
   *  says the gap between them is worth SAYING something about. Everything
   *  that turns the pair into a sentence has to read this one. */
  differenceIsReal: boolean;
}

function statusForTrade(
  rule: Rule,
  trade: TradeEntry,
  byDay: Map<string, TradeEntry[]>,
  userChecks: RuleCheck[],
  ctx: RuleCheckContext,
): RuleCheckStatus {
  if (rule.verificationMode === 'automatic' && rule.conditionType) {
    return checkRule(rule, trade, byDay.get(trade.dateISO) ?? [trade], ctx).status;
  }
  // Manual rule → a stored user check for this exact trade, else for its day.
  const c = userChecks.find(x => x.ruleId === rule.id && x.tradeId === trade.id)
    ?? userChecks.find(x => x.ruleId === rule.id && x.tradeId == null && x.date === trade.dateISO);
  return c ? c.status : 'unknown';
}

export function computeRulePerformance(
  rule: Rule,
  trades: TradeEntry[],
  userChecks: RuleCheck[] = [],
  ctx: RuleCheckContext = {},
): RulePerformance {
  const byDay = new Map<string, TradeEntry[]>();
  for (const t of trades) {
    const a = byDay.get(t.dateISO);
    if (a) a.push(t); else byDay.set(t.dateISO, [t]);
  }

  const followedR: number[] = [];
  const violatedR: number[] = [];
  let followedTrades = 0, violatedTrades = 0;
  for (const t of trades) {
    const st = statusForTrade(rule, t, byDay, userChecks, ctx);
    const decidedR = (t.result === 'WIN' || t.result === 'LOSS') && t.tradeR != null ? t.tradeR : null;
    if (st === 'followed') { followedTrades++; if (decidedR != null) followedR.push(decidedR); }
    else if (st === 'violated') { violatedTrades++; if (decidedR != null) violatedR.push(decidedR); }
  }

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sampleSize = followedR.length + violatedR.length;
  const followedAvgR = avg(followedR);
  const violatedAvgR = avg(violatedR);
  const hasEnough = followedR.length >= MIN_PER_SIDE && violatedR.length >= MIN_PER_SIDE;

  // The gap has to outgrow one trade on the thinner side. A mean over eight
  // trades moves by an eighth of a trade's R for every trade in it, so a gap
  // smaller than that is the last trade, not the rule.
  const thinner = Math.min(followedR.length, violatedR.length);
  const differenceIsReal = hasEnough && followedAvgR != null && violatedAvgR != null
    && Math.abs(followedAvgR - violatedAvgR) > meanFloor(R_GAP_FLOOR, thinner);

  return {
    followedTrades,
    violatedTrades,
    followedAvgR,
    violatedAvgR,
    sampleSize,
    confidence: confidenceFor(sampleSize),
    hasEnough,
    differenceIsReal,
  };
}
