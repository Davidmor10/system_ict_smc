// ─────────────────────────────────────────────────────────────────────────────
// Pure period comparison — this week vs last week vs a trailing 4-week
// baseline, plus a concentration ("did one thing carry the week") check.
// Everything here is arithmetic over already-computed FullAnalysis objects;
// no trades are read directly and no LLM is involved.
// ─────────────────────────────────────────────────────────────────────────────

import type { FullAnalysis, GroupPerformance } from '../analytics';
import { computeTrend } from './trend';
import type { ConcentrationCheck, ConcentrationSlice, MetricComparison, PeriodComparison } from './types';

const SCHEMA_VERSION = 1;
const WIN_RATE_THRESHOLD = 3;
const AVG_RR_THRESHOLD = 0.15;
const PROFIT_FACTOR_THRESHOLD = 0.2;
/** A single instrument/session/confirmation carrying >=60% of the week's
    trades is "the week was really about this one thing" — trade-count based
    (not PnL share) so one lucky trade in a small week can't trip it. */
const OVER_RELIANCE_TRADE_SHARE = 0.6;

function metricComparison(current: number, prevWeek: number | null, baseline4wk: number | null, threshold: number): MetricComparison {
  return {
    current,
    prevWeek,
    baseline4wk,
    deltaVsPrevWeek: prevWeek !== null ? current - prevWeek : null,
    deltaVsBaseline: baseline4wk !== null ? current - baseline4wk : null,
    trend: computeTrend(current, prevWeek, threshold),
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
  return {
    schemaVersion: SCHEMA_VERSION,
    winRate: metricComparison(p.winRate, prevWeek?.performance.winRate ?? null, baseline4wk?.performance.winRate ?? null, WIN_RATE_THRESHOLD),
    avgRR: metricComparison(p.avgRR, prevWeek?.performance.avgRR ?? null, baseline4wk?.performance.avgRR ?? null, AVG_RR_THRESHOLD),
    profitFactor: metricComparison(p.profitFactor, prevWeek?.performance.profitFactor ?? null, baseline4wk?.performance.profitFactor ?? null, PROFIT_FACTOR_THRESHOLD),
    concentration: computeConcentration(thisWeek),
    hasPrevWeek: prevWeek !== null,
    hasBaseline: baseline4wk !== null,
  };
}
