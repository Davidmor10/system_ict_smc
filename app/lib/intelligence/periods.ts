// ─────────────────────────────────────────────────────────────────────────────
// Pure period comparison — this week vs last week vs a trailing 4-week
// baseline, plus a concentration ("did one thing carry the week") check.
// Everything here is arithmetic over already-computed FullAnalysis objects;
// no trades are read directly and no LLM is involved.
// ─────────────────────────────────────────────────────────────────────────────

import type { FullAnalysis, GroupPerformance, PerformanceSummary } from '../analytics';
import { fisherExactTwoSided, bonferroni } from '../stats/fisher';
import { computeTrend } from './trend';
import type { ConcentrationCheck, ConcentrationSlice, MetricComparison, PeriodComparison } from './types';

const SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// WHAT COUNTS AS A DIRECTION
//
// These three thresholds are floors, not the rule. They used to BE the rule: a
// win rate that moved three points was 'up', full stop. In a week of ten
// decided trades one trade is worth ten points, so almost every week came back
// with a direction on every metric, and nothing downstream could tell the
// difference between a habit and a coin.
//
// That mattered because the labels do not stay here. `rootCause` reads the
// three trends together and names a MECHANISM from them — "entry selectivity
// fell" — and the weekly narrative explains that mechanism to the trader in
// confident prose. One trade of variance became a diagnosis.
//
// So a move now has to survive a test before it is called a direction:
//
//   win rate      — Fisher exact on the two weeks' win/loss counts, corrected
//                   for the tests performed in the same pass. This is the
//                   codebase's standing rule for any group compared against
//                   another, and this comparison was outside it.
//   avg R, PF     — not proportions, so Fisher does not apply. The floor is
//                   raised to what a single trade could account for: with n
//                   decided trades, one trade moves a mean of R by about 1/n,
//                   and moves profit factor by about PF/n. A change one trade
//                   could explain is not a direction.
//
// Both tests use the SMALLER of the two weeks, because that is the week the
// claim is actually resting on.
// ─────────────────────────────────────────────────────────────────────────────

const WIN_RATE_THRESHOLD = 3;
const AVG_RR_THRESHOLD = 0.15;
const PROFIT_FACTOR_THRESHOLD = 0.2;
/** How many significance tests one comparison pass performs — the divisor the
 *  correction is computed over.
 *
 *  One, and deliberately not three. Average R and profit factor are also
 *  compared here, but neither goes through a test: they are means and ratios,
 *  not proportions, and their false positives are held off by the one-trade
 *  floor instead. Multiplying the single p-value by the count of its untested
 *  siblings would not be a correction for multiplicity, it would be a penalty
 *  — and at a real trader's volume it is a large one: a week of 8 wins in 10
 *  against a week of 3 in 10 is p = 0.035, and tripling that buries a fifty
 *  point swing as "no change".
 *
 *  It stays a named constant, and stays inside `bonferroni`, so that adding a
 *  second tested metric raises it rather than being forgotten. */
const FISHER_TESTS = 1;
/** Looser than the 0.05 the pattern engine uses, and for a reason that is
 *  about what the number is for rather than about taste.
 *
 *  Pattern discovery searches roughly a hundred overlapping slices for the
 *  best one and then tells the trader it is their edge — a false positive
 *  there ends with someone sizing up on a coin flip, so it is corrected hard
 *  and judged strictly. This is one pre-specified comparison, made once, of
 *  two periods chosen by the calendar rather than by their result, and its
 *  output is a description: "this week's win rate is higher than last
 *  week's". Nothing is recommended off it — the mechanism claim that gets
 *  explained to the trader sits behind its own sample floor in rootCause.
 *
 *  At a real trader's volume the difference decides whether the report can
 *  ever say anything: 8 wins in 10 against 3 in 10 — a fifty point swing —
 *  is p = 0.07. Calling that "no change" is its own kind of false report. */
const ALPHA = 0.10;

/** Did the win rate move by more than chance, over these two weeks?
 *
 *  Degenerate tables (a week with nothing decided) come back p = 1 from the
 *  test itself, which is the honest answer: with nothing to compare, nothing
 *  is surprising. */
function winRateMoved(now: PerformanceSummary, prev: PerformanceSummary): boolean {
  const p = fisherExactTwoSided(now.wins, now.losses, prev.wins, prev.losses);
  return bonferroni(p, FISHER_TESTS) < ALPHA;
}

/** The smaller of the two weeks, in decided trades. Zero disables the metric. */
function commonSample(now: PerformanceSummary, prev: PerformanceSummary): number {
  return Math.min(now.wins + now.losses, prev.wins + prev.losses);
}

/** A floor no smaller than one trade's influence. With no sample at all the
 *  floor is infinite, which reads as 'flat' — correctly, since there is
 *  nothing there to have moved. */
function floorFor(fixed: number, oneTradeWorth: number): number {
  return Math.max(fixed, oneTradeWorth);
}
/** A single instrument/session/confirmation carrying >=60% of the week's
    trades is "the week was really about this one thing" — trade-count based
    (not PnL share) so one lucky trade in a small week can't trip it. */
const OVER_RELIANCE_TRADE_SHARE = 0.6;

function metricComparison(
  current: number,
  prevWeek: number | null,
  baseline4wk: number | null,
  trend: MetricComparison['trend'],
): MetricComparison {
  return {
    current,
    prevWeek,
    baseline4wk,
    deltaVsPrevWeek: prevWeek !== null ? current - prevWeek : null,
    deltaVsBaseline: baseline4wk !== null ? current - baseline4wk : null,
    trend,
  };
}

function slicesFor(
  dimension: ConcentrationSlice['dimension'],
  groups: GroupPerformance[],
  closedTrades: number,
  totalPnl: number,
): ConcentrationSlice[] {
  if (closedTrades === 0) return [];
  return groups.map(g => ({
    dimension,
    key: g.key,
    label: g.label,
    pctOfTrades: g.trades / closedTrades,
    pctOfPnl: totalPnl !== 0 ? g.totalPnl / totalPnl : 0,
  }));
}

function computeConcentration(thisWeek: FullAnalysis): ConcentrationCheck {
  const closedTrades = thisWeek.performance.closedTrades;
  const totalPnl = thisWeek.performance.totalPnl;

  const slices = [
    ...slicesFor('instrument', thisWeek.instruments, closedTrades, totalPnl),
    ...slicesFor('session', thisWeek.sessions, closedTrades, totalPnl),
    ...slicesFor('confirmation', thisWeek.confirmations, closedTrades, totalPnl),
  ];

  const mostConcentrated = slices.reduce<ConcentrationSlice | null>(
    (best, s) => (best === null || s.pctOfTrades > best.pctOfTrades ? s : best),
    null,
  );

  const isOverReliant = mostConcentrated !== null && mostConcentrated.pctOfTrades >= OVER_RELIANCE_TRADE_SHARE;

  return {
    isOverReliant,
    overRelianceSubject: isOverReliant ? mostConcentrated : null,
    slices,
  };
}

/** Pure: builds the structured comparison facts fed to the weekly narrative
    prompt. `prevWeek`/`baseline4wk` are null when there isn't enough data yet
    (caller enforces the minimum sample sizes) — every downstream consumer
    must treat null as "say plainly there isn't enough data," never fabricate
    a comparison. */
export function computePeriodComparison(
  thisWeek: FullAnalysis,
  prevWeek: FullAnalysis | null,
  baseline4wk: FullAnalysis | null,
): PeriodComparison {
  const p = thisWeek.performance;
  const q = prevWeek?.performance ?? null;

  // One trade's worth, on the week the comparison actually rests on.
  const n = q ? commonSample(p, q) : 0;
  const perTradeR  = n > 0 ? 1 / n : Infinity;
  const perTradePF = n > 0 && Number.isFinite(p.profitFactor)
    ? Math.abs(p.profitFactor) / n
    : Infinity;

  // Nothing decided in one of the weeks: there is no direction to read, and
  // every test below would be reading one out of an empty table.
  if (q && n === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      winRate: metricComparison(p.winRate, q.winRate, baseline4wk?.performance.winRate ?? null, 'flat'),
      avgRR: metricComparison(p.avgRR, q.avgRR, baseline4wk?.performance.avgRR ?? null, 'flat'),
      profitFactor: metricComparison(p.profitFactor, q.profitFactor, baseline4wk?.performance.profitFactor ?? null, 'flat'),
      concentration: computeConcentration(thisWeek),
      hasPrevWeek: true,
      hasBaseline: baseline4wk !== null,
    };
  }

  const winRateTrend = q && winRateMoved(p, q)
    // Significant: the size of the move no longer has to clear a floor, the
    // test already said it is real. The floor stays as a second opinion on a
    // very large sample, where significance can attach to a fraction of a
    // point.
    ? computeTrend(p.winRate, q.winRate, WIN_RATE_THRESHOLD)
    : 'flat';

  return {
    schemaVersion: SCHEMA_VERSION,
    winRate: metricComparison(p.winRate, q?.winRate ?? null, baseline4wk?.performance.winRate ?? null, winRateTrend),
    avgRR: metricComparison(p.avgRR, q?.avgRR ?? null, baseline4wk?.performance.avgRR ?? null,
      computeTrend(p.avgRR, q?.avgRR ?? null, floorFor(AVG_RR_THRESHOLD, perTradeR))),
    profitFactor: metricComparison(p.profitFactor, q?.profitFactor ?? null, baseline4wk?.performance.profitFactor ?? null,
      computeTrend(p.profitFactor, q?.profitFactor ?? null, floorFor(PROFIT_FACTOR_THRESHOLD, perTradePF))),
    concentration: computeConcentration(thisWeek),
    hasPrevWeek: prevWeek !== null,
    hasBaseline: baseline4wk !== null,
  };
}
