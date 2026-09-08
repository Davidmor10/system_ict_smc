// Turning reconstructed TradingView trades into journal entries.
//
// The rule the whole mapping is built around: everything the app can work out,
// it works out; everything only the trader knows is left EMPTY rather than
// defaulted. A setup of "REVERSAL" or a rule verdict of "kept" that the trader
// never gave is an answer invented on their behalf, and the behaviour layer is
// built on those answers.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { parseTradingViewOrders } from '../../app/lib/import/tradingview';
import { mapSymbol, toTradeEntries, splitAgainstExisting } from '../../app/lib/import/toTrades';
import { UNSPECIFIED_MODEL } from '../../app/lib/journal';

const parsed = parseTradingViewOrders(
  readFileSync('tests/fixtures/tradingview-orders.csv', 'utf8'),
).trades;

const ISRAEL = 'Asia/Jerusalem';
const map = (over: Partial<Parameters<typeof toTradeEntries>[1]> = {}) =>
  toTradeEntries(parsed, {
    fileZone: ISRAEL, appZone: ISRAEL, accountId: 'pf_1',
    // The shipped windows, so the assertions do not depend on a browser.
    sessionFor: h => (h >= 16 && h < 18 ? 'nyam' : h >= 20 && h < 23 ? 'nypm' : null),
    ...over,
  });

describe('mapSymbol', () => {
  it('reads the notations TradingView actually exports', () => {
    expect(mapSymbol('CME_MINI:MNQ1!')).toBe('MNQ');
    expect(mapSymbol('CME_MINI:ES1!')).toBe('ES');
    expect(mapSymbol('MNQ')).toBe('MNQ');
    expect(mapSymbol('MNQZ2026')).toBe('MNQ');
    expect(mapSymbol('  mes1!  ')).toBe('MES');
  });

  it('refuses an instrument the app has no specification for', () => {
    // Without a tick size and tick value there is no dollar figure, and
    // importing anyway would produce a journal of confident zeroes.
    expect(mapSymbol('COMEX:GC1!')).toBeNull();
    expect(mapSymbol('NYMEX:CL1!')).toBeNull();
    expect(mapSymbol('')).toBeNull();
  });
});

describe('the sixteen trades', () => {
  const { trades, skipped } = map();

  it('all map, none skipped', () => {
    expect(trades).toHaveLength(16);
    expect(skipped).toEqual([]);
  });

  it('carries the portfolio on every one', () => {
    expect(trades.every(t => t.accountId === 'pf_1')).toBe(true);
  });

  it('takes its id from the opening order, so a re-import lands on the same row', () => {
    const sep = trades.find(t => t.dateISO === '2026-09-08')!;
    expect(sep.id).toBe(3505062243);
    // Three orders of magnitude below the Date.now() ids a manual trade gets,
    // so an imported trade can never collide with a hand-logged one.
    expect(sep.id).toBeLessThan(Date.now() / 100);
  });

  it('leaves every discretionary field unanswered', () => {
    for (const t of trades) {
      expect(t.model).toBe(UNSPECIFIED_MODEL);
      expect(t.setup).toBeUndefined();
      expect(t.confirmations).toBeUndefined();
      expect(t.bias).toBeUndefined();
      expect(t.emotionalState).toBeUndefined();
      expect(t.followedRules).toBeUndefined();
      expect(t.stopMoved).toBeUndefined();
      expect(t.notes).toBe('');
    }
  });
});

describe('the numbers match what the app would compute by hand', () => {
  const { trades } = map();
  const sep = trades.find(t => t.dateISO === '2026-09-08')!;
  const aug5 = trades.find(t => t.dateISO === '2026-08-05')!;

  it('prices the screenshot trade exactly', () => {
    expect(sep.symbol).toBe('MNQ');
    expect(sep.direction).toBe('LONG');
    expect(sep.contracts).toBe(2);
    expect(sep.entry).toBe(29525.25);
    expect(sep.exits).toEqual([{ price: 29465.5, contracts: 2 }]);
    expect(sep.result).toBe('LOSS');
    expect(sep.pnlUsd).toBe(-239);
    expect(sep.time).toBe('16:56');
    expect(sep.session).toBe('nyam');
  });

  it('gives it an R from a stop that is a real distance away', () => {
    // entry 29,525.25, stop 29,465.75 → 59.5 points of risk; exit 29,465.50.
    expect(sep.tradeR).toBeCloseTo(-1.004, 2);
  });

  it('prices the scaled-in trade off the weighted average', () => {
    expect(aug5.contracts).toBe(12);
    expect(aug5.entry).toBe(29978.75);
    expect(aug5.pnlUsd).toBe(60);
  });
});

describe('a stop trailed to the entry or past it', () => {
  const { trades } = map();
  const noRisk = trades.filter(t => {
    const risk = t.direction === 'LONG' ? t.entry - t.stop : t.stop - t.entry;
    return t.stop !== 0 && risk <= 0;
  });

  it('covers nine of the sixteen trades', () => {
    expect(noRisk).toHaveLength(9);
  });

  it('produces no R rather than an absurd one', () => {
    // Before the check was signed rather than absolute, the 3 Aug trade — a
    // long whose stop ended one tick ABOVE the entry — reported +12.0R on a
    // $24 result, and that number rendered in the import preview.
    expect(noRisk.every(t => t.tradeR === undefined)).toBe(true);
  });

  it('leaves the seven with a real risk distance with an R', () => {
    const withR = trades.filter(t => t.tradeR !== undefined);
    expect(withR).toHaveLength(7);
    expect(withR.every(t => Math.abs(t.tradeR as number) < 6)).toBe(true);
  });

  it('still carries the price, so the completion form can ask about it', () => {
    expect(noRisk.every(t => t.stop > 0)).toBe(true);
  });
});

describe('a missing stop or target', () => {
  it('stores zero, not the entry', () => {
    // Writing the entry into the stop field would invent a zero-risk plan.
    // Zero reads as "not recorded" to every caller that checks.
    const { trades } = map();
    const noTarget = trades.find(t => t.dateISO === '2026-08-26' && t.contracts === 4)!;
    expect(noTarget.target).toBe(0);
    expect(noTarget.stop).toBeGreaterThan(0);
  });
});

describe('the timezone the file is read in', () => {
  it('files a trade under the hour the trader actually traded', () => {
    const israel = map().trades.find(t => t.dateISO === '2026-09-08')!;
    expect(israel.time).toBe('16:56');
    expect(israel.session).toBe('nyam');
  });

  it('moves every trade when the file turns out to be UTC', () => {
    // The silent failure this guards: read as Israel time when it is UTC, the
    // same trade sits in New York AM instead of the evening. Nothing on screen
    // would say so.
    const utc = toTradeEntries(parsed, {
      fileZone: 'UTC', appZone: ISRAEL, accountId: 'pf_1',
      sessionFor: h => (h >= 16 && h < 18 ? 'nyam' : h >= 20 && h < 23 ? 'nypm' : null),
    }).trades.find(t => t.dateISO === '2026-09-08')!;
    expect(utc.time).toBe('19:56');
    expect(utc.session).toBe('');
  });
});

describe('an open position', () => {
  it('imports with no result, no R and no P&L', () => {
    const csv = readFileSync('tests/fixtures/tradingview-orders.csv', 'utf8');
    const truncated = csv.split('\n').filter((l, i) => i === 0 || !l.includes('3505062244')).join('\n');
    const open = toTradeEntries(parseTradingViewOrders(truncated).trades, {
      fileZone: ISRAEL, appZone: ISRAEL, accountId: 'pf_1', sessionFor: () => 'nyam',
    }).trades.find(t => t.result === 'OPEN')!;
    expect(open).toBeDefined();
    expect(open.exits).toBeUndefined();
    expect(open.tradeR).toBeUndefined();
    expect(open.pnlUsd).toBeUndefined();
  });
});

describe('splitAgainstExisting', () => {
  const { trades } = map();

  it('adds nothing twice', () => {
    const { fresh, duplicates } = splitAgainstExisting(trades, trades);
    expect(fresh).toEqual([]);
    expect(duplicates).toHaveLength(16);
  });

  it('adds only what is new', () => {
    const { fresh, duplicates } = splitAgainstExisting(trades, trades.slice(0, 10));
    expect(fresh).toHaveLength(6);
    expect(duplicates).toHaveLength(10);
  });

  it('treats an empty journal as all new', () => {
    expect(splitAgainstExisting(trades, []).fresh).toHaveLength(16);
  });
});
