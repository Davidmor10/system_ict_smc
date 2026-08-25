// The sample floor on "your best hour".
//
// The bug this pins: eligibility for a superlative used to be `trades > 0`, so
// one trade at 03:00 that happened to win produced "your best hour: 03:00,
// 100% win rate" — and that sentence reached the coach's prompt as a plain
// fact, next to a patterns block built from the same trades reporting that no
// hour slice survived correction. Two contradictory statements, both true to
// their own rules, and a model free to quote either.

import { describe, it, expect } from 'vitest';
import { analyzeTime } from '../../app/lib/analytics/time';
import { summarizeAnalysis } from '../../app/lib/ai/factsBlock';
import { runFullAnalysis } from '../../app/lib/analytics';
import { MIN_DECIDED_FOR_CLAIM } from '../../app/lib/stats/evidence';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-10',
  time: '17:00',
  symbol: 'MNQ',
  direction: 'LONG',
  session: 'NY_AM',
  entry: 100,
  stop: 95,
  target: 115,
  result: 'WIN',
  pnlUsd: 100,
  tradeR: 2,
  contracts: 1,
  bias: 'BULLISH',
  model: '',
  notes: '',
  ...(over as object),
} as TradeEntry);

/** n trades at one hour, `wins` of them winners. */
const atHour = (hour: string, n: number, wins: number): TradeEntry[] =>
  Array.from({ length: n }, (_, i) =>
    trade(i < wins
      ? { time: hour, result: 'WIN',  tradeR: 2 }
      : { time: hour, result: 'LOSS', tradeR: -1, pnlUsd: -50 }));

describe('best/worst hour', () => {
  it('does not crown an hour that holds a single winning trade', () => {
    // THE REGRESSION. 03:00 has one trade and a 100% win rate; 17:00 has a
    // real sample. The lucky singleton must not outrank it.
    const trades = [...atHour('03:00', 1, 1), ...atHour('17:00', 12, 6)];
    const t = analyzeTime(trades);
    expect(t.bestHour?.label).not.toBe('03:00');
  });

  it('still lists that hour in the distribution', () => {
    // A count is a fact at any size. What has to be earned is the word "best".
    const trades = [...atHour('03:00', 1, 1), ...atHour('17:00', 12, 6)];
    const t = analyzeTime(trades);
    expect(t.byHour.map(g => g.label)).toContain('03:00');
  });

  it('names no best hour at all when nothing clears the floor', () => {
    // Silence is the honest output. A trader with four trades spread over four
    // hours has no best hour, and saying so beats picking one.
    const trades = [
      ...atHour('09:00', 2, 2), ...atHour('11:00', 2, 1),
      ...atHour('15:00', 2, 0), ...atHour('17:00', 2, 1),
    ];
    expect(analyzeTime(trades).bestHour).toBeNull();
  });

  it('names one once an hour carries enough decided trades', () => {
    const trades = [
      ...atHour('17:00', MIN_DECIDED_FOR_CLAIM, MIN_DECIDED_FOR_CLAIM),
      ...atHour('09:00', MIN_DECIDED_FOR_CLAIM, 0),
    ];
    const t = analyzeTime(trades);
    expect(t.bestHour?.label).toBe('17:00');
    expect(t.worstHour?.label).toBe('09:00');
  });

  it('counts decided trades, not open ones, toward the floor', () => {
    // Eight OPEN trades are eight things that have not finished happening.
    const trades = Array.from({ length: 10 }, () =>
      trade({ time: '21:00', result: 'OPEN', tradeR: undefined, pnlUsd: undefined }));
    expect(analyzeTime([...trades, ...atHour('17:00', 10, 5)]).bestHour?.label).not.toBe('21:00');
  });
});

describe('best month', () => {
  it('applies the same floor as the paired extremes', () => {
    const trades = [
      ...atHour('17:00', 1, 1).map(t => ({ ...t, dateISO: '2026-03-02' })),
      ...atHour('17:00', 12, 6).map(t => ({ ...t, dateISO: '2026-08-10' })),
    ];
    expect(analyzeTime(trades).bestMonth?.label).not.toBe('2026-03');
  });
});

describe('weeks stay exempt', () => {
  it('still names a strongest week from a small sample', () => {
    // Deliberate. "Your best week was the week of the 12th" is a statement
    // about something that happened; nobody trades the week of the 12th again.
    // Hours and weekdays recur, and naming one the best is a recommendation.
    const trades = [
      ...atHour('17:00', 2, 2).map(t => ({ ...t, dateISO: '2026-08-10' })),
      ...atHour('17:00', 2, 0).map(t => ({ ...t, dateISO: '2026-08-17' })),
    ];
    expect(analyzeTime(trades).strongestWeek).not.toBeNull();
  });
});

describe('the facts block', () => {
  it('marks the superlatives as untested and defers to the corrected block', () => {
    const trades = [
      ...atHour('17:00', MIN_DECIDED_FOR_CLAIM, MIN_DECIDED_FOR_CLAIM),
      ...atHour('09:00', MIN_DECIDED_FOR_CLAIM, 0),
    ];
    const text = summarizeAnalysis(runFullAnalysis(trades));
    expect(text).toContain('NOT tested for significance');
    expect(text).toContain('that block wins');
  });

  it('omits the section entirely when no bucket earned a superlative', () => {
    const trades = [...atHour('09:00', 2, 2), ...atHour('15:00', 2, 0)];
    const text = summarizeAnalysis(runFullAnalysis(trades));
    expect(text).not.toContain('Best hour:');
  });
});
