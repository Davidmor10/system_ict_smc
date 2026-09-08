// Which trades belong to the portfolio on screen.
//
// The rule the feature rests on: a trader with a $50,000 account and a $25,000
// account has two records, and averaging them produces a win rate describing
// neither. The awkward case is the trade with no portfolio on it — a journal
// that predates portfolios — and the one thing that must never happen is for
// such a trade to disappear. A journal that quietly stops showing you trades
// you logged is worse than one that files a trade under the wrong account,
// because nothing on screen would say so.

import { describe, expect, it } from 'vitest';
import { scopeTrades, adoptingPortfolioId, backfillAccountId } from '../../app/lib/portfolio/scope';
import type { Portfolio } from '../../app/lib/portfolio/types';
import type { TradeEntry } from '../../app/lib/journal';

const pf = (id: string, createdAt: number, over: Partial<Portfolio> = {}): Portfolio => ({
  id, name: id, source: 'tradingview', timezone: 'Asia/Jerusalem',
  startingBalanceUsd: 50_000, createdAt, ...over,
});
const tr = (id: number, accountId?: string): TradeEntry =>
  ({ id, accountId, dateISO: '2026-09-01', result: 'WIN' } as TradeEntry);

const older = pf('a', 1), newer = pf('b', 2);
const both = [older, newer];

describe('adoptingPortfolioId', () => {
  it('is the oldest, so the same trade does not move as the trader clicks', () => {
    expect(adoptingPortfolioId([newer, older])).toBe('a');
  });
  it('ignores deleted portfolios', () => {
    expect(adoptingPortfolioId([pf('a', 1, { deleted: true }), newer])).toBe('b');
  });
  it('is null when there are none', () => {
    expect(adoptingPortfolioId([])).toBeNull();
  });
});

describe('scopeTrades', () => {
  const trades = [tr(1, 'a'), tr(2, 'b'), tr(3), tr(4, 'a')];

  it('shows only the selected portfolio\'s trades', () => {
    expect(scopeTrades(trades, both, 'b').map(t => t.id)).toEqual([2]);
  });

  it('never mixes two accounts into one set of numbers', () => {
    const a = scopeTrades(trades, both, 'a').map(t => t.id);
    const b = scopeTrades(trades, both, 'b').map(t => t.id);
    expect(a.some(id => b.includes(id))).toBe(false);
  });

  it('gives an unassigned trade to the oldest portfolio', () => {
    expect(scopeTrades(trades, both, 'a').map(t => t.id)).toEqual([1, 3, 4]);
    expect(scopeTrades(trades, both, 'b').map(t => t.id)).not.toContain(3);
  });

  it('shows the whole journal while there is no portfolio at all', () => {
    // Hiding a trader's journal because they have not set up a portfolio is
    // not a defensible state to render.
    expect(scopeTrades(trades, [], null)).toHaveLength(4);
    expect(scopeTrades(trades, [], 'a')).toHaveLength(4);
  });

  it('loses no trade across the portfolios that exist', () => {
    const seen = new Set([...scopeTrades(trades, both, 'a'), ...scopeTrades(trades, both, 'b')].map(t => t.id));
    expect(seen).toEqual(new Set([1, 2, 3, 4]));
  });

  it('does not mutate what it was handed', () => {
    const input = [tr(1, 'a')];
    scopeTrades(input, both, 'a');
    expect(input).toHaveLength(1);
  });
});

describe('backfillAccountId', () => {
  it('adopts every unassigned trade when the first portfolio appears', () => {
    const { changed, trades } = backfillAccountId([tr(1), tr(2)], 'a');
    expect(changed).toBe(true);
    expect(trades.every(t => t.accountId === 'a')).toBe(true);
  });

  it('never re-homes a trade that already belongs somewhere', () => {
    // Including one pointing at a portfolio since deleted. That is a fact
    // about the record; rewriting it here would be this function quietly
    // moving a trader's history between accounts.
    const { changed, trades } = backfillAccountId([tr(1, 'gone'), tr(2)], 'a');
    expect(changed).toBe(true);
    expect(trades[0].accountId).toBe('gone');
    expect(trades[1].accountId).toBe('a');
  });

  it('reports no change when there is nothing to do, so nothing is written', () => {
    expect(backfillAccountId([tr(1, 'a')], 'a').changed).toBe(false);
    expect(backfillAccountId([], 'a').changed).toBe(false);
  });
});
