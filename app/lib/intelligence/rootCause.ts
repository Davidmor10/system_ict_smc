// ─────────────────────────────────────────────────────────────────────────────
// Root Cause Analysis — never stop at "win rate went down." Labels a single,
// evidence-backed candidate mechanism from metrics that are already computed
// (PeriodComparison + TraderProfile.exitBehavior), so the narrative prompt can
// explain WHY a number moved instead of just reporting it. Pure: no LLM, no
// invented numbers — only a classification over numbers that already exist.
// Returns null when no single clean mechanism stands out (metrics didn't move,
// moved together with no distinguishing signal, or the trader improved) —
// the narrative should just describe in that case, not force a cause.
// ─────────────────────────────────────────────────────────────────────────────

import type { PeriodComparison, RootCauseFinding, TraderProfile } from './types';

/** Pure: classifies why performance moved this week vs last week. Requires
    `comparison.hasPrevWeek` — with no prior week there's nothing to explain
    a *change* in, only a snapshot. */
export function diagnoseRootCause(
  comparison: PeriodComparison,
  profileNow: TraderProfile,
  profilePrev: TraderProfile | null,
): RootCauseFinding | null {
  if (!comparison.hasPrevWeek) return null;

  const { winRate, avgRR, profitFactor } = comparison;
  const evidence = {
    winRateNow: winRate.current, winRatePrev: winRate.prevWeek ?? 0,
    avgRRNow: avgRR.current, avgRRPrev: avgRR.prevWeek ?? 0,
    profitFactorNow: profitFactor.current, profitFactorPrev: profitFactor.prevWeek ?? 0,
    exitRatioNow: profileNow.exitBehavior.ratio ?? 0,
    exitRatioPrev: profilePrev?.exitBehavior.ratio ?? 0,
  };

  // Win rate held, but avgRR dropped: entries are finding the same edge, the
  // realized reward-to-risk shrank — classic "cutting winners short."
  if (winRate.trend !== 'down' && avgRR.trend === 'down' && profitFactor.trend === 'down') {
    return { kind: 'exit_management', headlineMetric: 'avgRR', evidence };
  }

  // Win rate and per-trade RR both held/improved, yet profit factor still
  // dropped: losses grew relative to winners despite entries/exits being fine
  // individually — points at loss sizing (stops widening, letting losers run).
  if (winRate.trend !== 'down' && avgRR.trend !== 'down' && profitFactor.trend === 'down') {
    return { kind: 'loss_sizing', headlineMetric: 'profitFactor', evidence };
  }

  // Win rate dropped but RR-per-trade held/improved: the trades taken were
  // simply lower quality/less selective, not exited worse.
  if (winRate.trend === 'down' && avgRR.trend !== 'down') {
    return { kind: 'entry_selectivity', headlineMetric: 'winRate', evidence };
  }

  // Everything degraded together with no distinguishing signal — an honest
  // "this could just be variance," not a fabricated single mechanism.
  if (winRate.trend === 'down' && avgRR.trend === 'down' && profitFactor.trend === 'down') {
    return { kind: 'sample_variance', headlineMetric: 'profitFactor', evidence };
  }

  return null;
}
