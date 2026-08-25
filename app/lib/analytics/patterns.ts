import type { TradeEntry, Direction } from '../journal';
import { INSTRUMENT_KEYS } from '../instruments';
import { SESS } from '../sessions';
import { computeGroupPerformance, normSession } from './metrics';
import { hourOf, weekdayOf } from './time';
import { analyzeInstruments } from './instruments';
import { calcRR } from '../calc/trade';
import { analyzeSessions } from './sessions';
import type { PatternCandidate } from './types';
import { fisherExactTwoSided, bonferroni } from '../stats/fisher';
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';
import { splitByRelease } from './macro';

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

  // planned reward-to-risk, in buckets.
  //
  // The one comparison a journal exists to make, and the only one the engine
  // was not making: everything else measures a slice against the trader's
  // baseline, never against what the trader themselves planned. "Your win rate
  // on two-R plans is 61% and on four-R plans it is 22%" answers a question no
  // other dimension can — am I planning targets I can actually reach.
  //
  // Bucketed rather than continuous on purpose. A slice per exact ratio is a
  // slice of one, and the honest resolution here is coarse.
  {
    const RR_BUCKETS: Array<{ key: string; label: string; lo: number; hi: number }> = [
      { key: 'rr_lt15', label: 'Planned R:R under 1.5', lo: 0,   hi: 1.5 },
      { key: 'rr_15_25', label: 'Planned R:R 1.5–2.5',  lo: 1.5, hi: 2.5 },
      { key: 'rr_25_4', label: 'Planned R:R 2.5–4',     lo: 2.5, hi: 4 },
      { key: 'rr_gt4', label: 'Planned R:R above 4',    lo: 4,   hi: Infinity },
    ];
    for (const b of RR_BUCKETS) {
      const subset = trades.filter(t => {
        const rr = calcRR(t.entry, t.stop, t.target);
        return rr !== null && rr >= b.lo && rr < b.hi;
      });
      push('planned_rr', b.key, { plannedRR: b.key }, subset, b.label);
    }
  }

  // logged the same day, or later.
  //
  // The journal's id is the millisecond the trade was written down, and
  // `dateISO` is the day it happened — so the gap between them is a habit the
  // trader has never been shown. Late logging is not a mistake in itself; it
  // is worth measuring because it travels with the days someone would rather
  // not look at, and that is a claim the numbers can settle rather than assert.
  {
    const lagOf = (t: TradeEntry): number | null => {
      // Ids predate this convention in imported histories; a value that is not
      // a plausible millisecond timestamp is silence, not zero.
      if (!Number.isFinite(t.id) || t.id < 946684800000) return null;
      const logged = new Date(t.id);
      const day = `${logged.getFullYear()}-${String(logged.getMonth() + 1).padStart(2, '0')}-${String(logged.getDate()).padStart(2, '0')}`;
      return day === t.dateISO ? 0 : 1;
    };
    const sameDay = trades.filter(t => lagOf(t) === 0);
    const later   = trades.filter(t => lagOf(t) === 1);
    if (sameDay.length >= 3 && later.length >= 3) {
      push('logging', 'log_same_day', { logging: 'same_day' }, sameDay, 'Logged same day');
      push('logging', 'log_later',    { logging: 'later' },    later,   'Logged later');
    }
  }

  // documented vs not — the trades the trader bothered to screenshot.
  //
  // Not a claim that a screenshot improves a trade. It is a proxy for care:
  // the trades someone stops to capture are usually the ones they took
  // deliberately, and a gap between the two groups is worth showing precisely
  // because the trader can act on it in a way they cannot act on "be more
  // disciplined". The subject label says "documented", never "screenshotted
  // trades perform better".
  {
    const documented = trades.filter(t => (t.hasScreenshot ?? ((t.screenshots?.length ?? 0) > 0)));
    const undocumented = trades.filter(t => !(t.hasScreenshot ?? ((t.screenshots?.length ?? 0) > 0)));
    // Both sides or neither: a split with nothing on one side is not a
    // comparison, it is the whole history wearing a label.
    if (documented.length >= 3 && undocumented.length >= 3) {
      push('documentation', 'doc_yes', { documented: 'yes' }, documented, 'Documented');
      push('documentation', 'doc_no', { documented: 'no' }, undocumented, 'Not documented');
    }
  }

  // scheduled US release days, and the tight window around the release.
  //
  // The one macro fact that needs no data feed: the Employment Situation
  // report is released 08:30 New York on the first Friday of most months, and
  // for index futures it is the largest scheduled mover of the month. See
  // lib/analytics/macro for why FOMC and CPI are deliberately absent.
  //
  // Two slices, and they answer different questions. The DAY split asks
  // whether this trader should be in the market at all on release day — it
  // needs only the date, so it works on every trade. The WINDOW split asks
  // about the ninety minutes around the print, and only sees trades that
  // recorded an entry time; its counterpart group is restricted the same way,
  // so a trader who logs times inconsistently is not compared against himself
  // on two different standards.
  //
  // The zone is the app default rather than the trader's setting: this runs
  // server-side, where the setting (localStorage) is not readable. For every
  // zone from the US through Europe and Israel the release lands on the same
  // calendar day either way; only the far-east zones can roll over, and for
  // those the day split would be a square out.
  {
    const split = splitByRelease(trades);
    if (split.releaseDay.length >= 3 && split.otherDays.length >= 3) {
      push('macro', 'macro_release_day', { macro: 'release_day' }, split.releaseDay, 'First Friday of the month');
      push('macro', 'macro_other_day',   { macro: 'other_day' },   split.otherDays,  'Other days');
    }
    if (split.inWindow.length >= 3 && split.outOfWindow.length >= 3) {
      push('macro', 'macro_in_window',  { macro: 'in_window' },  split.inWindow,  'Around the release');
      push('macro', 'macro_out_window', { macro: 'out_window' }, split.outOfWindow, 'Away from the release');
    }
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
