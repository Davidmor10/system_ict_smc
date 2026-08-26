// NaN is not "no answer".
//
// A trade in the live journal — ES, marked WIN, entered at 5000 with a stop at
// 4990 and NO TARGET — produced NaN from all three of plannedRR, rMultiple and
// tradePnL. Not null: NaN, returned as the `number` half of `number | null`.
//
// That is worse than a wrong number, because every guard in the codebase reads
// `!= null` and NaN passes it. One such trade travels into an average and the
// expectancy, the R and the net become NaN — a screen of blanks with nothing
// naming the row responsible.
//
// The three functions are the boundary. Whatever is missing upstream, what
// leaves here is a real number or null, and these tests hold that line.

import { describe, it, expect } from 'vitest';
import { rMultiple, tradePnL, plannedRR } from '../../app/lib/journal';
import { calcRR } from '../../app/lib/calc/trade';
import { expectancy } from '../../app/lib/analytics/journalStats';
import { computeGroupPerformance } from '../../app/lib/analytics/metrics';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-08', time: '17:00', symbol: 'ES', direction: 'LONG',
  session: 'ny_am', entry: 5000, stop: 4990, target: 5020,
  result: 'WIN', pnlUsd: 100, tradeR: 2, contracts: 1,
  bias: 'BULLISH', model: '', notes: '',
  ...(over as object),
} as TradeEntry);

/** The row that was actually in the journal. */
const theRow = () => trade({
  result: 'WIN', entry: 5000, stop: 4990,
  target: undefined, tradeR: undefined, pnlUsd: undefined,
} as Partial<TradeEntry>);

const finiteOrNull = (n: number | null) => n === null || Number.isFinite(n);

describe('calcRR', () => {
  it('returns null for a missing target, not NaN', () => {
    expect(calcRR(5000, 4990, undefined as unknown as number)).toBeNull();
  });

  it('returns null when any input is absent', () => {
    const bad = undefined as unknown as number;
    expect(calcRR(bad, 4990, 5020)).toBeNull();
    expect(calcRR(5000, bad, 5020)).toBeNull();
    expect(calcRR(5000, 4990, bad)).toBeNull();
  });

  it('returns null for NaN as well as for absence', () => {
    expect(calcRR(5000, 4990, NaN)).toBeNull();
    expect(calcRR(NaN, 4990, 5020)).toBeNull();
  });

  it('still refuses a zero-risk plan', () => {
    expect(calcRR(5000, 5000, 5020)).toBeNull();
  });

  it('still computes an ordinary plan', () => {
    expect(calcRR(5000, 4990, 5020)).toBe(2);
  });
});

describe('the three producers, on the row that leaked', () => {
  it('plannedRR gives null', () => {
    expect(plannedRR(theRow())).toBeNull();
  });

  it('rMultiple gives null', () => {
    expect(rMultiple(theRow())).toBeNull();
  });

  it('tradePnL gives null', () => {
    // The fallback assumes the trade reached its target. Without a target
    // there is nothing to assume, and the honest answer is "no number".
    expect(tradePnL(theRow())).toBeNull();
  });

  it('never returns NaN for any shape of missing data', () => {
    const shapes: Partial<TradeEntry>[] = [
      { target: undefined },
      { stop: undefined },
      { entry: undefined },
      { target: undefined, result: 'LOSS' },
      { target: NaN },
      { entry: NaN, target: NaN },
      { stop: 5000 },                       // zero risk
      { target: undefined, result: 'BE' },  // BE short-circuits before the plan
    ];
    for (const shape of shapes) {
      const t = trade({ tradeR: undefined, pnlUsd: undefined, ...shape } as Partial<TradeEntry>);
      expect(finiteOrNull(plannedRR(t)), `plannedRR ${JSON.stringify(shape)}`).toBe(true);
      expect(finiteOrNull(rMultiple(t)), `rMultiple ${JSON.stringify(shape)}`).toBe(true);
      expect(finiteOrNull(tradePnL(t)),  `tradePnL ${JSON.stringify(shape)}`).toBe(true);
    }
  });
});

describe('one bad row does not poison the journal', () => {
  const goodJournal = () => [
    ...Array.from({ length: 5 }, () => trade({ result: 'WIN',  tradeR: 2,  pnlUsd: 200 })),
    ...Array.from({ length: 5 }, () => trade({ result: 'LOSS', tradeR: -1, pnlUsd: -100 })),
  ];

  it('leaves the expectancy a real number', () => {
    // THE FAILURE THIS PREVENTS. NaN passes `!= null`, reaches mean(), and the
    // whole headline goes blank with nothing naming the row.
    const e = expectancy([...goodJournal(), theRow()]);
    expect(Number.isFinite(e.expectancyR), `expectancyR=${e.expectancyR}`).toBe(true);
    expect(Number.isFinite(e.expectancyUsd), `expectancyUsd=${e.expectancyUsd}`).toBe(true);
    expect(Number.isFinite(e.avgWinR)).toBe(true);
    expect(Number.isFinite(e.avgLossR)).toBe(true);
  });

  it('leaves the group performance a real number', () => {
    const g = computeGroupPerformance([...goodJournal(), theRow()], 'ALL', 'All');
    expect(Number.isFinite(g.totalPnl), `totalPnl=${g.totalPnl}`).toBe(true);
    expect(Number.isFinite(g.avgRR),    `avgRR=${g.avgRR}`).toBe(true);
    expect(Number.isFinite(g.winRate)).toBe(true);
  });

  it('still counts the row as the win it was marked', () => {
    // Dropping its numbers must not drop the trade. The trader said it won.
    const g = computeGroupPerformance([...goodJournal(), theRow()], 'ALL', 'All');
    expect(g.wins).toBe(6);
    expect(g.losses).toBe(5);
  });
});
