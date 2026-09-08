// Reconstructing trades from a TradingView Paper Trading order export.
//
// The fixture is the trader's own file — 50 rows, 34 filled orders, one
// account, MNQ throughout. It is used rather than a synthetic one because the
// awkward cases are the point: a 12-contract short built out of three separate
// sells, and two distinct trades on the same symbol seven seconds apart. A
// hand-written fixture would have neither, and the naive grouping (three rows
// per trade) passes on a hand-written fixture and fails on this.
//
// Where a figure below is checked against a number, that number came off the
// trader's own screenshots of the same trades in another product — so the
// reconstruction is measured against something outside this codebase.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  parseTradingViewOrders, readCsvRows, UnrecognisedExport, type ParsedTrade,
} from '../../app/lib/import/tradingview';

const csv = readFileSync('tests/fixtures/tradingview-orders.csv', 'utf8');
const result = parseTradingViewOrders(csv);
const byDate = (d: string) => result.trades.filter(t => t.openedAt.startsWith(d));

/** MNQ: tickValue 0.5 / tickSize 0.25. */
const PV = 2;
const pnl = (t: ParsedTrade) =>
  t.exit === null ? null : (t.exit - t.entry) * (t.direction === 'LONG' ? 1 : -1) * PV * t.contracts;

describe('the CSV reader', () => {
  it('keeps a quoted field that contains a comma in one piece', () => {
    // The Margin column is always "5,905.05 USD". Splitting on commas alone
    // shifts every column after it by one.
    const rows = readCsvRows('a,b,c\n1,"5,905.05 USD",3\n');
    expect(rows[1]).toEqual(['1', '5,905.05 USD', '3']);
  });

  it('handles a doubled quote inside a quoted field', () => {
    expect(readCsvRows('x\n"he said ""hi"""\n')[1]).toEqual(['he said "hi"']);
  });

  it('does not lose a final row without a trailing newline', () => {
    expect(readCsvRows('a,b\n1,2').length).toBe(2);
  });
});

describe('refusing a file it does not recognise', () => {
  it('names the columns it needed', () => {
    let thrown: unknown;
    try { parseTradingViewOrders('Date,Price\n2026-01-01,5\n'); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(UnrecognisedExport);
    expect((thrown as UnrecognisedExport).missing).toContain('Symbol');
  });

  it('refuses an empty file rather than reporting zero trades', () => {
    // "No trades found" and "this is not the right export" are different
    // answers, and a trader given the first will keep re-uploading.
    expect(() => parseTradingViewOrders('')).toThrow(UnrecognisedExport);
  });
});

describe('the trader\'s real file', () => {
  it('reads every filled order', () => {
    expect(result.filledOrders).toBe(34);
    expect(result.rejected).toEqual([]);
    expect(result.symbols).toEqual(['CME_MINI:MNQ1!']);
  });

  it('reconstructs sixteen trades from them', () => {
    expect(result.trades).toHaveLength(16);
  });

  it('closes every one of them — nothing was left open at the end of the file', () => {
    expect(result.trades.every(t => t.exit !== null)).toBe(true);
  });

  it('returns them oldest first', () => {
    const dates = result.trades.map(t => t.openedAt);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('the trade in the trader\'s screenshot — 8 Sep', () => {
  const t = byDate('2026-09-08')[0];

  it('matches the other product\'s panel to the cent', () => {
    expect(t.direction).toBe('LONG');
    expect(t.contracts).toBe(2);
    expect(t.entry).toBe(29525.25);
    expect(t.exit).toBe(29465.5);
    expect(pnl(t)).toBe(-239);          // panel: -$239
    expect(t.openedAt).toBe('2026-09-08 16:56:00');
    expect(t.closedAt).toBe('2026-09-08 17:01:52');
  });

  it('recovers the stop and the target that the other product showed as "-"', () => {
    // They are in the file: the protective stop order's Stop price, and the
    // take-profit limit order's Limit price.
    expect(t.stop).toBe(29465.75);
    expect(t.target).toBe(29614.25);
  });
});

describe('the scaled-in trade — 5 Aug', () => {
  const t = byDate('2026-08-05')[0];

  it('is one trade of twelve, not three of four', () => {
    // One decision, one stop, one target. Three sells at 30,008 / 29,993.25 /
    // 29,935 built it.
    expect(t.contracts).toBe(12);
    expect(t.scaledIn).toBe(true);
    expect(t.direction).toBe('SHORT');
  });

  it('prices it at the weighted average, which is where the P&L comes from', () => {
    // The other product displays the FIRST fill (30,008) as the entry while
    // computing from the average — from 30,008 this trade is +$762, and their
    // own panel says +$60.
    expect(t.entry).toBe(29978.75);
    expect(pnl(t)).toBe(60);            // panel: +$60
  });
});

describe('two trades on one symbol, seven seconds apart — 26 Aug', () => {
  const day = byDate('2026-08-26');

  it('separates them instead of merging them into one position', () => {
    // Grouping by symbol and day would produce one trade here. The position
    // returns to zero between them, which is what actually ends a trade.
    expect(day).toHaveLength(2);
    expect(day[0].contracts).toBe(4);
    expect(day[1].contracts).toBe(2);
  });

  it('prices each from its own fills', () => {
    expect(pnl(day[0])).toBe(22);
    expect(pnl(day[1])).toBe(-180);
  });

  it('reports the one with no take-profit as having none', () => {
    // The first was closed by hand; no limit order was ever placed. A missing
    // target is a fact about the trade, not a zero.
    expect(day[0].target).toBeNull();
    expect(day[0].stop).toBe(29311.25);
  });
});

describe('the stop is the stop at the END, not the plan', () => {
  it('flags the trades whose stop sits on the entry', () => {
    // 13 Aug: entry 30,206.25, stop 30,206.25. 12 Aug: 29,875 and 29,875.
    // A stop moved to breakeven, not a plan to risk nothing — and an R
    // computed from it would be a division by nothing.
    const flagged = result.trades.filter(t => t.stopIsAtEntry);
    expect(flagged.length).toBeGreaterThanOrEqual(2);
    expect(flagged.every(t => t.stop !== null)).toBe(true);
  });

  it('does not flag a trade whose stop is a real distance away', () => {
    const sep = byDate('2026-09-08')[0];
    expect(sep.stopIsAtEntry).toBe(false);
  });
});

describe('identity', () => {
  it('gives every trade the id of the order that opened it', () => {
    // Stable across exports, which is what lets a re-import tell an
    // already-imported trade from a new one.
    const ids = result.trades.map(t => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^\d+$/.test(id))).toBe(true);
  });

  it('is unchanged when the same file is parsed again', () => {
    const again = parseTradingViewOrders(csv);
    expect(again.trades.map(t => t.externalId)).toEqual(result.trades.map(t => t.externalId));
  });
});

describe('an open position at the end of the file', () => {
  it('is imported as an open trade rather than dropped', () => {
    // A journal that silently omits the trade you are in is worse than one
    // that shows it unfinished.
    const truncated = csv.split('\n').filter((l, i) => i === 0 || !l.includes('3505062244')).join('\n');
    const r = parseTradingViewOrders(truncated);
    const open = r.trades.filter(t => t.exit === null);
    expect(open).toHaveLength(1);
    expect(open[0].openedAt).toBe('2026-09-08 16:56:00');
    expect(open[0].contracts).toBe(2);
  });
});

describe('rows it cannot read', () => {
  it('reports them with a line number instead of failing the whole import', () => {
    const broken = csv.replace('CME_MINI:MNQ1!,Sell,Limit,2,29614.25', 'CME_MINI:MNQ1!,Sideways,Limit,2,29614.25');
    const r = parseTradingViewOrders(broken);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].line).toBeGreaterThan(1);
    expect(r.trades.length).toBe(16);
  });

  it('refuses a quantity that is not a number', () => {
    const broken = csv.replace(',Buy,Market,2,,,29525.25,Filled', ',Buy,Market,many,,,29525.25,Filled');
    const r = parseTradingViewOrders(broken);
    expect(r.rejected.some(x => x.reason === 'unreadable_quantity')).toBe(true);
  });
});
