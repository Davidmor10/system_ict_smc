// Cutting the pattern list down to what is worth reading.
//
// The screen this fixes: eleven cards, of which four reported the overall win
// rate back with a label on it ("MNQ: 33 עסקאות, 48%" — the whole journal),
// and three more described the same fifteen London trades under three
// different names ("MNQ · לונדון", "לונדון", "MNQ · Turtle Soup").
//
// Pruning is display-only, and one test below pins that: discoverPatterns must
// keep returning everything, because the intelligence layer needs the full
// list to tell "this weakened" from "this is gone".

import { describe, it, expect } from 'vitest';
import { discoverPatterns, prune, DEGENERATE_SHARE } from '../../app/lib/analytics/patterns';
import type { PatternCandidate } from '../../app/lib/analytics/types';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const t = (over: Partial<TradeEntry> = {}): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-10', time: '17:00', symbol: 'MNQ', direction: 'LONG',
  session: 'ny_am', entry: 100, stop: 95, target: 115, result: 'WIN',
  pnlUsd: 100, tradeR: 2, contracts: 1, bias: 'BULLISH', model: 'silver_bullet',
  notes: '', ...(over as object),
} as TradeEntry);

const cand = (over: Partial<PatternCandidate>): PatternCandidate => ({
  id: 'x', kind: 'weekday', subject: { weekday: 2 },
  metric: {
    key: 'x', label: 'x', trades: 10, wins: 7, losses: 3, winRate: 70,
    totalPnl: 100, avgRR: 1, avgWinner: 50, avgLoser: 25, profitFactor: 2,
    confidence: { level: 'medium', sampleSize: 10 },
  },
  baseline: 50, delta: 20, confidence: { level: 'medium', sampleSize: 10 },
  pValue: 0.01, pAdjusted: 0.02, significant: true, signature: 'a',
  ...over,
} as PatternCandidate);

describe('degenerate slices', () => {
  it('drops a slice that covers almost the whole journal', () => {
    // "MNQ: 33 of 33 trades, 48% — the overall rate." A label on the journal.
    const whole = cand({ id: 'whole', kind: 'instrument_best', subject: { instrument: 'MNQ' },
      metric: { ...cand({}).metric, trades: 33 }, signature: 'whole' });
    expect(prune([whole], 33)).toHaveLength(0);
  });

  it('keeps a slice that leaves a real comparison group behind', () => {
    const half = cand({ id: 'half', metric: { ...cand({}).metric, trades: 15 }, signature: 'half' });
    expect(prune([half], 33)).toHaveLength(1);
  });

  it('draws the line where the outside group stops being a group', () => {
    const total = 100;
    const justUnder = cand({ id: 'a', metric: { ...cand({}).metric, trades: Math.floor(total * DEGENERATE_SHARE) - 1 }, signature: 'a' });
    const atLimit  = cand({ id: 'b', metric: { ...cand({}).metric, trades: Math.ceil(total * DEGENERATE_SHARE) }, signature: 'b' });
    expect(prune([justUnder], total)).toHaveLength(1);
    expect(prune([atLimit], total)).toHaveLength(0);
  });
});

describe('duplicate slices', () => {
  it('keeps one card when two dimensions select the identical trades', () => {
    // The real case: every trade is MNQ, so "MNQ · London" and "London" are
    // the same fifteen trades twice.
    const combo  = cand({ id: 'mnq_london', kind: 'instrument+session',
      subject: { instrument: 'MNQ', session: 'london' }, signature: 'same' });
    const single = cand({ id: 'london', kind: 'session_vs_overall',
      subject: { session: 'london' }, signature: 'same' });
    const out = prune([combo, single], 40);
    expect(out).toHaveLength(1);
  });

  it('keeps the simpler label of the two', () => {
    // "London" tells the trader everything "MNQ · London" does, in one word.
    const combo  = cand({ id: 'mnq_london', kind: 'instrument+session',
      subject: { instrument: 'MNQ', session: 'london' }, signature: 'same' });
    const single = cand({ id: 'london', kind: 'session_vs_overall',
      subject: { session: 'london' }, signature: 'same' });
    expect(prune([combo, single], 40)[0].id).toBe('london');
  });

  it('keeps both when the sets genuinely differ', () => {
    const a = cand({ id: 'a', kind: 'session_vs_overall', subject: { session: 'london' }, signature: 'set-a' });
    const b = cand({ id: 'b', kind: 'emotion', subject: { emotion: 'FOMO' }, signature: 'set-b' });
    expect(prune([a, b], 40)).toHaveLength(2);
  });
});

describe('one card per subject', () => {
  it('keeps only the strongest card about sessions', () => {
    const strong = cand({ id: 's1', kind: 'instrument+session', subject: { instrument: 'MNQ', session: 'london' }, signature: 's1', pAdjusted: 0.001 });
    const weak   = cand({ id: 's2', kind: 'session+direction', subject: { session: 'london', direction: 'LONG' }, signature: 's2', pAdjusted: 0.04 });
    const out = prune([strong, weak], 60);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('s1');
  });

  it('still shows different subjects side by side', () => {
    // The point is one card per topic, not one card.
    const session = cand({ id: 'a', kind: 'session_vs_overall', subject: { session: 'london' }, signature: 'a' });
    const emotion = cand({ id: 'b', kind: 'emotion', subject: { emotion: 'FOMO' }, signature: 'b' });
    const rules   = cand({ id: 'c', kind: 'rules', subject: { rules: 'broken' }, signature: 'c' });
    const macro   = cand({ id: 'd', kind: 'macro', subject: { macro: 'release_day' }, signature: 'd' });
    expect(prune([session, emotion, rules, macro], 60).map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the rules dimension', () => {
  it('compares the trades the trader said they broke rules on', () => {
    const trades = [
      ...Array.from({ length: 8 }, () => t({ followedRules: true })),
      ...Array.from({ length: 8 }, () => t({ followedRules: false, result: 'LOSS', tradeR: -1, pnlUsd: -50 })),
    ];
    const ids = discoverPatterns(trades).filter(c => c.kind === 'rules').map(c => c.id);
    expect(ids).toContain('rules_kept');
    expect(ids).toContain('rules_broken');
  });

  it('treats an unanswered trade as invisible, never as clean', () => {
    const trades = [
      ...Array.from({ length: 8 }, () => t({ followedRules: true })),
      ...Array.from({ length: 8 }, () => t()),   // no answer
    ];
    const kept = discoverPatterns(trades).find(c => c.id === 'rules_kept');
    // Only the eight that actually answered — not sixteen.
    expect(kept?.metric.trades ?? 0).toBeLessThanOrEqual(8);
  });
});

describe('pruning is display-only', () => {
  it('discoverPatterns still returns the duplicates it found', () => {
    // The intelligence layer needs every candidate to tell "weakened" from
    // "gone". If pruning moved into discovery, a still-present pattern would
    // look like it had disappeared.
    const trades = [
      ...Array.from({ length: 10 }, () => t({ session: 'london', result: 'LOSS', tradeR: -1, pnlUsd: -50 })),
      ...Array.from({ length: 10 }, () => t({ session: 'ny_am' })),
    ];
    const all = discoverPatterns(trades);
    expect(all.length).toBeGreaterThan(prune(all, trades.length).length);
  });
});
