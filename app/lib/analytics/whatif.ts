// ─────────────────────────────────────────────────────────────────────────────
// What-If Simulator — pure, exact "what would my numbers look like if…". No LLM.
// Takes the real journal, re-runs the analytics engine over a filtered subset,
// and returns the before/after with the subset's own sample size + confidence
// so a tiny filtered set is never misread as a real improvement.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry, Direction } from '../journal';
import { runFullAnalysis } from './index';
import { confidenceFor } from './confidence';
import { normSession } from './metrics';
import type { Confidence } from './types';

export interface WhatIfMetric {
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  avgRR: number;
}

export interface WhatIfResult {
  actual: WhatIfMetric;
  filtered: WhatIfMetric;
  /** filtered − actual, per metric. */
  delta: WhatIfMetric;
  /** Total trades kept by the filter (incl. still-open). */
  keptTrades: number;
  /** Decided (WIN/LOSS) trades kept — what the confidence is based on. */
  keptClosed: number;
  removedTrades: number;
  /** Confidence of the FILTERED subset — low here means "don't trust this delta yet". */
  confidence: Confidence;
}

export type ScenarioKind =
  | 'excludeEmotion'
  | 'onlySession'
  | 'onlyDirection'
  | 'onlyBiasAligned'
  | 'onlyConfirmation';

export interface WhatIfScenario {
  id: string;
  kind: ScenarioKind;
  /** The subject value (an emotion key, session key, direction, or tag). Empty for onlyBiasAligned. */
  value: string;
  predicate: (t: TradeEntry) => boolean;
}

function metricOf(trades: TradeEntry[]): WhatIfMetric {
  const p = runFullAnalysis(trades).performance;
  return { winRate: p.winRate, totalPnl: p.totalPnl, profitFactor: p.profitFactor, avgRR: p.avgRR };
}

/** Runs the analytics engine over the full journal and over the subset kept by
    `predicate`, returning both plus the delta and the subset's confidence. */
export function simulate(trades: TradeEntry[], predicate: (t: TradeEntry) => boolean): WhatIfResult {
  const kept = trades.filter(predicate);
  const actual = metricOf(trades);
  const filtered = metricOf(kept);
  const keptClosed = kept.filter(t => t.result === 'WIN' || t.result === 'LOSS').length;

  const sub = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? a - b : NaN);

  return {
    actual,
    filtered,
    delta: {
      winRate: filtered.winRate - actual.winRate,
      totalPnl: filtered.totalPnl - actual.totalPnl,
      profitFactor: sub(filtered.profitFactor, actual.profitFactor),
      avgRR: filtered.avgRR - actual.avgRR,
    },
    keptTrades: kept.length,
    keptClosed,
    removedTrades: trades.length - kept.length,
    confidence: confidenceFor(keptClosed),
  };
}

/** Builds the scenarios that are actually meaningful for THIS journal — a
    filter is only offered when it would change the set (e.g. "exclude FOMO"
    only appears if some trades are FOMO and some aren't). Keeps the UI honest:
    no scenario that does nothing or that no data supports. */
export function availableScenarios(trades: TradeEntry[]): WhatIfScenario[] {
  const scenarios: WhatIfScenario[] = [];
  const has = (pred: (t: TradeEntry) => boolean) => trades.some(pred);
  const hasNot = (pred: (t: TradeEntry) => boolean) => trades.some(t => !pred(t));

  // Exclude an emotional state — only if some trades have it and some don't.
  const emotions = new Set<string>();
  for (const t of trades) if (t.emotionalState) emotions.add(t.emotionalState);
  for (const e of emotions) {
    const isE = (t: TradeEntry) => t.emotionalState === e;
    if (has(isE) && hasNot(isE)) {
      scenarios.push({ id: `xemotion_${e}`, kind: 'excludeEmotion', value: e, predicate: t => t.emotionalState !== e });
    }
  }

  // Only one session — offered per session when more than one session exists.
  const sessions = new Set<string>();
  for (const t of trades) { const s = normSession(t.session); if (s && s !== 'none') sessions.add(s); }
  if (sessions.size > 1) {
    for (const s of sessions) {
      scenarios.push({ id: `session_${s}`, kind: 'onlySession', value: s, predicate: t => normSession(t.session) === s });
    }
  }

  // Only one direction — only if both directions are present.
  const dirs = new Set(trades.map(t => t.direction));
  if (dirs.size > 1) {
    (['LONG', 'SHORT'] as Direction[]).forEach(d => {
      scenarios.push({ id: `dir_${d}`, kind: 'onlyDirection', value: d, predicate: t => t.direction === d });
    });
  }

  // Only bias-aligned — only if some trades were logged against the day's bias.
  if (has(t => t.biasAlignment === 'COUNTER')) {
    scenarios.push({ id: 'biasAligned', kind: 'onlyBiasAligned', value: '', predicate: t => t.biasAlignment !== 'COUNTER' });
  }

  // Only trades carrying a given confirmation tag — if some do and some don't.
  const tags = new Set<string>();
  for (const t of trades) for (const c of t.confirmations ?? []) tags.add(c);
  for (const tag of tags) {
    const hasTag = (t: TradeEntry) => (t.confirmations ?? []).includes(tag);
    if (has(hasTag) && hasNot(hasTag)) {
      scenarios.push({ id: `conf_${tag}`, kind: 'onlyConfirmation', value: tag, predicate: hasTag });
    }
  }

  return scenarios;
}
