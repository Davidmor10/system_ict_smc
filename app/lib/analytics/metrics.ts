import type { TradeEntry } from '../journal';
import { tradePnL, rMultiple } from '../journal';
import { confidenceFor } from './confidence';
import { decidedCounts, winRatePercent } from '../calc/decided';
import type { GroupPerformance } from './types';

/** Some legacy trades stored session as a raw uppercase label ("ASIA") before
    the session-key system existed. Normalize so old and new data merge. */
export function normSession(session: string | undefined): string {
  return (session || '').toLowerCase();
}

/** Reduces any slice of trades (an instrument, a session, an hour, a combo of
    dimensions — whatever the caller filtered down to) into one performance
    record. Every analyzer in the engine is built on this single reducer, so
    "win rate" and "average RR" mean exactly the same thing everywhere. */
export function computeGroupPerformance(trades: TradeEntry[], key: string, label: string): GroupPerformance {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const { wins: winCount, losses: lossCount, decided } = decidedCounts(closed);
  // 0 rather than null here, and only here: GroupPerformance.winRate is a
  // plain number that dozens of consumers sort, compare and format. What the
  // shared helper guarantees is that this 0 means "nothing decided" for the
  // same reason everywhere — see calc/decided.
  const winRate = winRatePercent(closed) ?? 0;

  const pnls = closed.map(tradePnL).filter((n): n is number => n !== null);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);

  const winPnls = pnls.filter(n => n > 0);
  const avgWinner = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;

  const lossPnls = pnls.filter(n => n < 0).map(n => Math.abs(n));
  const avgLoser = lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0;

  const grossWin = winPnls.reduce((a, b) => a + b, 0);
  const grossLoss = lossPnls.reduce((a, b) => a + b, 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const rs = closed.map(rMultiple).filter((n): n is number => n !== null);
  const avgRR = rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  // Carried for the same reason wins/losses are carried next to winRate: a
  // mean on its own cannot be compared to another mean. R multiples are widely
  // spread — a 3R winner and a 1R loser sit four apart — so how far this one
  // could have landed by luck depends on that spread, not on the count.
  // See lib/stats/movement.
  const rrSample = rs.length;
  const rrStdDev = rrSample > 1
    ? Math.sqrt(rs.reduce((a, r) => a + (r - avgRR) ** 2, 0) / (rrSample - 1))
    : null;

  return {
    key,
    label,
    trades: trades.length,
    wins: winCount,
    losses: lossCount,
    winRate,
    totalPnl,
    avgRR,
    rrSample,
    rrStdDev,
    avgWinner,
    avgLoser,
    profitFactor,
    confidence: confidenceFor(decided),
  };
}
