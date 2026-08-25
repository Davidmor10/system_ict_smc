// The sentence under the expectancy tiles.
//
// It is the one piece of prose on the analytics page that is written in code
// rather than by a model, and it makes a claim — "look at your exits" versus
// "look at your entries". That claim comes from the decomposition, so the
// mapping from numbers to sentence has to be pinned: the same expectancy
// reached two ways calls for opposite work, and getting the direction backwards
// would send a trader to fix the half that is already fine.

import { describe, it, expect } from 'vitest';
import { runFullAnalysis } from '../../app/lib/analytics';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const t = (result: 'WIN' | 'LOSS', r: number, usd: number): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-10', time: '17:00', symbol: 'MNQ', direction: 'LONG',
  session: 'NY_AM', entry: 100, stop: 95, target: 115,
  result, tradeR: r, pnlUsd: usd, contracts: 1, bias: 'BULLISH', model: '', notes: '',
} as TradeEntry);

/** The page's own logic, kept in step with app/dashboard/ai-analytics/page.tsx.
 *  Duplicated deliberately: the page is a client component and this is the
 *  arithmetic underneath its sentence. */
function read(exp: ReturnType<typeof runFullAnalysis>['expectancy']): string {
  if (exp.trades === 0) return '';
  const wr = exp.winRate * 100;
  const payoff = exp.avgLossR !== 0 ? Math.abs(exp.avgWinR / exp.avgLossR) : Infinity;
  if (wr >= 55 && payoff < 1.2) return 'exits';
  if (wr < 45 && payoff >= 1.8) return 'entries';
  return 'balanced';
}

const expOf = (trades: TradeEntry[]) => runFullAnalysis(trades).expectancy;

describe('the expectancy reading', () => {
  it('points at EXITS when the trader is often right but wins small', () => {
    // 7 of 10 right, winners barely bigger than losers. Classic cutting short.
    const trades = [
      ...Array.from({ length: 7 }, () => t('WIN', 1.0, 100)),
      ...Array.from({ length: 3 }, () => t('LOSS', -1, -100)),
    ];
    expect(read(expOf(trades))).toBe('exits');
  });

  it('points at ENTRIES when the trader is rarely right but wins big', () => {
    const trades = [
      ...Array.from({ length: 3 }, () => t('WIN', 4, 400)),
      ...Array.from({ length: 7 }, () => t('LOSS', -1, -100)),
    ];
    expect(read(expOf(trades))).toBe('entries');
  });

  it('claims neither when both halves are unremarkable', () => {
    const trades = [
      ...Array.from({ length: 5 }, () => t('WIN', 1.5, 150)),
      ...Array.from({ length: 5 }, () => t('LOSS', -1, -100)),
    ];
    expect(read(expOf(trades))).toBe('balanced');
  });

  it('says nothing at all with no decided trades', () => {
    expect(read(expOf([]))).toBe('');
  });

  it('survives a history with no losers, where the payoff ratio is infinite', () => {
    // A real state early on, and the branch that would print "פי Infinity".
    const trades = Array.from({ length: 4 }, () => t('WIN', 2, 200));
    const e = expOf(trades);
    expect(e.avgLossR).toBe(0);
    expect(read(e)).toBe('balanced'); // win rate is 100%, so not the entries branch
  });

  it('reports the win rate as a fraction, which the page multiplies by 100', () => {
    // The scale trap that already produced "1%" once, in the coach prompt.
    const trades = [
      ...Array.from({ length: 5 }, () => t('WIN', 2, 200)),
      ...Array.from({ length: 5 }, () => t('LOSS', -1, -100)),
    ];
    expect(expOf(trades).winRate).toBeCloseTo(0.5, 5);
  });
});
