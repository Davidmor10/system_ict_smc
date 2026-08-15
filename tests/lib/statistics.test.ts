// ─────────────────────────────────────────────────────────────────────────────
// The statistics screen's arithmetic.
//
// Most of these are ordinary sums with an expected answer. The ones that
// matter are the absence cases: what the page does when the journal cannot
// answer a question. Every silent failure in this codebase has been an absent
// value read as a positive one — rules never asked counted as rules followed,
// exits never logged counted as exits at target — so those get a test each,
// and the assertions are about `null` rather than about a number.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  daySeries, bySession, byWeekday, bestGroup, edgeScore, adherence,
  rollingSeries, computeStatistics,
} from '../../app/lib/analytics/statistics';
import type { TradeEntry } from '../../app/lib/journal';

/** A closed MNQ long: 30-point stop, 90-point target, so the plan is 3R.
 *  `pnlUsd` and `tradeR` are passed explicitly the way the form saves them. */
function trade(over: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id: Math.floor(Math.random() * 1e9),
    dateISO: '2026-08-03',
    time: '16:30',
    symbol: 'MNQ',
    contracts: 1,
    direction: 'LONG',
    entry: 29840,
    stop: 29810,
    target: 29930,
    session: 'nyam',
    bias: 'BULLISH',
    model: 'Silver Bullet',
    result: 'WIN',
    notes: '',
    tradeR: 3,
    pnlUsd: 180,
    ...over,
  } as TradeEntry;
}

const win  = (o: Partial<TradeEntry> = {}) => trade({ result: 'WIN',  tradeR: 3,  pnlUsd: 180, ...o });
const loss = (o: Partial<TradeEntry> = {}) => trade({ result: 'LOSS', tradeR: -1, pnlUsd: -60, ...o });

// ── day series ──────────────────────────────────────────────────────────────

describe('daySeries', () => {
  it('collapses same-day trades into one point and carries equity forward', () => {
    const s = daySeries([
      win({ dateISO: '2026-08-03' }),
      loss({ dateISO: '2026-08-03' }),
      win({ dateISO: '2026-08-04' }),
    ], 25_000);

    expect(s.days).toHaveLength(2);
    expect(s.days[0]).toMatchObject({ dateISO: '2026-08-03', pnl: 120, equity: 25_120, trades: 2 });
    expect(s.days[1]).toMatchObject({ dateISO: '2026-08-04', pnl: 180, equity: 25_300 });
    expect(s.end).toBe(25_300);
  });

  it('measures drawdown from the running peak, not from the start', () => {
    // Up to 25,540, then two losing days down to 25,420 — still up overall,
    // and a 120 drawdown all the same. That fall is the one a trader feels.
    const s = daySeries([
      win({ dateISO: '2026-08-03' }),
      win({ dateISO: '2026-08-04' }),
      win({ dateISO: '2026-08-05' }),
      loss({ dateISO: '2026-08-06' }),
      loss({ dateISO: '2026-08-07' }),
    ], 25_000);

    expect(s.peak).toBe(25_540);
    expect(s.end).toBe(25_420);
    expect(s.maxDrawdown).toBe(120);
    expect(s.drawdownDays).toBe(2);
  });

  it('sorts by date even when the journal hands them over newest first', () => {
    const s = daySeries([
      win({ dateISO: '2026-08-05' }),
      loss({ dateISO: '2026-08-03' }),
    ], 10_000);
    expect(s.days.map(d => d.dateISO)).toEqual(['2026-08-03', '2026-08-05']);
    expect(s.days[0].equity).toBe(9_940);
  });

  it('reports the starting balance untouched when nothing is closed', () => {
    const s = daySeries([trade({ result: 'OPEN' })], 25_000);
    expect(s.days).toEqual([]);
    expect(s.end).toBe(25_000);
    expect(s.maxDrawdownPct).toBe(0);
  });

  it('counts green and red days and the average', () => {
    const s = daySeries([
      win({ dateISO: '2026-08-03' }),
      loss({ dateISO: '2026-08-04' }),
      win({ dateISO: '2026-08-05' }),
    ], 25_000);
    expect(s.green).toBe(2);
    expect(s.red).toBe(1);
    expect(s.best).toBe(180);
    expect(s.worst).toBe(-60);
    expect(s.avgDay).toBe(100);
  });
});

// ── groups ──────────────────────────────────────────────────────────────────

describe('grouping', () => {
  it('shows all four sessions even when only one was traded', () => {
    const g = bySession([win({ session: 'nyam' })]);
    expect(g.map(x => x.key)).toEqual(['asia', 'london', 'nyam', 'nypm']);
    expect(g.find(x => x.key === 'nyam')!.n).toBe(1);
    expect(g.find(x => x.key === 'asia')!.n).toBe(0);
  });

  it('folds unrecognised sessions into one bucket, and only when non-empty', () => {
    expect(bySession([win({ session: 'nyam' })]).some(x => x.key === 'other')).toBe(false);

    const g = bySession([win({ session: 'NONE' }), win({ session: 'wat' })]);
    const other = g.find(x => x.key === 'other')!;
    expect(other.n).toBe(2);
  });

  it('withholds a win rate below the evidence floor', () => {
    const few = bySession([win({ session: 'nyam' }), loss({ session: 'nyam' })]);
    expect(few.find(x => x.key === 'nyam')!.winRate).toBeNull();

    const enough = bySession(Array.from({ length: 8 }, (_, i) =>
      i < 6 ? win({ session: 'nyam' }) : loss({ session: 'nyam' })));
    expect(enough.find(x => x.key === 'nyam')!.winRate).toBe(0.75);
  });

  it('always renders Mon–Fri, and a weekend day only when it was traded', () => {
    // 2026-08-03 is a Monday; 2026-08-08 a Saturday.
    const w = byWeekday([win({ dateISO: '2026-08-03' })]);
    expect(w.map(x => x.key)).toEqual(['1', '2', '3', '4', '5']);

    const withSat = byWeekday([win({ dateISO: '2026-08-08' })]);
    expect(withSat.map(x => x.key)).toContain('6');
  });

  it('names no best group when every group lost money', () => {
    const g = bySession([loss({ session: 'nyam' }), loss({ session: 'london' })]);
    expect(bestGroup(g)).toBeNull();
  });

  it('names the most profitable group when one is actually profitable', () => {
    const g = bySession([
      win({ session: 'nyam' }), win({ session: 'nyam' }),
      win({ session: 'london' }), loss({ session: 'london' }),
    ]);
    expect(bestGroup(g)!.key).toBe('nyam');
  });
});

// ── adherence: the absent answer ────────────────────────────────────────────

describe('adherence', () => {
  it('never counts an unanswered trade as a violation', () => {
    const a = adherence([
      win({ followedRules: true }),
      win({ followedRules: false }),
      win(),                              // never asked
      win(),                              // never asked
    ]);
    expect(a.answered).toBe(2);
    expect(a.followed).toBe(1);
    expect(a.rate).toBe(0.5);             // NOT 1/4
    expect(a.unanswered).toBe(2);
  });

  it('returns null, not zero, when nothing was ever answered', () => {
    expect(adherence([win(), loss()]).rate).toBeNull();
  });
});

// ── edge score ──────────────────────────────────────────────────────────────

describe('edgeScore', () => {
  const full = {
    winRate: 0.6, avgRR: 2.0, bestShare: 0.15,
    drawdownPct: 4, avgLossR: 1.0, adherence: 0.8, hasDays: true,
  };

  it('weights the six components to the design’s numbers', () => {
    const e = edgeScore(full);
    expect(e.measured).toBe(6);
    expect(e.components.map(c => c.weight)).toEqual([0.15, 0.2, 0.2, 0.2, 0.15, 0.1]);
    // Σ(weight × score), all six measurable so effective === designed.
    const expected = e.components.reduce((a, c) => a + c.weight * (c.score ?? 0), 0);
    expect(e.score).toBeCloseTo(expected, 2);
  });

  it('drops an unmeasurable component instead of scoring it zero', () => {
    const noLosses = edgeScore({ ...full, avgLossR: null, avgRR: null });
    expect(noLosses.measured).toBe(4);
    expect(noLosses.components.find(c => c.key === 'risk')!.score).toBeNull();
    expect(noLosses.components.find(c => c.key === 'risk')!.effectiveWeight).toBe(0);
    // A trader with no losses yet is not a 0-risk-control trader.
    expect(noLosses.score!).toBeGreaterThan(edgeScore({ ...full, avgLossR: 3 }).score!);
  });

  it('renormalizes the surviving weights to 1', () => {
    const e = edgeScore({ ...full, adherence: null });
    const total = e.components.reduce((a, c) => a + c.effectiveWeight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('says nothing at all when nothing is measurable', () => {
    const e = edgeScore({
      winRate: null, avgRR: null, bestShare: null,
      drawdownPct: 0, avgLossR: null, adherence: null, hasDays: false,
    });
    expect(e.score).toBeNull();
    expect(e.band).toBeNull();
    expect(e.measured).toBe(0);
  });

  it('bands at 80 and 65', () => {
    const at = (score: number) => edgeScore({
      winRate: null, avgRR: null, bestShare: null,
      drawdownPct: 0.8 + (1 - score / 100) * 18, avgLossR: null, adherence: null, hasDays: true,
    }).band;
    expect(at(90)).toBe('strong');
    expect(at(70)).toBe('solid');
    expect(at(40)).toBe('developing');
  });

  it('refuses to score consistency off a losing account', () => {
    // bestShare of a negative net is an artefact — the old formula clamped it
    // to a perfect 100, handing a losing trader top marks for consistency.
    const e = edgeScore({ ...full, bestShare: null });
    expect(e.components.find(c => c.key === 'consistency')!.score).toBeNull();
  });
});

// ── sparklines ──────────────────────────────────────────────────────────────

describe('rollingSeries', () => {
  it('draws nothing below the evidence floor rather than a flat line', () => {
    expect(rollingSeries(Array.from({ length: 7 }, () => win()), () => 1)).toEqual([]);
  });

  it('returns one sample per bucket once there is enough', () => {
    const s = rollingSeries(Array.from({ length: 40 }, () => win()), w => w.length, 26);
    expect(s).toHaveLength(26);
  });
});

// ── the whole object ────────────────────────────────────────────────────────

describe('computeStatistics', () => {
  const ledger = [
    win({ dateISO: '2026-08-03', session: 'nyam',   followedRules: true }),
    loss({ dateISO: '2026-08-03', session: 'nyam',  followedRules: true }),
    win({ dateISO: '2026-08-04', session: 'london', followedRules: false }),
    loss({ dateISO: '2026-08-05', session: 'nyam' }),
    trade({ dateISO: '2026-08-06', result: 'OPEN' }),
  ];

  it('separates open trades from the performance figures', () => {
    const s = computeStatistics(ledger, 25_000);
    expect(s.n).toBe(4);
    expect(s.open).toBe(1);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
  });

  it('computes the headline numbers', () => {
    const s = computeStatistics(ledger, 25_000);
    expect(s.grossWin).toBe(360);
    expect(s.grossLoss).toBe(120);
    expect(s.net).toBe(240);
    expect(s.winRate).toBe(0.5);
    expect(s.profitFactor).toBe(3);
    expect(s.avgWin).toBe(180);
    expect(s.avgLoss).toBe(60);
    expect(s.avgRR).toBe(3);
    expect(s.returnPct).toBe(0.96);
  });

  it('reports the evidence floor rather than deciding silently', () => {
    const s = computeStatistics(ledger, 25_000);
    expect(s.evidence).toMatchObject({ decided: 4, forClaim: 8, enoughForClaim: false });
  });

  it('holds an empty journal together', () => {
    const s = computeStatistics([], 25_000);
    expect(s.n).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.avgRR).toBeNull();
    expect(s.equity.end).toBe(25_000);
    expect(s.edge.score).toBeNull();
    expect(s.headline.every(h => h.value === null || h.key === 'expectancy')).toBe(true);
  });

  it('marks a trade with no logged exit rather than inventing one', () => {
    const s = computeStatistics([win({ exits: undefined })], 25_000);
    expect(s.recent[0].exit).toBeNull();
    expect(s.recent[0].followedRules).toBeNull();
  });

  it('carries the contract-weighted exit into the log', () => {
    const s = computeStatistics([
      win({ contracts: 2, exits: [{ price: 29900, contracts: 1 }, { price: 29930, contracts: 1 }] }),
    ], 25_000);
    expect(s.recent[0].exit).toBe(29915);
  });

  it('keeps the planned R beside the realized one', () => {
    const s = computeStatistics([win({ tradeR: 1.7 })], 25_000);
    expect(s.recent[0].plannedR).toBe(3);     // 90-point target over a 30-point stop
    expect(s.recent[0].realizedR).toBe(1.7);  // what was actually taken
  });

  it('returns the most recent trades first', () => {
    const s = computeStatistics(ledger, 25_000, 2);
    expect(s.recent).toHaveLength(2);
    expect(s.recent[0].dateISO).toBe('2026-08-05');
  });
});
