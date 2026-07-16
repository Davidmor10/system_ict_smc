import type { TradeEntry, Direction } from '../journal';
import { INSTRUMENT_KEYS } from '../instruments';
import { SESS } from '../sessions';
import { computeGroupPerformance, normSession } from './metrics';
import { hourOf, weekdayOf } from './time';
import { analyzeInstruments } from './instruments';
import { analyzeSessions } from './sessions';
import type { PatternCandidate } from './types';

const DIRECTIONS: Direction[] = ['LONG', 'SHORT'];

/** Combines dimensions (instrument×session, session×direction, hour×instrument)
    plus each single-dimension standout, and ranks every candidate by
    confidence tier first, then by how far it deviates from the trader's
    overall win rate. This is the raw material for "today's discovery" — the
    AI layer only ever phrases the #1 candidate, never invents its own. */
export function discoverPatterns(trades: TradeEntry[]): PatternCandidate[] {
  const overall = computeGroupPerformance(trades, 'ALL', 'All');
  const baseline = overall.winRate;
  const candidates: PatternCandidate[] = [];

  const push = (kind: PatternCandidate['kind'], id: string, subject: Record<string, string | number>, subset: TradeEntry[], label: string) => {
    if (subset.length < 3) return; // below this, "patterns" are just noise
    const metric = computeGroupPerformance(subset, id, label);
    candidates.push({ id, kind, subject, metric, baseline, delta: metric.winRate - baseline, confidence: metric.confidence });
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
    candidates.push({ id: `inst_${g.key}`, kind: 'instrument_best', subject: { instrument: g.key }, metric: g, baseline, delta: g.winRate - baseline, confidence: g.confidence });
  }
  for (const g of analyzeSessions(trades)) {
    if (g.trades < 3) continue;
    candidates.push({ id: `sess_${g.key}`, kind: 'session_vs_overall', subject: { session: g.key }, metric: g, baseline, delta: g.winRate - baseline, confidence: g.confidence });
  }

  const tierWeight = (c: PatternCandidate) => (c.confidence.level === 'high' ? 2 : c.confidence.level === 'medium' ? 1 : 0);

  return candidates.sort((a, b) => {
    const tierDiff = tierWeight(b) - tierWeight(a);
    if (tierDiff !== 0) return tierDiff;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
}
