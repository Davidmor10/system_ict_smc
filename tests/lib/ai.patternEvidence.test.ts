// The trades behind a pattern card.
//
// The pattern cards stated numbers nobody could open. That is how a wrong
// claim survives: "10 of 33" is on screen, the ten trades are not, and the
// only way to check which ten is to read the detector's source.
//
// The ids were already there — the pattern engine stores each candidate's
// signature, which IS the sorted list of trade ids in the slice. These tests
// pin that the signature reaches the card intact, because the failure mode is
// silent: an empty list renders no toggle, and a card with no toggle looks
// exactly like a card whose toggle was never built.

import { describe, it, expect } from 'vitest';
import { discoverPatternRun } from '../../app/lib/analytics/patterns';
import { __testing } from '../../app/lib/ai/patternInsights';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-10',
  time: '17:00',
  symbol: 'MNQ',
  direction: 'LONG',
  session: 'ny_am',
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

/** A journal with a real split: London loses, NY AM wins. */
const journal = (): TradeEntry[] => [
  ...Array.from({ length: 12 }, (_, i) =>
    trade(i < 9
      ? { session: 'ny_am', result: 'WIN',  tradeR: 2,  pnlUsd: 200 }
      : { session: 'ny_am', result: 'LOSS', tradeR: -1, pnlUsd: -100 })),
  ...Array.from({ length: 12 }, (_, i) =>
    trade(i < 3
      ? { session: 'london', result: 'WIN',  tradeR: 2,  pnlUsd: 200 }
      : { session: 'london', result: 'LOSS', tradeR: -1, pnlUsd: -100 })),
];

describe('idsFromSignature', () => {
  const ids = __testing.idsFromSignature;

  it('reads the signature the pattern engine wrote', () => {
    expect(ids('3,1,2')).toEqual([3, 1, 2]);
  });

  it('yields nothing rather than throwing when there is no signature', () => {
    // A card with no toggle beats an analytics page that crashes.
    expect(ids(undefined)).toEqual([]);
    expect(ids('')).toEqual([]);
  });

  it('drops anything that is not a number', () => {
    expect(ids('1,,x,2')).toEqual([1, 2]);
  });
});

describe('a candidate carries its own trades', () => {
  it('names exactly the trades in the slice, and no others', () => {
    const trades = journal();
    const { candidates } = discoverPatternRun(trades);
    const london = candidates.find(c => c.subject.session === 'london');
    expect(london).toBeDefined();

    const got = __testing.idsFromSignature(london!.signature);
    const expected = trades.filter(t => t.session === 'london').map(t => t.id).sort((a, b) => a - b);
    expect(got.sort((a, b) => a - b)).toEqual(expected);
  });

  it('reports as many trades as the card claims', () => {
    // THE ONE THAT MATTERS. If the count on the card and the length of the
    // list can differ, the drill-down is worse than nothing — it looks like
    // proof and is not.
    const trades = journal();
    const { candidates } = discoverPatternRun(trades);
    for (const c of candidates) {
      const ids = __testing.idsFromSignature(c.signature);
      expect(ids).toHaveLength(c.metric.trades);
    }
  });

  it('gives every candidate a signature to be opened by', () => {
    const { candidates } = discoverPatternRun(journal());
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => __testing.idsFromSignature(c.signature).length > 0)).toBe(true);
  });

  it('resolves against the journal the page holds', () => {
    // The lookup the component does: ids → rows. Every id must find a trade,
    // or the table silently renders short.
    const trades = journal();
    const { candidates } = discoverPatternRun(trades);
    const byId = new Map(trades.map(t => [t.id, t]));
    for (const c of candidates) {
      for (const id of __testing.idsFromSignature(c.signature)) {
        expect(byId.has(id)).toBe(true);
      }
    }
  });
});
