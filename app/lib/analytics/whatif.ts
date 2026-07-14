// ─────────────────────────────────────────────────────────────────────────────
// What-If Simulator — pure, exact "what would my numbers look like if…". No LLM.
// Takes the real journal, re-runs the analytics engine over a filtered subset,
// and returns the before/after with the subset's own sample size + confidence
// so a tiny filtered set is never misread as a real improvement.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry, Direction } from '../journal';
import { UNSPECIFIED_MODEL } from '../journal';
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
  | 'onlyEmotion'
  | 'onlyNoEmotion'
  | 'onlySession'
  | 'onlySymbol'
  | 'onlySetup'
  | 'onlyDirection'
  | 'onlyBiasAligned'
  | 'onlyConfirmation'
  | 'cleanRuleDays'
  | 'excludeRuleDay'
  | 'onlyHour';

export interface WhatIfScenario {
  id: string;
  kind: ScenarioKind;
  /** The subject value (an emotion key, session key, symbol, direction, tag, or
      start-hour). Empty for onlyBiasAligned / onlyNoEmotion. */
  value: string;
  predicate: (t: TradeEntry) => boolean;
}

/** Minimum trades an "only X" slice must have to be worth offering on its own —
    below this it's just noise (the low-confidence banner still fires either way). */
const MIN_ONLY = 2;

/** Entry hour (0–23) of a trade from its `HH:mm` time, or -1 when unparseable. */
function hourOf(t: TradeEntry): number {
  const h = parseInt((t.time || '').slice(0, 2), 10);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : -1;
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

  // Emotional state — three angles per tagged emotion:
  //   • "בלי X"  (exclude)  — needs a mix (some X, some not)
  //   • "רק X"   (only)     — needs ≥MIN_ONLY of X, and some non-X to remove
  // plus "רק בלי רגש מסומן" when some trades were left untagged.
  const emotions = new Set<string>();
  let tagged = 0, untagged = 0;
  for (const t of trades) { if (t.emotionalState) { emotions.add(t.emotionalState); tagged++; } else untagged++; }
  for (const e of emotions) {
    const isE = (t: TradeEntry) => t.emotionalState === e;
    const countE = trades.filter(isE).length;
    if (has(isE) && hasNot(isE)) {
      scenarios.push({ id: `xemotion_${e}`, kind: 'excludeEmotion', value: e, predicate: t => t.emotionalState !== e });
    }
    if (countE >= MIN_ONLY && countE < trades.length) {
      scenarios.push({ id: `oemotion_${e}`, kind: 'onlyEmotion', value: e, predicate: isE });
    }
  }
  if (untagged >= MIN_ONLY && tagged > 0) {
    scenarios.push({ id: 'noEmotion', kind: 'onlyNoEmotion', value: '', predicate: t => !t.emotionalState });
  }

  // Only one session — offered per session when more than one session exists.
  const sessions = new Set<string>();
  for (const t of trades) { const s = normSession(t.session); if (s && s !== 'none') sessions.add(s); }
  if (sessions.size > 1) {
    for (const s of sessions) {
      scenarios.push({ id: `session_${s}`, kind: 'onlySession', value: s, predicate: t => normSession(t.session) === s });
    }
  }

  // Only one instrument — offered per symbol when more than one was traded.
  const symbols = new Set(trades.map(t => t.symbol));
  if (symbols.size > 1) {
    for (const sym of symbols) {
      const isSym = (t: TradeEntry) => t.symbol === sym;
      if (trades.filter(isSym).length >= MIN_ONLY) {
        scenarios.push({ id: `symbol_${sym}`, kind: 'onlySymbol', value: sym, predicate: isSym });
      }
    }
  }

  // One ICT setup model — per model that has enough trades and something to
  // remove (mirrors the emotion "only" logic; ignores untagged models).
  const models = new Set<string>();
  for (const t of trades) if (t.model && t.model !== UNSPECIFIED_MODEL) models.add(t.model);
  for (const m of models) {
    const isM = (t: TradeEntry) => t.model === m;
    const countM = trades.filter(isM).length;
    if (countM >= MIN_ONLY && countM < trades.length) {
      scenarios.push({ id: `setup_${m}`, kind: 'onlySetup', value: m, predicate: isM });
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

/** Minutes-of-day (0–1439) of a trade's `HH:mm` entry time, or -1 if unparseable. */
function minutesOf(t: TradeEntry): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.time || '');
  if (!m) return -1;
  const h = +m[1], mi = +m[2];
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? h * 60 + mi : -1;
}

/** How many trades carry a parseable entry time — gates whether the custom
    time-window control is worth showing at all. */
export function timedTradeCount(trades: TradeEntry[]): number {
  return trades.reduce((n, t) => n + (hourOf(t) >= 0 ? 1 : 0), 0);
}

/** A user-defined 1-hour window starting at `startMin` (minutes of day, so
    16:03 → 963). Keeps trades entered in [start, start+60), wrapping past
    midnight. Built on the fly from the picker — the trader chooses the time. */
export function hourScenario(startMin: number): WhatIfScenario {
  const end = (startMin + 60) % 1440;
  const inWindow = (m: number) => (end > startMin ? m >= startMin && m < end : m >= startMin || m < end);
  return { id: `hour_${startMin}`, kind: 'onlyHour', value: String(startMin), predicate: t => { const m = minutesOf(t); return m >= 0 && inWindow(m); } };
}

export interface RuleForWhatIf {
  id: string;
  text: string;
  /** Dates (YYYY-MM-DD) this rule was marked violated. */
  violationDates: string[];
}

/** Rule-compliance scenarios. Violations are logged per DAY (not per trade), so
    these compare trades on clean days against days a rule was broken: a general
    "days with no violations at all", plus one "exclude days you broke X" per
    rule that was actually violated on a day you traded. */
export function ruleScenarios(trades: TradeEntry[], rules: RuleForWhatIf[]): WhatIfScenario[] {
  const out: WhatIfScenario[] = [];
  const tradeDates = new Set(trades.map(t => t.dateISO));
  const allViolated = new Set<string>();
  for (const r of rules) for (const d of r.violationDates) allViolated.add(d);

  const hasDirty = [...tradeDates].some(d => allViolated.has(d));
  const hasClean = [...tradeDates].some(d => !allViolated.has(d));
  if (hasDirty && hasClean) {
    out.push({ id: 'clean_days', kind: 'cleanRuleDays', value: '', predicate: t => !allViolated.has(t.dateISO) });
  }
  for (const r of rules) {
    const vd = new Set(r.violationDates);
    const affected = [...tradeDates].filter(d => vd.has(d)).length;
    if (affected > 0 && affected < tradeDates.size) {
      out.push({ id: `xrule_${r.id}`, kind: 'excludeRuleDay', value: r.id, predicate: t => !vd.has(t.dateISO) });
    }
  }
  return out;
}
