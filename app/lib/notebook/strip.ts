// ─────────────────────────────────────────────────────────────────────────────
// The notebook's stats strip — the numbers shown above an open entry.
//
// Pure, and its own file, because it got two of them wrong in a way that only
// a test would catch. A break-even trade was shown as a 50% win rate and a day
// of nothing but break-evens as 0%, and both read exactly like a real
// measurement. Neither number came from anywhere: one trade that decided
// nothing has no win rate, and "no trade was decided" is not "no trade won".
//
// Every other surface in the app already answers null there — see
// lib/calc/decided, which exists because five places used to disagree about
// what a win is. This was the sixth.
// ─────────────────────────────────────────────────────────────────────────────

import { tradePnL, type TradeEntry } from '../journal';

export interface TradeStrip {
  kind: 'trade';
  pnlNet: number;
  pnlGross: number;
  trades: number;
  wins: number;
  losses: number;
  /** Null when nothing was decided — never 0, never 50. */
  wr: number | null;
  volume: number;
  pf: number | null;
  symbol: string;
  direction: string;
}

export interface DayStrip {
  kind: 'daily';
  pnlNet: number;
  pnlGross: number;
  trades: number;
  wins: number;
  losses: number;
  wr: number | null;
  volume: number;
  pf: number | null;
}

export interface EmptyDay { kind: 'daily'; empty: true }

/** One trade's strip.
 *
 *  Win and loss come from the trader's own label, never from the sign of the
 *  money: a trade closed a tick the right side of entry is a break-even by
 *  their verdict and a win by its sign, and their verdict is the one that
 *  counts. */
export function tradeStrip(t: TradeEntry): TradeStrip {
  const pnl    = tradePnL(t) ?? 0;
  const isWin  = t.result === 'WIN';
  const isLoss = t.result === 'LOSS';
  return {
    kind: 'trade',
    pnlNet: pnl,
    pnlGross: pnl,
    trades: 1,
    wins:  isWin  ? 1 : 0,
    losses: isLoss ? 1 : 0,
    wr: isWin ? 100 : isLoss ? 0 : null,
    volume: t.contracts,
    pf: isWin ? Infinity : isLoss ? 0 : null,
    symbol: t.symbol,
    direction: t.direction,
  };
}

/** A day's strip, or the empty marker when the day holds no closed trade. */
export function dayStrip(trades: readonly TradeEntry[], dateISO: string): DayStrip | EmptyDay {
  const day = trades.filter(x => x.dateISO === dateISO && x.result !== 'OPEN');
  if (!day.length) return { kind: 'daily', empty: true };

  let pnlGross = 0, wins = 0, losses = 0, winsPnl = 0, lossesPnl = 0, volume = 0;
  for (const t of day) {
    const p = tradePnL(t) ?? 0;
    pnlGross += p;
    volume   += t.contracts;
    if (t.result === 'WIN')       { wins   += 1; winsPnl   += Math.abs(p); }
    else if (t.result === 'LOSS') { losses += 1; lossesPnl += Math.abs(p); }
  }
  const decided = wins + losses;
  return {
    kind: 'daily',
    pnlNet: pnlGross,
    pnlGross,
    trades: day.length,
    wins,
    losses,
    wr: decided ? Math.round((wins / decided) * 100) : null,
    volume,
    pf: lossesPnl > 0 ? winsPnl / lossesPnl : (winsPnl > 0 ? Infinity : null),
  };
}
