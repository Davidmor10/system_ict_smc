import type { FullAnalysis, GroupPerformance } from '../analytics';
import { commonSample, meanFloor, ratioFloor, winRateMoved } from './movement';
import { computeTrend } from './trend';
import type { ConcentrationCheck, ConcentrationSlice, MetricComparison, PeriodComparison } from './types';

const SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// WHAT COUNTS AS A DIRECTION
//
// These three numbers are floors, not the rule. They used to BE the rule: a
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
// The rule itself lives in ./movement, shared with the trader profile, which
// was reading its own trends the same wrong way.
// ─────────────────────────────────────────────────────────────────────────────

const WIN_RATE_THRESHOLD = 3;
const AVG_RR_THRESHOLD = 0.15;
const PROFIT_FACTOR_THRESHOLD = 0.2;
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

  // The week the comparison actually rests on.
  const n = q ? commonSample(p, q) : 0;

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
      computeTrend(p.avgRR, q?.avgRR ?? null, meanFloor(AVG_RR_THRESHOLD, n))),
    profitFactor: metricComparison(p.profitFactor, q?.profitFactor ?? null, baseline4wk?.performance.profitFactor ?? null,
      computeTrend(p.profitFactor, q?.profitFactor ?? null, ratioFloor(PROFIT_FACTOR_THRESHOLD, p.profitFactor, n))),
    concentration: computeConcentration(thisWeek),
    hasPrevWeek: prevWeek !== null,
    hasBaseline: baseline4wk !== null,
  };
}
