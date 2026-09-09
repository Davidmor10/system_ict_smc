// A price the journal does not hold.
//
// The import writes 0 into `stop` or `target` when the export carried no such
// order — the schema requires a number there, and 0 was chosen as the sentinel
// every reader would recognise. Arithmetic does not recognise it. On a short
// at 29,270 a target of 0 is a target 29,270 points away, so one trade with no
// take-profit order reported 713R planned, dragged the account's average
// winner to +76R, and made the plan-versus-execution panel meaningless.
//
// These tests hold the sentinel to one meaning: a non-positive price is a
// price that was never recorded, and it leaves through the same door as NaN.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  calcRR, calcRealizedR, recordedPrice,
} from '../../app/lib/calc/trade';
import {
  plannedRR, rMultiple, tradePnL, missingAnswers, statsByGroup, type TradeEntry,
} from '../../app/lib/journal';
import { parseTradingViewOrders } from '../../app/lib/import/tradingview';
import { toTradeEntries } from '../../app/lib/import/toTrades';
import { UNSPECIFIED_MODEL } from '../../app/lib/journal';

const base: TradeEntry = {
  id: 1, dateISO: '2026-08-26', time: '16:30', symbol: 'MNQ', contracts: 2,
  direction: 'SHORT', entry: 29270.25, stop: 29311.25, target: 0,
  session: 'nyam', model: UNSPECIFIED_MODEL, result: 'WIN', notes: '',
};

describe('recordedPrice', () => {
  it('keeps a real level', () => {
    expect(recordedPrice(29311.25)).toBe(29311.25);
  });

  it('rejects the sentinel, the negative, and the absence', () => {
    // None of the instruments this app knows can print at or below zero, so a
    // non-positive price is never a level somebody chose.
    expect(recordedPrice(0)).toBeNull();
    expect(recordedPrice(-1)).toBeNull();
    expect(recordedPrice(NaN)).toBeNull();
    expect(recordedPrice(Infinity)).toBeNull();
  });
});

describe('the calculators refuse an unrecorded price', () => {
  it('returns no planned R for a target of zero', () => {
    // 713.91 was the answer before: (0 − 29270.25) × −1 over 41 points.
    expect(calcRR(29270.25, 29311.25, 0, 'SHORT')).toBeNull();
  });

  it('returns no planned R for a stop of zero', () => {
    expect(calcRR(29270.25, 0, 29200, 'SHORT')).toBeNull();
  });

  it('returns no realized R for a stop of zero', () => {
    // Risk would have been the entry price itself — the whole instrument.
    expect(calcRealizedR(29270.25, 29200, 0, 'SHORT')).toBeNull();
  });

  it('still answers when every price is real', () => {
    expect(calcRR(29270.25, 29311.25, 29188.25, 'SHORT')).toBeCloseTo(2, 5);
  });
});

describe('the journal refuses it too', () => {
  it('gives no planned RR for a trade with no target', () => {
    expect(plannedRR(base)).toBeNull();
  });

  it('does not price a win at a target it never had', () => {
    // The fallback assumes a win reached its target. With no target it would
    // have priced the trade at the whole instrument — $58,540 on a $24 trade.
    expect(tradePnL(base)).toBeNull();
  });

  it('gives no R from the plan when the plan is absent', () => {
    expect(rMultiple(base)).toBeNull();
  });

  it('prefers the recorded figures when they exist', () => {
    const recorded = { ...base, tradeR: 0.07, pnlUsd: 22 };
    expect(rMultiple(recorded)).toBe(0.07);
    expect(tradePnL(recorded)).toBe(22);
  });

  it('names the missing price as a missing answer', () => {
    expect(missingAnswers(base).map(m => m.key)).toContain('target');
  });

  it('names it on an open position too', () => {
    // The case the trader most needs pointed at: a position still running
    // that the import could not read a stop for.
    const open: TradeEntry = { ...base, result: 'OPEN', stop: 0, target: 0 };
    const keys = missingAnswers(open).map(m => m.key);
    expect(keys).toEqual(['stop', 'target']);
  });

  it('averages the REALIZED R by group, not the planned one', () => {
    // statsByGroup carried its own copy of the ratio and handed the planned
    // figure back as `avgR`, which is a different number under the same label
    // — and it kept every bug the shared calculator was fixed for.
    const won  = { ...base, id: 2, target: 29188.25, tradeR: 0.5, pnlUsd: 100 };
    const lost = { ...base, id: 3, target: 29188.25, result: 'LOSS' as const, tradeR: -1, pnlUsd: -200 };
    expect(statsByGroup([won, lost]).avgR).toBeCloseTo(-0.25, 5);
  });
});

describe('against the trader\'s own export', () => {
  const parsed = parseTradingViewOrders(
    readFileSync('tests/fixtures/tradingview-orders.csv', 'utf8'),
  ).trades;
  const { trades } = toTradeEntries(parsed, {
    fileZone: 'Asia/Jerusalem', appZone: 'Asia/Jerusalem', accountId: 'pf_1',
  });

  it('has the trade this bug was found on', () => {
    const noTarget = trades.filter(t => t.target === 0);
    expect(noTarget).toHaveLength(1);
    expect(noTarget[0].dateISO).toBe('2026-08-26');
  });

  it('reports no reward-to-risk above the plausible for any trade', () => {
    // The file's own worst case was 713.91R. Nothing in a real journal plans
    // a hundred to one; a number that size is a sentinel being read as price.
    for (const t of trades) {
      const rr = plannedRR(t);
      if (rr !== null) expect(Math.abs(rr)).toBeLessThan(20);
    }
  });

  it('keeps the account\'s planned total in the range a human would plan', () => {
    const total = trades.reduce((sum, t) => sum + (plannedRR(t) ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(40);
  });
});
