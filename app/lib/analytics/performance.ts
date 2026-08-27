import type { TradeEntry } from '../journal';
import { tradePnL } from '../journal';
import { computeGroupPerformance } from './metrics';
import { isoWeekKey } from './time';
import type { PerformanceSummary, PeriodPnl } from './types';

/** Overall headline numbers, plus the strongest and weakest week by realized
    PnL ("best/worst performing period"). */
export function analyzePerformance(trades: TradeEntry[]): PerformanceSummary {
  const overall = computeGroupPerformance(trades, 'ALL', 'All Trades');
  const closed = trades.filter(t => t.result !== 'OPEN');

  const byWeek = new Map<string, TradeEntry[]>();
  for (const t of closed) {
    const wk = isoWeekKey(t.dateISO);
    const arr = byWeek.get(wk);
    if (arr) arr.push(t); else byWeek.set(wk, [t]);
  }

  let bestPeriod: PeriodPnl | null = null;
  let worstPeriod: PeriodPnl | null = null;
  for (const [label, ts] of byWeek) {
    const pnl = ts.map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
    if (!bestPeriod || pnl > bestPeriod.pnl) bestPeriod = { label, pnl };
    if (!worstPeriod || pnl < worstPeriod.pnl) worstPeriod = { label, pnl };
  }

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins: overall.wins,
    losses: overall.losses,
    winRate: overall.winRate,
    totalPnl: overall.totalPnl,
    avgRR: overall.avgRR,
    profitFactor: overall.profitFactor,
    avgWinner: overall.avgWinner,
    avgLoser: overall.avgLoser,
    bestPeriod,
    worstPeriod,
    confidence: overall.confidence,
  };
}
