// ─────────────────────────────────────────────────────────────────────────────
// The trader's own headline numbers. Pure — no I/O, no AI.
//
// The analytics page already slices performance a dozen ways: by instrument,
// by session, by hour, by setup, by tag, by emotion. What none of those answer
// is the question a trader opens a journal to ask, which is how they are
// doing and whether they are doing what they said they would.
//
// Six answers, and every one of them is now computable for the first time —
// they all rest on the realized exit price, which the journal did not collect
// until this week.
//
//   equity        the curve, and the worst stretch of it
//   distribution  the shape of the outcomes, not just their average
//   expectancy    what one trade is worth, decomposed
//   streaks       the run they are on
//   planVsReal    what they aimed for against what they took
//   completeness  how much of the record is actually there
//
// planVsReal is the one that could not exist before. Every other trading
// journal reports the outcome; the plan was never stored separately from it,
// so "you take 3R setups and close them at 1.2R" was unsayable.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { tradePnL, rMultiple, plannedRR } from '../journal';

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

function round2(n: number): number { return Math.round(n * 100) / 100; }
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Closed trades, oldest first. Every statistic below depends on order, and
 *  the journal stores newest first. */
export function chronological(trades: readonly TradeEntry[]): TradeEntry[] {
  return trades
    .filter(t => DECIDED.has(t.result))
    .slice()
    .sort((a, b) => (a.dateISO + (a.time ?? '')).localeCompare(b.dateISO + (b.time ?? '')));
}

// ── equity ──────────────────────────────────────────────────────────────────

export interface EquityPoint {
  /** 1-based index of the trade. */
  n:    number;
  date: string;
  /** Cumulative R after this trade. */
  r:    number;
  /** Cumulative dollars after this trade. */
  usd:  number;
}

export interface EquityCurve {
  points: EquityPoint[];
  /** Deepest peak-to-trough fall, in R and in dollars. Positive numbers
   *  describing a fall — the sign is in the name, not the value. */
  maxDrawdownR:   number;
  maxDrawdownUsd: number;
  finalR:   number;
  finalUsd: number;
}

/** The curve, and the worst stretch of it.
 *
 *  Drawdown is measured from the running PEAK, not from the start. A trader up
 *  10R who falls to 6R has had a 4R drawdown even though they are still up,
 *  and that fall is the one that decides whether they are still trading. */
export function equityCurve(trades: readonly TradeEntry[]): EquityCurve {
  const points: EquityPoint[] = [];
  let cumR = 0, cumUsd = 0;
  let peakR = 0, peakUsd = 0;
  let ddR = 0, ddUsd = 0;

  for (const [i, t] of chronological(trades).entries()) {
    cumR   += rMultiple(t) ?? 0;
    cumUsd += tradePnL(t)  ?? 0;
    peakR   = Math.max(peakR, cumR);
    peakUsd = Math.max(peakUsd, cumUsd);
    ddR   = Math.max(ddR,   peakR   - cumR);
    ddUsd = Math.max(ddUsd, peakUsd - cumUsd);
    points.push({ n: i + 1, date: t.dateISO, r: round2(cumR), usd: Math.round(cumUsd) });
  }

  return {
    points,
    maxDrawdownR:   round2(ddR),
    maxDrawdownUsd: Math.round(ddUsd),
    finalR:   round2(cumR),
    finalUsd: Math.round(cumUsd),
  };
}

// ── distribution ────────────────────────────────────────────────────────────

export interface RBucket {
  /** Inclusive lower bound; -Infinity on the first bucket. */
  from:  number;
  /** Exclusive upper bound; Infinity on the last. */
  to:    number;
  label: string;
  count: number;
}

const BUCKETS: Array<[number, number, string]> = [
  [-Infinity, -2, 'מתחת ל-2R−'],
  [-2, -1, '2R− עד 1R−'],
  [-1,  0, '1R− עד 0'],
  [ 0,  1, '0 עד 1R'],
  [ 1,  2, '1R עד 2R'],
  [ 2,  3, '2R עד 3R'],
  [ 3,  Infinity, 'מעל 3R'],
];

/** The shape of the outcomes.
 *
 *  An average hides everything that matters about a distribution: +0.3R
 *  average is a very different trader if it comes from many small wins than if
 *  it comes from one 8R outlier carrying forty losses. */
export function rDistribution(trades: readonly TradeEntry[]): RBucket[] {
  const rs = chronological(trades).map(rMultiple).filter((r): r is number => r != null);
  return BUCKETS.map(([from, to, label]) => ({
    from, to, label,
    count: rs.filter(r => r >= from && r < to).length,
  }));
}

// ── expectancy ──────────────────────────────────────────────────────────────

export interface Expectancy {
  trades:     number;
  winRate:    number;
  /** Average R of the winners, and of the losers (negative). */
  avgWinR:    number;
  avgLossR:   number;
  /** What one trade is worth, on average. */
  expectancyR:   number;
  expectancyUsd: number;
}

/** What one trade is worth, and where that comes from.
 *
 *  Reported decomposed rather than as a single number, because the two ways to
 *  reach the same expectancy call for opposite work: a trader with a 70% win
 *  rate and a 0.4R average winner has an exit problem, and one with 30% and
 *  3R has an entry problem. The single figure hides which. */
export function expectancy(trades: readonly TradeEntry[]): Expectancy {
  const closed = chronological(trades);
  const rs   = closed.map(rMultiple).filter((r): r is number => r != null);
  const usds = closed.map(tradePnL).filter((p): p is number => p != null);

  const wins   = rs.filter(r => r > 0);
  const losses = rs.filter(r => r < 0);
  const decided = wins.length + losses.length;

  return {
    trades:  closed.length,
    winRate: decided ? round2(wins.length / decided) : 0,
    avgWinR:  round2(mean(wins)),
    avgLossR: round2(mean(losses)),
    expectancyR:   round2(mean(rs)),
    expectancyUsd: Math.round(mean(usds)),
  };
}

// ── streaks ─────────────────────────────────────────────────────────────────

export interface Streaks {
  /** Positive = wins in a row, negative = losses. Zero when the last trade
   *  was a breakeven or there are none. */
  current: number;
  maxWin:  number;
  maxLoss: number;
}

/** Breakevens break a streak rather than extending either side of it. They are
 *  neither a win nor a loss, and counting them as either would make the number
 *  a claim about something that didn't happen. */
export function streaks(trades: readonly TradeEntry[]): Streaks {
  let current = 0, maxWin = 0, maxLoss = 0;
  for (const t of chronological(trades)) {
    if (t.result === 'WIN')       current = current > 0 ? current + 1 : 1;
    else if (t.result === 'LOSS') current = current < 0 ? current - 1 : -1;
    else current = 0;
    maxWin  = Math.max(maxWin, current);
    maxLoss = Math.min(maxLoss, current);
  }
  return { current, maxWin, maxLoss: Math.abs(maxLoss) };
}

// ── plan vs execution ───────────────────────────────────────────────────────

export interface PlanVsExecution {
  /** Trades with both a plan and a measured exit. The only ones that can
   *  answer this at all. */
  measured:  number;
  /** Trades whose R is assumed from the result because no exit was logged. */
  assumed:   number;
  avgPlannedRR: number;
  avgRealizedR: number;
  /** Realized over planned, on the winners only.
   *
   *  Losers are excluded on purpose: a loss taken at the stop captures −1 of a
   *  +3 plan, and folding that into a ratio would produce a number that falls
   *  when a trader takes their stops properly. The question here is what
   *  happens to the trades that go their way. */
  captureRate: number | null;
}

export function planVsExecution(trades: readonly TradeEntry[]): PlanVsExecution {
  const closed = chronological(trades);
  const withExit = closed.filter(t => (t.exits?.length ?? 0) > 0);

  const planned  = closed.map(plannedRR).filter((r): r is number => r != null);
  const realized = withExit.map(rMultiple).filter((r): r is number => r != null);

  const winners = withExit.filter(t => (rMultiple(t) ?? 0) > 0);
  const ratios = winners
    .map(t => {
      const p = plannedRR(t);
      const r = rMultiple(t);
      return p != null && p > 0 && r != null ? r / p : null;
    })
    .filter((x): x is number => x != null);

  return {
    measured: withExit.length,
    assumed:  closed.length - withExit.length,
    avgPlannedRR: round2(mean(planned)),
    avgRealizedR: round2(mean(realized)),
    captureRate:  ratios.length ? round2(mean(ratios)) : null,
  };
}

// ── completeness ────────────────────────────────────────────────────────────

export interface Completeness {
  trades: number;
  /** Share of closed trades carrying each field, 0–1. */
  exitPrice:     number;
  rulesAnswer:   number;
  confirmations: number;
  stopAnswer:    number;
  notes:         number;
  /** The mean of the five. A record-keeping score, not a trading one. */
  overall:       number;
}

/** How much of the record is actually there.
 *
 *  A discipline metric in its own right, and the honest place to put it: a
 *  trader who logs half their exits does not have a journal with a gap, they
 *  have a journal that cannot answer half the questions they will ask of it. */
export function completeness(trades: readonly TradeEntry[]): Completeness {
  const closed = chronological(trades);
  const n = closed.length;
  const share = (p: (t: TradeEntry) => boolean) =>
    n ? round2(closed.filter(p).length / n) : 0;

  const parts = {
    exitPrice:     share(t => (t.exits?.length ?? 0) > 0),
    rulesAnswer:   share(t => typeof t.followedRules === 'boolean'),
    confirmations: share(t => (t.confirmations?.length ?? 0) > 0),
    stopAnswer:    share(t => !!t.stopMoved || (t.management?.some(m => m.kind === 'stop') ?? false)),
    notes:         share(t => (t.notes ?? '').trim().length > 0),
  };

  return {
    trades: n,
    ...parts,
    overall: round2(mean(Object.values(parts))),
  };
}

// ── one call ────────────────────────────────────────────────────────────────

export interface JournalStats {
  equity:       EquityCurve;
  distribution: RBucket[];
  expectancy:   Expectancy;
  streaks:      Streaks;
  planVsReal:   PlanVsExecution;
  completeness: Completeness;
}

export function computeJournalStats(trades: readonly TradeEntry[]): JournalStats {
  return {
    equity:       equityCurve(trades),
    distribution: rDistribution(trades),
    expectancy:   expectancy(trades),
    streaks:      streaks(trades),
    planVsReal:   planVsExecution(trades),
    completeness: completeness(trades),
  };
}
