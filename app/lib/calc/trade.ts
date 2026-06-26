/** Point value per contract for CME futures. */
export const PT_VALUE: Record<string, number> = {
  ES: 50,
  NQ: 20,
  GC: 100,
  CL: 1000,
};

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
 * Realized PnL in USD.
 * @param contracts number of contracts (default 1)
 */
export function calcPnL(
  entry: number,
  exitPrice: number,
  direction: 'LONG' | 'SHORT',
  symbol: string,
  contracts = 1,
): number {
  const dir = direction === 'LONG' ? 1 : -1;
  const pts = (exitPrice - entry) * dir;
  return pts * (PT_VALUE[symbol] ?? 50) * contracts;
}

/**
 * Realized R multiple: how many R the trader made/lost.
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
