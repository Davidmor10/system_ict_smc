// Entry headings, and the number in them.
//
// The title carried the raw trade id: "עסקה #1786558819914 · MNQ · שורט".
// That number is a millisecond timestamp — a database key printed in a heading
// a person reads. It sorts correctly and tells the trader nothing: they cannot
// recognise a trade by it, cannot say it out loud, and on a narrow column it
// pushes the parts that DO identify the trade off the end.
//
// The number is now the trade's place in their own journal. #1 is the first
// trade they ever documented, which is a fact about them rather than about the
// row.

import { describe, it, expect } from 'vitest';
import {
  seedTradeEntries, renumberTradeEntries, tradeEntryTitle,
} from '../../app/lib/notebook/store';
import type { NotebookEntry } from '../../app/lib/notebook/store';
import type { TradeEntry } from '../../app/lib/journal';

const trade = (id: number, dateISO: string, over: Partial<TradeEntry> = {}): TradeEntry => ({
  id, dateISO, time: '17:00', symbol: 'MNQ', direction: 'LONG', session: 'ny_am',
  entry: 20000, stop: 19980, target: 20060, result: 'WIN', pnlUsd: 200, tradeR: 2,
  contracts: 3, bias: 'BULLISH', model: '', notes: '', ...(over as object),
} as TradeEntry);

const entry = (over: Partial<NotebookEntry>): NotebookEntry => ({
  id: 'e', folderId: 'trades', title: '', bodyHtml: '', tags: [],
  dateISO: '2026-08-17', createdAt: 1, updatedAt: 1, ...(over as object),
} as NotebookEntry);

/** Ids deliberately unordered relative to the dates — the bug this replaces
 *  came from trusting the id as an ordering. */
const journal = () => [
  trade(1786558819914, '2026-08-24', { direction: 'SHORT' }),
  trade(1786556573854, '2026-08-17'),
  trade(1786556854241, '2026-08-18', { direction: 'SHORT' }),
];

describe('seedTradeEntries', () => {
  it('numbers by journal order, not by id', () => {
    const byTrade = new Map(seedTradeEntries(journal(), []).map(e => [e.tradeId, e.title]));
    expect(byTrade.get(1786556573854)).toBe('עסקה #1 · MNQ · לונג');
    expect(byTrade.get(1786556854241)).toBe('עסקה #2 · MNQ · שורט');
    expect(byTrade.get(1786558819914)).toBe('עסקה #3 · MNQ · שורט');
  });

  it('never puts a raw id in a heading', () => {
    // THE REGRESSION, stated as the invariant. Any number in the title has to
    // be small enough to be a position.
    for (const e of seedTradeEntries(journal(), [])) {
      const n = Number(/#(\d+)/.exec(e.title)?.[1]);
      expect(n, e.title).toBeLessThan(100_000);
    }
  });

  it('breaks a same-day tie stably', () => {
    const same = [trade(200, '2026-08-17'), trade(100, '2026-08-17')];
    const a = seedTradeEntries(same, []).map(e => e.title).sort();
    const b = seedTradeEntries([...same].reverse(), []).map(e => e.title).sort();
    expect(a).toEqual(b);
  });

  it('skips a trade that already has an entry', () => {
    const existing = seedTradeEntries(journal(), []);
    expect(seedTradeEntries(journal(), existing)).toEqual([]);
  });
});

describe('renumberTradeEntries', () => {
  it('rewrites a heading left over from the id numbering', () => {
    const stale = [entry({
      id: 'trade-1786556573854', title: 'עסקה #1786556573854 · MNQ · לונג',
      tradeId: 1786556573854,
    })];
    const out = renumberTradeEntries(journal(), stale);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('עסקה #1 · MNQ · לונג');
  });

  it('shifts the numbers when a trade is logged late but dated early', () => {
    // The position is a fact about the journal, so it moves when the journal
    // does. A trade entered today for last week takes #1 and everything after
    // it slides down.
    const seeded = seedTradeEntries(journal(), []);
    const withEarlier = [...journal(), trade(1786000000000, '2026-08-01')];
    const byTrade = new Map(renumberTradeEntries(withEarlier, seeded).map(e => [e.tradeId, e.title]));
    expect(byTrade.get(1786556573854)).toBe('עסקה #2 · MNQ · לונג');
    expect(byTrade.get(1786558819914)).toBe('עסקה #4 · MNQ · שורט');
  });

  it('leaves a heading the trader wrote themselves alone', () => {
    // The worse bug by far. A title is editable, and renaming one somebody
    // chose would be the feature destroying their work to tidy itself.
    const mine = [entry({
      id: 'trade-1786556573854', title: 'הכניסה שסוף סוף חיכיתי לה',
      tradeId: 1786556573854,
    })];
    expect(renumberTradeEntries(journal(), mine)).toEqual([]);
  });

  it('writes nothing at all when the numbering already agrees', () => {
    // Runs on every pass, so a settled journal has to be free.
    const seeded = seedTradeEntries(journal(), []);
    expect(renumberTradeEntries(journal(), seeded)).toEqual([]);
  });

  it('ignores entries that are not trade entries', () => {
    const note = [entry({ id: 'n1', folderId: 'notes', title: 'עסקה #9 · MNQ · לונג' })];
    expect(renumberTradeEntries(journal(), note)).toEqual([]);
  });

  it('ignores an entry whose trade is gone from the journal', () => {
    const orphan = [entry({ id: 'trade-999', title: 'עסקה #999 · MNQ · לונג', tradeId: 999 })];
    expect(renumberTradeEntries(journal(), orphan)).toEqual([]);
  });
});

describe('tradeEntryTitle', () => {
  it('names the direction in the trader’s language', () => {
    expect(tradeEntryTitle(trade(1, '2026-08-17'), 4)).toBe('עסקה #4 · MNQ · לונג');
    expect(tradeEntryTitle(trade(1, '2026-08-17', { direction: 'SHORT' }), 4))
      .toBe('עסקה #4 · MNQ · שורט');
  });
});
