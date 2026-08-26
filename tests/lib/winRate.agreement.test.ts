// One journal, one win rate.
//
// Five places computed this number and they did not agree. Four split on the
// trade's RESULT — the word the trader chose in the form. One split on the
// SIGN OF R, and that one fed the expectancy headline, rendered on the same
// screen as the pattern cards fed by the others.
//
// They matched on clean data, which is what made it dangerous: the split only
// showed on trades where the label and the R point different ways — a win
// closed at 0R after fees, a break-even that finished a tick green. Those are
// ordinary trades, not edge cases, and on them the two numbers could differ by
// seventeen points on a four-trade journal.
//
// These tests do not check that the win rate is CORRECT. They check that every
// caller gets the SAME one, which is the property that was broken and the only
// one a shared helper can guarantee.

import { describe, it, expect } from 'vitest';
import { decidedCounts, winRateFraction, winRatePercent } from '../../app/lib/calc/decided';
import { expectancy } from '../../app/lib/analytics/journalStats';
import { computeGroupPerformance } from '../../app/lib/analytics/metrics';
import { computeStats, statsByGroup } from '../../app/lib/journal';
import { statsForTrades } from '../../app/lib/playbook';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-10',
  time: '17:00',
  symbol: 'MNQ',
  direction: 'LONG',
  session: 'ny_am',
  entry: 20000,
  stop: 19980,
  target: 20060,
  result: 'WIN',
  pnlUsd: 100,
  tradeR: 2,
  contracts: 1,
  bias: 'BULLISH',
  model: '',
  notes: '',
  ...(over as object),
} as TradeEntry);

/** Every win rate in the codebase, on the 0–100 scale. */
function everyWinRate(trades: TradeEntry[]): Record<string, number> {
  return {
    expectancy: expectancy(trades).winRate * 100,       // a FRACTION at source
    patterns:   computeGroupPerformance(trades, 'ALL', 'All').winRate,
    stats:      computeStats(trades).winRate,
    byGroup:    statsByGroup(trades).winRate,
    playbook:   statsForTrades(trades).winRate ?? 0,
    shared:     winRatePercent(trades) ?? 0,
  };
}

const agree = (trades: TradeEntry[]) => {
  const all = everyWinRate(trades);
  const values = Object.values(all).map(v => Math.round(v * 100) / 100);
  const distinct = [...new Set(values)];
  return { all, distinct };
};

describe('every win rate in the codebase agrees', () => {
  it('on a clean journal', () => {
    const trades = [
      ...Array.from({ length: 9 }, () => trade({ result: 'WIN',  tradeR: 2,  pnlUsd: 200 })),
      ...Array.from({ length: 7 }, () => trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 })),
    ];
    const { all, distinct } = agree(trades);
    expect(distinct, JSON.stringify(all)).toHaveLength(1);
  });

  it('on a win that closed at 0R', () => {
    // THE REGRESSION. Fees ate it. By its label it is a win; by the sign of R
    // it is neither, which used to drop it out of one denominator only.
    const trades = [
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'WIN',  tradeR: 0, pnlUsd: 0 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
    ];
    const { all, distinct } = agree(trades);
    expect(distinct, JSON.stringify(all)).toHaveLength(1);
    // Three of five decided trades are labelled wins.
    expect(distinct[0]).toBe(60);
  });

  it('on a break-even that finished green', () => {
    // A tick the right side of entry: BE by label, a win by sign.
    const trades = [
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
      trade({ result: 'BE',   tradeR: 0.3, pnlUsd: 30 }),
    ];
    const { all, distinct } = agree(trades);
    expect(distinct, JSON.stringify(all)).toHaveLength(1);
    // The BE is not decided, so it moves neither half.
    expect(distinct[0]).toBe(50);
  });

  it('on a loss that stopped out at entry', () => {
    const trades = [
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
      trade({ result: 'LOSS', tradeR: 0,  pnlUsd: 0 }),
    ];
    const { all, distinct } = agree(trades);
    expect(distinct, JSON.stringify(all)).toHaveLength(1);
    expect(distinct[0]).toBe(50);
  });

  it('when a trade carries no R at all', () => {
    const trades = [
      trade({ result: 'WIN',  tradeR: undefined, pnlUsd: undefined }),
      trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
      trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 }),
    ];
    const { all, distinct } = agree(trades);
    expect(distinct, JSON.stringify(all)).toHaveLength(1);
  });

  it('with open positions in the journal', () => {
    const trades = [
      ...Array.from({ length: 3 }, () => trade({ result: 'WIN',  tradeR: 2, pnlUsd: 200 })),
      ...Array.from({ length: 3 }, () => trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 })),
      ...Array.from({ length: 4 }, () => trade({ result: 'OPEN', tradeR: undefined, pnlUsd: undefined })),
    ];
    const { all, distinct } = agree(trades);
    expect(distinct, JSON.stringify(all)).toHaveLength(1);
    expect(distinct[0]).toBe(50);
  });
});

describe('the shared helper', () => {
  it('counts only decided trades', () => {
    const trades = [
      trade({ result: 'WIN' }), trade({ result: 'LOSS' }),
      trade({ result: 'BE' }),  trade({ result: 'OPEN' }),
    ];
    expect(decidedCounts(trades)).toEqual({ wins: 1, losses: 1, decided: 2 });
  });

  it('returns null on an empty journal, never zero', () => {
    // "No trades" and "never won" must not render the same.
    expect(winRateFraction([])).toBeNull();
    expect(winRatePercent([])).toBeNull();
  });

  it('returns null when nothing has been decided yet', () => {
    expect(winRateFraction([trade({ result: 'OPEN' }), trade({ result: 'BE' })])).toBeNull();
  });

  it('reports a fraction and a percentage of the same split', () => {
    const trades = [
      trade({ result: 'WIN' }), trade({ result: 'WIN' }),
      trade({ result: 'WIN' }), trade({ result: 'LOSS' }),
    ];
    expect(winRateFraction(trades)).toBe(0.75);
    expect(winRatePercent(trades)).toBe(75);
  });

  it('ignores anything that is not a win or a loss', () => {
    // The helper takes anything carrying a `result`, so it meets values the
    // TradeEntry union does not allow — a row read straight from the database,
    // a legacy label. Nothing unrecognised may quietly become a win.
    expect(decidedCounts([
      { result: 'WIN' }, { result: 'SCRATCH' }, { result: 'win' }, { result: '' },
    ]).decided).toBe(1);
  });
});
