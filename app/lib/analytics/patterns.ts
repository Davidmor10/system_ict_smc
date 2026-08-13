import type { TradeEntry, Direction } from '../journal';
import { INSTRUMENT_KEYS } from '../instruments';
import { SESS } from '../sessions';
import { computeGroupPerformance, normSession } from './metrics';
import { hourOf, weekdayOf } from './time';
import { analyzeInstruments } from './instruments';
import { analyzeSessions } from './sessions';
import type { PatternCandidate } from './types';
import { fisherExactTwoSided, bonferroni } from '../stats/fisher';
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';

const DIRECTIONS: Direction[] = ['LONG', 'SHORT'];

/** Adjusted p below this is a pattern; at or above it is a slice that happened
 *  to look good. 0.05 after correction, which on a hundred comparisons means a
 *  raw p of about 0.0005 — deliberately hard to reach, because the cost of
 *  being wrong here is a trader sizing up on noise. */
export const PATTERN_ALPHA = 0.05;
/** Decided trades a slice needs before its p-value is even considered. Below
 *  this, Fisher can still return a small number on a freak split, and a
 *  "significant" finding built on four trades would be the exact failure the
 *  test was added to prevent.
 *
 *  Shared with the behaviour layer and the root-cause labeller — see
 *  lib/stats/evidence for why the number is defined once. */
export const PATTERN_MIN_DECIDED = MIN_DECIDED_FOR_CLAIM;

/** One candidate with its raw p-value. `pAdjusted` and `significant` are
 *  filled in at the end, when the number of comparisons is known — the
 *  correction depends on how many slices this particular history produced,
 *  which is not knowable while they are still being produced. */
function rawCandidate(
  id: string,
  kind: PatternCandidate['kind'],
  subject: Record<string, string | number>,
  metric: PatternCandidate['metric'],
  baseline: number,
  allWins: number,
  allLosses: number,
): PatternCandidate {
  // The slice against everything outside it. Subtracting the slice from the
  // totals is what makes the two groups disjoint — testing a group against a
  // pool that contains it understates every real difference, and the bigger
  // the slice the more it understates.
  const outWins   = allWins   - metric.wins;
  const outLosses = allLosses - metric.losses;
  const pValue = fisherExactTwoSided(metric.wins, metric.losses, outWins, outLosses);

  return {
    id, kind, subject, metric, baseline,
    delta: metric.winRate - baseline,
    confidence: metric.confidence,
    pValue,
    pAdjusted: 1,      // filled in below
    significant: false,
  };
}

/** Slice the history every way that might mean something, then test whether
    any of it survives being tested.
    
    The first half is discovery and is meant to be greedy — instrument×session,
    hour×instrument, tag combinations, weekday, emotion. The second half is the
    part that decides what a trader is allowed to be told: each slice against
    the trades outside it, corrected for how many slices were tried. Consumers
    rank by `significant` first; a candidate that failed is still tracked, and
    still may not be called an edge. */
export function discoverPatterns(trades: TradeEntry[]): PatternCandidate[] {
  const overall = computeGroupPerformance(trades, 'ALL', 'All');
  const baseline = overall.winRate;
  const candidates: PatternCandidate[] = [];

  // Wins and losses of the whole history, so each slice can be tested against
  // everything it is not.
  const allWins   = trades.filter(t => t.result === 'WIN').length;
  const allLosses = trades.filter(t => t.result === 'LOSS').length;

  const push = (kind: PatternCandidate['kind'], id: string, subject: Record<string, string | number>, subset: TradeEntry[], label: string) => {
    if (subset.length < 3) return; // below this, "patterns" are just noise
    const metric = computeGroupPerformance(subset, id, label);
    candidates.push(rawCandidate(id, kind, subject, metric, baseline, allWins, allLosses));
  };

  // instrument × session
  for (const sym of INSTRUMENT_KEYS) {
    for (const s of SESS) {
      const subset = trades.filter(t => t.symbol === sym && normSession(t.session) === s.key);
      push('instrument+session', `${sym}_${s.key}`, { instrument: sym, session: s.key }, subset, `${sym} · ${s.en}`);
    }
  }

  // session × direction
  for (const s of SESS) {
    for (const dir of DIRECTIONS) {
      const subset = trades.filter(t => normSession(t.session) === s.key && t.direction === dir);
      push('session+direction', `${s.key}_${dir}`, { session: s.key, direction: dir }, subset, `${dir} · ${s.en}`);
    }
  }

  // hour × instrument
  const hoursSeen = new Set<number>();
  for (const t of trades) {
    const h = hourOf(t);
    if (h !== null) hoursSeen.add(h);
  }
  for (const h of hoursSeen) {
    for (const sym of INSTRUMENT_KEYS) {
      const subset = trades.filter(t => hourOf(t) === h && t.symbol === sym);
      push('hour+instrument', `${sym}_h${h}`, { instrument: sym, hour: h }, subset, `${sym} @ ${String(h).padStart(2, '0')}:00`);
    }
  }

  // instrument × confirmation (model/setup tag) and confirmation × hour
  const modelsSeen = new Set<string>();
  for (const t of trades) if (t.model) modelsSeen.add(t.model);
  for (const m of modelsSeen) {
    for (const sym of INSTRUMENT_KEYS) {
      const subset = trades.filter(t => t.model === m && t.symbol === sym);
      push('instrument+confirmation', `${sym}_${m}`, { instrument: sym, confirmation: m }, subset, `${sym} · ${m}`);
    }
    for (const h of hoursSeen) {
      const subset = trades.filter(t => t.model === m && hourOf(t) === h);
      push('confirmation+hour', `${m}_h${h}`, { confirmation: m, hour: h }, subset, `${m} @ ${String(h).padStart(2, '0')}:00`);
    }
  }

  // direction × hour
  for (const dir of DIRECTIONS) {
    for (const h of hoursSeen) {
      const subset = trades.filter(t => t.direction === dir && hourOf(t) === h);
      push('direction+hour', `${dir}_h${h}`, { direction: dir, hour: h }, subset, `${dir} @ ${String(h).padStart(2, '0')}:00`);
    }
  }

  // emotional state — how the trader's state at entry tracks with results
  const emotionsSeen = new Set<string>();
  for (const t of trades) if (t.emotionalState) emotionsSeen.add(t.emotionalState);
  for (const e of emotionsSeen) {
    const subset = trades.filter(t => t.emotionalState === e);
    push('emotion', `emotion_${e}`, { emotion: e }, subset, `Emotion: ${e}`);
  }

  // confirmation tags — per single tag, and per exact multi-tag combo, so the
  // trader sees both "SMT present at all" and "SMT+IFVG stacked together"
  const tagsSeen = new Set<string>();
  for (const t of trades) for (const c of t.confirmations ?? []) tagsSeen.add(c);
  for (const tag of tagsSeen) {
    const subset = trades.filter(t => (t.confirmations ?? []).includes(tag));
    push('confirmation_tag', `conf_${tag}`, { confirmationTag: tag }, subset, `Confirmation: ${tag}`);
  }
  const comboGroups = new Map<string, TradeEntry[]>();
  for (const t of trades) {
    const tags = t.confirmations ?? [];
    if (tags.length < 2) continue; // single tags are already covered above
    const key = [...tags].sort().join('+');
    const arr = comboGroups.get(key);
    if (arr) arr.push(t); else comboGroups.set(key, [t]);
  }
  for (const [key, subset] of comboGroups) {
    push('confirmation_combo', `combo_${key}`, { confirmationCombo: key }, subset, `Combo: ${key}`);
  }

  // bias alignment — trades taken with vs against the trader's own stated bias
  for (const ba of ['ALIGNED', 'COUNTER'] as const) {
    const subset = trades.filter(t => t.biasAlignment === ba);
    push('bias_alignment', `bias_${ba}`, { biasAlignment: ba }, subset, `Bias: ${ba}`);
  }

  // setup — the trader's structured setup tag (reversal vs continuation)
  for (const s of ['REVERSAL', 'CONTINUATION'] as const) {
    const subset = trades.filter(t => t.setup === s);
    push('setup', `setup_${s}`, { setup: s }, subset, `Setup: ${s}`);
  }

  // weekday — day of week the trade was taken
  const weekdaysSeen = new Set<number>();
  for (const t of trades) weekdaysSeen.add(weekdayOf(t));
  for (const w of weekdaysSeen) {
    const subset = trades.filter(t => weekdayOf(t) === w);
    push('weekday', `weekday_${w}`, { weekday: w }, subset, `Weekday: ${w}`);
  }

  // single-dimension standouts, in case combos stay too sparse for a while
  for (const g of analyzeInstruments(trades)) {
    if (g.trades < 3) continue;
    candidates.push(rawCandidate(`inst_${g.key}`, 'instrument_best', { instrument: g.key }, g, baseline, allWins, allLosses));
  }
  for (const g of analyzeSessions(trades)) {
    if (g.trades < 3) continue;
    candidates.push(rawCandidate(`sess_${g.key}`, 'session_vs_overall', { session: g.key }, g, baseline, allWins, allLosses));
  }

  // The correction, applied once every slice is known.
  //
  // This is the step the whole file was missing. Everything above deliberately
  // slices the same trades a hundred different ways, which is the right way to
  // FIND a candidate and a catastrophic way to CONFIRM one: at a hundred
  // comparisons, several slices clear any win-rate gap you care to name by
  // chance alone — for every trader, every time, including one trading at
  // random. Ranking them and showing the top of the list is a machine for
  // manufacturing confident nonsense.
  const comparisons = candidates.length;
  for (const c of candidates) {
    c.pAdjusted = bonferroni(c.pValue, comparisons);
    c.significant = c.pAdjusted < PATTERN_ALPHA
      && c.metric.wins + c.metric.losses >= PATTERN_MIN_DECIDED;
  }

  const tierWeight = (c: PatternCandidate) => (c.confidence.level === 'high' ? 2 : c.confidence.level === 'medium' ? 1 : 0);

  // Significant first, then the old ordering within each group. Candidates that
  // failed the test are kept — they are the raw material for next month, when
  // the sample may have grown — but nothing downstream may call them an edge.
  return candidates.sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1;
    const tierDiff = tierWeight(b) - tierWeight(a);
    if (tierDiff !== 0) return tierDiff;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
}
