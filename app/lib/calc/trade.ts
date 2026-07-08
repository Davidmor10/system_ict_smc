import { INSTRUMENTS, pointValue } from '../instruments';

/** @deprecated kept for any external import; prefer `pointValue()` from lib/instruments. */
export const PT_VALUE: Record<string, number> = Object.fromEntries(
  Object.keys(INSTRUMENTS).map(k => [k, pointValue(k)]),
);

/** Points gained/lost, direction-adjusted. Positive = favorable. */
export function calcPoints(
  entry: number,
  exitPrice: number,
  direction: 'LONG' | 'SHORT',
): number {
  const dir = direction === 'LONG' ? 1 : -1;
  return (exitPrice - entry) * dir;
}

/** Tick movement, direction-adjusted. */
export function calcTicks(
  entry: number,
  exitPrice: number,
  direction: 'LONG' | 'SHORT',
  symbol: string,
): number {
  const tickSize = INSTRUMENTS[symbol]?.tickSize ?? 0.25;
  return calcPoints(entry, exitPrice, direction) / tickSize;
}

/**
 * Planned reward-to-risk ratio.
 * Returns null if stop === entry (invalid).
 */
export function calcRR(
  entry: number,
  stopLoss: number,
  takeProfit: number,
): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return null;
  const dir = entry > stopLoss ? 1 : -1; // LONG if entry > stop (stop below entry)
  const reward = (takeProfit - entry) * dir;
  return reward / risk;
}

/**
 * Gross realized PnL in USD — instrument- and contract-size-aware.
 * This is the single source of truth for trade PnL across the app.
 */
export function calcPnL(
  entry: number,
  exitPrice: number,
  direction: 'LONG' | 'SHORT',
  symbol: string,
  contracts = 1,
): number {
  const pts = calcPoints(entry, exitPrice, direction);
  return pts * pointValue(symbol) * contracts;
}

/**
 * Realized R multiple: how many R the trader made/lost.
 * Instrument-independent — R is a ratio of price distances, not dollars.
 */
export function calcRealizedR(
  entry: number,
  exitPrice: number,
  stopLoss: number,
  direction: 'LONG' | 'SHORT',
): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return null;
  const dir = direction === 'LONG' ? 1 : -1;
  return ((exitPrice - entry) * dir) / risk;
}

/**
 * Expectancy per trade: (winRate × avgWin) − (lossRate × avgLoss).
 * All values in R.
 */
export function calcExpectancy(
  winRate: number,      // 0–1
  avgWinR: number,
  avgLossR: number,     // positive number
): number {
  return winRate * avgWinR - (1 - winRate) * avgLossR;
}

/**
 * Determine result from exit vs entry/stop/target.
 */
export function inferResult(
  entry: number,
  stopLoss: number,
  takeProfit: number | null,
  exitPrice: number,
  direction: 'LONG' | 'SHORT',
): 'WIN' | 'LOSS' | 'BE' {
  const dir = direction === 'LONG' ? 1 : -1;
  const pts = (exitPrice - entry) * dir;
  if (Math.abs(pts) < 0.25) return 'BE';
  if (pts > 0) return 'WIN';
  return 'LOSS';
}

/** Structurally identical to journal.ts's TradeExit — not imported from there
    to avoid a circular dependency (journal.ts already imports from this file). */
interface ExitLeg {
  price: number;
  contracts: number;
}

/**
 * Weighted realized PnL across every exit leg of a position — real trades
 * rarely close at a single price. Reuses calcPnL per leg, same source of
 * truth as a single-exit trade.
 */
export function calcMultiExitPnL(
  entry: number,
  exits: ExitLeg[],
  direction: 'LONG' | 'SHORT',
  symbol: string,
): number {
  return exits.reduce((sum, e) => sum + calcPnL(entry, e.price, direction, symbol, e.contracts), 0);
}

/**
 * Contracts-weighted average realized R across every exit leg. Returns null
 * only when there are no exits at all (nothing to weight).
 */
export function calcMultiExitRealizedR(
  entry: number,
  stopLoss: number,
  exits: ExitLeg[],
  direction: 'LONG' | 'SHORT',
): number | null {
  const totalContracts = exits.reduce((sum, e) => sum + e.contracts, 0);
  if (totalContracts === 0) return null;
  const weightedR = exits.reduce((sum, e) => {
    const r = calcRealizedR(entry, e.price, stopLoss, direction);
    return sum + (r ?? 0) * e.contracts;
  }, 0);
  return weightedR / totalContracts;
}

/** Contracts-weighted average exit price across every leg — the single price
    inferResult() needs to classify a multi-exit trade as WIN/LOSS/BE. */
export function calcWeightedExitPrice(exits: ExitLeg[]): number | null {
  const totalContracts = exits.reduce((sum, e) => sum + e.contracts, 0);
  if (totalContracts === 0) return null;
  const weighted = exits.reduce((sum, e) => sum + e.price * e.contracts, 0);
  return weighted / totalContracts;
}
