import { describe, expect, it } from 'vitest';
import { analyzeExits } from '../../app/lib/analytics/exits';
import { makeTrade } from '../helpers/trade';

// ES: risk = |entry-stop| in points. Long 5000 stop 4990 => 1R = 10 points.
// Planned target 5020 => planned 2R.

describe('analyzeExits', () => {
  it('ignores trades with no recorded exit legs', () => {
    const r = analyzeExits([makeTrade({ exits: undefined }), makeTrade({ exits: [] })]);
    expect(r.sampleSize).toBe(0);
    expect(r.captureRatio).toBeNull();
  });

  it('computes capture ratio as realized R vs planned R over winners', () => {
    // Winner planned 2R but exited at 5010 (+1R) => captures half the plan.
    const t = makeTrade({
      symbol: 'ES', direction: 'LONG', entry: 5000, stop: 4990, target: 5020,
      result: 'WIN', exits: [{ price: 5010, contracts: 1 }],
    });
    const r = analyzeExits([t]);
    expect(r.sampleSize).toBe(1);
    expect(r.winnerCount).toBe(1);
    expect(r.captureRatio).toBeCloseTo(0.5, 5); // 1R realized / 2R planned
    expect(r.winnersCutShort).toBe(1);          // 1R < 60% of 2R
    expect(r.avgWinnerR).toBeCloseTo(1, 5);
  });

  it('does not flag a winner that captured most of the plan', () => {
    const t = makeTrade({
      symbol: 'ES', direction: 'LONG', entry: 5000, stop: 4990, target: 5020,
      result: 'WIN', exits: [{ price: 5019, contracts: 1 }], // ~1.9R of a 2R plan
    });
    const r = analyzeExits([t]);
    expect(r.winnersCutShort).toBe(0);
    expect(r.captureRatio).toBeGreaterThan(0.9);
  });

  it('tracks partial-exit rate and average loser R', () => {
    const partialWinner = makeTrade({
      symbol: 'ES', direction: 'LONG', entry: 5000, stop: 4990, target: 5020,
      result: 'WIN', exits: [{ price: 5010, contracts: 1 }, { price: 5020, contracts: 1 }],
    });
    const fullLoss = makeTrade({
      symbol: 'ES', direction: 'LONG', entry: 5000, stop: 4990, target: 5020,
      result: 'LOSS', exits: [{ price: 4990, contracts: 1 }], // -1R
    });
    const r = analyzeExits([partialWinner, fullLoss]);
    expect(r.sampleSize).toBe(2);
    expect(r.partialExitRate).toBeCloseTo(0.5, 5); // 1 of 2 closed in >1 leg
    expect(r.avgLoserR).toBeCloseTo(-1, 5);
  });
});
