// ─────────────────────────────────────────────────────────────────────────────
// Today signals — a compact structured summary of one trading day, computed
// from the day's TradeRow[]. Feeds two consumers:
//
//   1. RAG retrieval: signals become the query text embedded to find relevant
//      past notebook writing.
//   2. The insight prompt: signals become the <today_signals> block Claude
//      reads verbatim.
//
// Same rule as Statistical: pure function, deterministic, no AI. Numbers in,
// numbers out. Every field is stable across runs of the same input.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';

export type Significance = 'no_trades' | 'red_day' | 'green_day' | 'normal';

export interface TodaySignals {
  n_trades:       number;
  net_r:          number;                // sum of r_multiple for decided trades
  net_pnl_usd:    number;                // integer
  best_r:         number | null;         // null when 0 trades
  worst_r:        number | null;
  sessions:       string[];              // unique, in appearance order
  setups:         string[];              // unique, in appearance order
  emotions:       string[];              // unique, in appearance order (raw enum)
  rules_violated: number;                // count of decided trades with followed_rules=false
  significance:   Significance;
}

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

/** Push v into arr if not already there. Preserves first-occurrence order. */
function pushUnique<T>(arr: T[], v: T | null | undefined): void {
  if (v == null) return;
  if (!arr.includes(v)) arr.push(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Classifies the day. Thresholds are intentionally coarse — the prompt uses
 *  this only as a hint ("today feels like a red day"), not as a claim. */
function classify(nTrades: number, netR: number): Significance {
  if (nTrades === 0) return 'no_trades';
  if (netR < -1)     return 'red_day';
  if (netR >  1)     return 'green_day';
  return 'normal';
}

/** Compute signals from a day's trades. Soft-deleted rows are ignored. OPEN
 *  trades are still counted for `sessions`/`setups`/`emotions` (they happened
 *  today even if not decided), but excluded from all R/PnL math. */
export function computeTodaySignals(trades: readonly TradeRow[]): TodaySignals {
  const alive = trades.filter(t => !t.deleted_at);
  const decided = alive.filter(t => DECIDED.has(t.result));

  let netR    = 0;
  let netPnl  = 0;
  let bestR: number | null = null;
  let worstR: number | null = null;
  let ruleBreaks = 0;

  for (const t of decided) {
    const r = t.r_multiple ?? 0;
    netR   += r;
    netPnl += t.pnl_usd ?? 0;
    if (bestR  === null || r > bestR)  bestR  = r;
    if (worstR === null || r < worstR) worstR = r;
    if (t.followed_rules === false) ruleBreaks += 1;
  }

  const sessions: string[] = [];
  const setups:   string[] = [];
  const emotions: string[] = [];
  for (const t of alive) {
    pushUnique(sessions, t.session);
    pushUnique(setups,   t.setup);
    pushUnique(emotions, t.emotional_state);
  }

  const nTrades = alive.length;
  return {
    n_trades:       nTrades,
    net_r:          round2(netR),
    net_pnl_usd:    Math.round(netPnl),
    best_r:         bestR  === null ? null : round2(bestR),
    worst_r:        worstR === null ? null : round2(worstR),
    sessions,
    setups,
    emotions,
    rules_violated: ruleBreaks,
    significance:   classify(nTrades, netR),
  };
}
