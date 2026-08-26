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
  /** The direction the trader declared.
   *
   *  Optional for the callers that genuinely do not have it, and supplied by
   *  everything that does. Without it this function INFERS the direction from
   *  where the stop sits, which is right for every well-formed trade and wrong
   *  in exactly the case worth catching: a long whose stop was typed above the
   *  entry, or a short whose stop went below it.
   *
   *  That mattered because the realized side never inferred anything —
   *  `calcRealizedR` takes the declared direction. So one mistyped price made
   *  the plan and the outcome read the trade as opposite trades, and the pair
   *  the journal exists to compare disagreed about which way it was pointing. */
  direction?: 'LONG' | 'SHORT',
): number | null {
  // Typed as numbers, reached with absences. A trade row read back from the
  // database carries NULL for a target that was never set, and a form field
  // left blank parses to NaN — neither is stopped by the type, and arithmetic
  // on either returns NaN rather than throwing.
  //
  // NaN was then handed back as a "number | null" that is neither. It survives
  // every `!= null` guard in the codebase, because NaN != null is true, so it
  // travelled from one missing target all the way into an average: a single
  // such trade turns an expectancy into NaN and the screen into blanks. An
  // absent input has to leave through the same door as a zero-risk one.
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) return null;
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return null;

  const inferred: 'LONG' | 'SHORT' = entry > stopLoss ? 'LONG' : 'SHORT';
  // A declared direction the prices contradict is not a plan to be measured,
  // it is a typo. Returning a number here would report a reward-to-risk for a
  // trade whose stop is on the profit side — and the sign would look ordinary.
  if (direction && direction !== inferred) return null;

  const dir = (direction ?? inferred) === 'LONG' ? 1 : -1;
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
  // Same reason as calcRR: these are typed as numbers and reached with
  // absences, and NaN would leave here as the number half of `number | null`
  // and pass every guard downstream.
  if (!Number.isFinite(entry) || !Number.isFinite(exitPrice) || !Number.isFinite(stopLoss)) return null;
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
  // A leg whose R cannot be computed is EXCLUDED, from the top and the bottom
  // of the average alike. It used to be folded in as 0, which is not "no
  // answer" — it is the claim that the leg came back flat, and it drags the
  // whole trade toward break-even. A 2R trade with one unreadable leg reported
  // about 1R, which looks like an ordinary trade rather than a broken record.
  //
  // Weighted by the contracts that actually produced a number, so the result
  // is the realized R of the part of the position that can be read, and null
  // when none of it can.
  let weightedR = 0;
  let counted = 0;
  for (const e of exits) {
    const r = calcRealizedR(entry, e.price, stopLoss, direction);
    if (r == null || !Number.isFinite(e.contracts) || e.contracts <= 0) continue;
    weightedR += r * e.contracts;
    counted   += e.contracts;
  }
  if (counted === 0) return null;
  return weightedR / counted;
}

/** Contracts-weighted average exit price across every leg — the single price
    inferResult() needs to classify a multi-exit trade as WIN/LOSS/BE. */
export function calcWeightedExitPrice(exits: ExitLeg[]): number | null {
  const totalContracts = exits.reduce((sum, e) => sum + e.contracts, 0);
  if (totalContracts === 0) return null;
  const weighted = exits.reduce((sum, e) => sum + e.price * e.contracts, 0);
  return weighted / totalContracts;
}
