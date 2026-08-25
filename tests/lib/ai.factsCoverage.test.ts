// What the chat is allowed to see, and what it is told about it.
//
// Two failures matter here and neither one crashes:
//
//   1. A slice that did not survive the multiple-comparison correction being
//      handed over without that verdict attached. The model would read a
//      70%-vs-50% line and call it an edge, which is the exact failure the
//      correction exists to prevent — undone at the last step, in the prompt.
//
//   2. A depth figure rendered without its scope. The same function renders a
//      whole history and a single week; "longest losing streak: 3" means very
//      different things in the two, and unlabelled the weekly block hands the
//      model a within-the-week number to state as a career high.

import { describe, it, expect } from 'vitest';
import {
  summarizePatterns,
  summarizeDepth,
  MAX_PATTERNS_IN_FACTS,
} from '../../app/lib/ai/factsBlock';
import { buildFactsContext } from '../../app/lib/ai/chatPrompt';
import { runFullAnalysis } from '../../app/lib/analytics';
import type { PatternCandidate, FullAnalysis } from '../../app/lib/analytics';
import type { TradeEntry } from '../../app/lib/journal';

const candidate = (over: Partial<PatternCandidate> = {}): PatternCandidate => ({
  id: 'p1',
  kind: 'weekday',
  subject: { weekday: 2 },
  metric: {
    key: 'p1', label: 'Tuesday', trades: 12, wins: 9, losses: 3,
    winRate: 75, totalPnl: 900, avgRR: 2.1, avgWinner: 150, avgLoser: 80,
    profitFactor: 3.1, confidence: { level: 'medium', sampleSize: 12 },
  },
  baseline: 50,
  delta: 25,
  confidence: { level: 'medium', sampleSize: 12 },
  pValue: 0.004,
  pAdjusted: 0.4,
  significant: false,
  ...over,
});

const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000,
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

describe('summarizePatterns', () => {
  it('attaches the verdict to every single line, not just to the heading', () => {
    // A heading is skimmable; a per-line verdict is not. Both groups present,
    // so a model reading any one line in isolation still gets the constraint.
    const text = summarizePatterns([
      candidate({ id: 'a', significant: true, pAdjusted: 0.0004 }),
      candidate({ id: 'b', significant: false, pAdjusted: 0.31 }),
    ]);
    const lines = text.split('\n').filter(l => l.startsWith('- '));
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatch(/SURVIVED|did NOT survive/);
    }
  });

  it('forbids the word pattern for an unconfirmed slice, in the line itself', () => {
    const text = summarizePatterns([candidate({ significant: false })]);
    expect(text).toContain('never to be called an edge or a pattern');
  });

  it('says plainly when nothing survived, rather than omitting the section', () => {
    // Silence here reads as "no data". The trader asking "do I have an edge on
    // Tuesdays" deserves the real answer, which is that it was tested.
    const text = summarizePatterns([candidate({ significant: false })]);
    expect(text).toContain('CONFIRMED PATTERNS: none');
    expect(text).toContain('not yet distinguishable from chance');
  });

  it('never drops a confirmed pattern to honour the cap', () => {
    // The cap exists to protect the prompt from a hundred slices, not to hide
    // findings. Twenty confirmed patterns must all survive it.
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: `s${i}`, significant: true, pAdjusted: 0.001 }));
    const text = summarizePatterns(many);
    expect(text.split('\n').filter(l => l.startsWith('- '))).toHaveLength(20);
  });

  it('caps the unconfirmed tail and orders it by closeness to significance', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      candidate({ id: `u${i}`, significant: false, pAdjusted: (i + 1) / 100 }));
    const text = summarizePatterns(many);
    const lines = text.split('\n').filter(l => l.startsWith('- '));
    expect(lines).toHaveLength(MAX_PATTERNS_IN_FACTS);
    // The closest to significance is first.
    expect(lines[0]).toContain('p=0.010');
  });

  it('returns empty for no candidates rather than an empty heading', () => {
    expect(summarizePatterns([])).toBe('');
  });
});

describe('summarizeDepth', () => {
  const analysisOf = (trades: TradeEntry[]): FullAnalysis => runFullAnalysis(trades);

  it('labels every heading with the scope it was computed over', () => {
    const a = analysisOf([
      trade({ id: 1, result: 'WIN',  tradeR: 2 }),
      trade({ id: 2, result: 'LOSS', tradeR: -1, pnlUsd: -50 }),
      trade({ id: 3, result: 'WIN',  tradeR: 1.5 }),
    ]);
    const weekly = summarizeDepth(a, 'THIS WEEK ONLY');
    for (const heading of ['EXPECTANCY', 'STREAKS', 'RECORD COMPLETENESS']) {
      const line = weekly.split('\n\n').find(l => l.startsWith(heading));
      expect(line, `${heading} block missing`).toBeDefined();
      expect(line).toContain('THIS WEEK ONLY');
    }
  });

  it('defaults to naming the whole history, never to an unscoped number', () => {
    const a = analysisOf([trade({ id: 1 }), trade({ id: 2, result: 'LOSS', tradeR: -1 })]);
    expect(summarizeDepth(a)).toContain('OVER THE WHOLE RECORDED HISTORY');
  });

  it('states that completeness bounds what may be concluded', () => {
    const a = analysisOf([trade({ id: 1 }), trade({ id: 2, result: 'LOSS', tradeR: -1 })]);
    const text = summarizeDepth(a);
    expect(text).toContain('THIS BOUNDS WHAT YOU MAY CONCLUDE');
    expect(text).toContain('cannot answer it yet');
  });

  it('reports the expectancy decomposition, not just the figure', () => {
    const a = analysisOf([
      trade({ id: 1, result: 'WIN',  tradeR: 3 }),
      trade({ id: 2, result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
      trade({ id: 3, result: 'WIN',  tradeR: 2 }),
    ]);
    const text = summarizeDepth(a);
    expect(text).toContain('avg winner');
    expect(text).toContain('avg loser');
    expect(text).toMatch(/EXIT problem/);
    expect(text).toMatch(/ENTRY problem/);
  });

  it('renders the expectancy win rate on the percent scale', () => {
    // A REGRESSION. expectancy().winRate is a 0-1 fraction while
    // GroupPerformance.winRate is already 0-100; rendering the first with the
    // second's formatter printed a 50% win rate as "1%" and handed that to the
    // model as fact. Two wins and two losses must read as 50%.
    const a = analysisOf([
      trade({ id: 1, result: 'WIN',  tradeR: 2 }),
      trade({ id: 2, result: 'WIN',  tradeR: 2 }),
      trade({ id: 3, result: 'LOSS', tradeR: -1, pnlUsd: -50 }),
      trade({ id: 4, result: 'LOSS', tradeR: -1, pnlUsd: -50 }),
    ]);
    expect(summarizeDepth(a)).toContain('winRate 50%');
  });

  it('describes a breakeven as breaking the streak rather than as a win', () => {
    const a = analysisOf([trade({ id: 1, result: 'WIN', tradeR: 1 }), trade({ id: 2, result: 'BE', tradeR: 0, pnlUsd: 0 })]);
    expect(summarizeDepth(a)).toContain('no active streak');
  });
});

describe('buildFactsContext', () => {
  const trades = [
    trade({ id: 1, result: 'WIN',  tradeR: 2 }),
    trade({ id: 2, result: 'LOSS', tradeR: -1, pnlUsd: -50 }),
    trade({ id: 3, result: 'WIN',  tradeR: 1.5, dateISO: '2026-08-11' }),
    trade({ id: 4, result: 'LOSS', tradeR: -1, pnlUsd: -50, dateISO: '2026-08-11' }),
  ];

  it('carries the depth layer into the block the chat actually receives', () => {
    // The regression this exists for: all four were computed for the stats
    // page and none of them reached this prompt.
    const facts = buildFactsContext(runFullAnalysis(trades), '', '');
    expect(facts).toContain('EXPECTANCY');
    expect(facts).toContain('STREAKS');
    expect(facts).toContain('RECORD COMPLETENESS');
  });

  it('still carries the summary tables it always did', () => {
    const facts = buildFactsContext(runFullAnalysis(trades), '', '');
    expect(facts).toContain('OVERALL:');
    expect(facts).toContain('BY INSTRUMENT:');
  });

  it('keeps established facts and the hypothesis line', () => {
    const facts = buildFactsContext(runFullAnalysis(trades), '- trades MNQ only', 'CURRENT EDGE HYPOTHESIS: x');
    expect(facts).toContain('ESTABLISHED FACTS ABOUT THIS TRADER');
    expect(facts).toContain('CURRENT EDGE HYPOTHESIS');
  });
});
