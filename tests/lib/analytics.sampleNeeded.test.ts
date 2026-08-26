// Counting partitions instead of candidates, and saying how much is missing.
//
// Two problems, one root. The engine slices a journal many ways, and several
// of those slices select the IDENTICAL trades — for a trader who runs one
// model in one session, "MNQ · London", "London" and "Silver Bullet @ 11:00"
// are one question asked three times. Counting each as a separate comparison
// made the correction harsher in exact proportion to how consistent the trader
// was, which is backwards: having a routine was penalised.
//
// The second problem is what the trader was left with. "Nothing significant"
// is a true statement that answers nothing — it does not say whether to keep
// watching or drop the idea. The gap is computable, so it is now computed.

import { describe, it, expect } from 'vitest';
import { discoverPatternRun } from '../../app/lib/analytics/patterns';
import { sampleNeededFor, closestToSignificance, MAX_PROJECTED_DECIDED } from '../../app/lib/analytics/sampleNeeded';
import { PATTERN_ALPHA } from '../../app/lib/analytics/patterns';
import type { PatternCandidate } from '../../app/lib/analytics/types';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const t = (o: Partial<TradeEntry> = {}): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++), dateISO: '2026-08-10', time: '17:00',
  symbol: 'MNQ', direction: 'LONG', session: 'ny_am', entry: 100, stop: 95,
  target: 115, result: 'WIN', pnlUsd: 100, tradeR: 2, contracts: 1,
  bias: 'BULLISH', model: 'silver_bullet', notes: '', setup: 'REVERSAL',
  ...(o as object),
} as TradeEntry);

/** The shape that exposed the bug: one instrument, one model, locked to a
 *  session — an ordinary ICT routine. */
const lockedRoutine = () => [
  ...Array.from({ length: 16 }, (_, k) => t({ session: 'ny_am', time: '16:45',
    result: k < 11 ? 'WIN' : 'LOSS', tradeR: k < 11 ? 2 : -1, pnlUsd: k < 11 ? 200 : -100 })),
  ...Array.from({ length: 15 }, (_, k) => t({ session: 'london', time: '11:30',
    result: k < 4 ? 'WIN' : 'LOSS', tradeR: k < 4 ? 2 : -1, pnlUsd: k < 4 ? 200 : -100 })),
];

describe('the comparison count', () => {
  it('counts distinct trade-partitions, not candidates', () => {
    const { candidates, run } = discoverPatternRun(lockedRoutine());
    expect(candidates.length).toBeGreaterThan(run.comparisons);
    expect(run.comparisons).toBe(new Set(candidates.map(c => c.signature)).size);
  });

  it('does not punish a trader for being consistent', () => {
    // The locked routine produces many candidates over few real partitions.
    // Before the fix the divisor was the candidate count, so the more rigidly
    // someone traded the harder it became to tell them anything.
    const { candidates, run } = discoverPatternRun(lockedRoutine());
    expect(run.comparisons).toBeLessThan(candidates.length / 2);
  });

  it('reports the overall split, so a complement is reconstructable', () => {
    const { candidates, run } = discoverPatternRun(lockedRoutine());
    const any = candidates[0];
    expect(run.allWins).toBeGreaterThanOrEqual(any.metric.wins);
    expect(run.allLosses).toBeGreaterThanOrEqual(any.metric.losses);
  });
});

describe('sampleNeededFor', () => {
  const runFor = (trades: TradeEntry[]) => {
    const { candidates, run } = discoverPatternRun(trades);
    const near = closestToSignificance(candidates)!;
    const outside = { wins: run.allWins - near.metric.wins, losses: run.allLosses - near.metric.losses };
    return { near, run, need: sampleNeededFor(near, outside, run.comparisons, PATTERN_ALPHA) };
  };

  it('answers the question the trader actually has', () => {
    const { need } = runFor(lockedRoutine());
    expect(need).not.toBeNull();
    expect(need!.totalDecided).toBeGreaterThan(31);
    expect(need!.additional).toBeGreaterThan(0);
  });

  it('projects a journal LARGER than the one on hand', () => {
    const { need } = runFor(lockedRoutine());
    expect(need!.additional).toBe(need!.totalDecided - 31);
  });

  it('says nothing for a candidate that already passed', () => {
    const passed = { significant: true, metric: { wins: 10, losses: 0 }, baseline: 50 } as PatternCandidate;
    expect(sampleNeededFor(passed, { wins: 5, losses: 5 }, 5, PATTERN_ALPHA)).toBeNull();
  });

  it('says nothing when the group matches the rest exactly', () => {
    // No difference cannot be established by volume — more trades of the same
    // thing keep it at no difference forever, and a number here would be a lie.
    const flat = {
      significant: false, pAdjusted: 1,
      metric: { wins: 5, losses: 5, trades: 10 }, baseline: 50,
    } as PatternCandidate;
    expect(sampleNeededFor(flat, { wins: 10, losses: 10 }, 5, PATTERN_ALPHA)).toBeNull();
  });

  it('gives up rather than projecting an absurd horizon', () => {
    // A hair's-breadth difference would need thousands of trades. "Keep
    // trading for four years" is not advice; null is the honest output.
    const hair = {
      significant: false, pAdjusted: 1,
      metric: { wins: 51, losses: 49, trades: 100 }, baseline: 50,
    } as PatternCandidate;
    const need = sampleNeededFor(hair, { wins: 50, losses: 50 }, 5, PATTERN_ALPHA);
    if (need) expect(need.groupDecided).toBeLessThanOrEqual(MAX_PROJECTED_DECIDED);
  });

  it('needs a smaller journal when fewer comparisons were made', () => {
    // The whole point of counting partitions: a lower divisor is a nearer
    // finish line.
    const { near, run } = runFor(lockedRoutine());
    const outside = { wins: run.allWins - near.metric.wins, losses: run.allLosses - near.metric.losses };
    const strict  = sampleNeededFor(near, outside, 30, PATTERN_ALPHA);
    const lenient = sampleNeededFor(near, outside, 3,  PATTERN_ALPHA);
    expect(lenient!.totalDecided).toBeLessThan(strict!.totalDecided);
  });
});

describe('closestToSignificance', () => {
  const c = (over: Partial<PatternCandidate>): PatternCandidate =>
    ({ significant: false, pAdjusted: 0.5, metric: { wins: 5, losses: 5, trades: 10 }, ...over } as PatternCandidate);

  it('picks the nearest to the bar, not the biggest gap', () => {
    // A huge gap over four trades is further from being established than a
    // modest one over thirty. Pointing the trader at the four would send them
    // to chase noise.
    const wide = c({ id: 'wide', pAdjusted: 0.8, metric: { wins: 4, losses: 0, trades: 4 } as never });
    const near = c({ id: 'near', pAdjusted: 0.1, metric: { wins: 20, losses: 10, trades: 30 } as never });
    expect(closestToSignificance([wide, near])?.id).toBe('near');
  });

  it('ignores candidates that already passed', () => {
    const passed = c({ id: 'passed', significant: true, pAdjusted: 0.001 });
    const open   = c({ id: 'open', pAdjusted: 0.2 });
    expect(closestToSignificance([passed, open])?.id).toBe('open');
  });

  it('returns null when there is nothing to point at', () => {
    expect(closestToSignificance([])).toBeNull();
  });
});
