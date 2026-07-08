import { describe, expect, it } from 'vitest';
import { calcMultiExitPnL, calcMultiExitRealizedR, calcWeightedExitPrice } from '../../app/lib/calc/trade';

// ES: tickSize 0.25, tickValue 12.5 -> pointValue = 50 $/point/contract.

describe('calcMultiExitPnL', () => {
  it('sums PnL across every exit leg, weighted by contracts', () => {
    // Long ES @ 5000, 2 contracts @ 5010 (+10pts) and 1 contract @ 4995 (-5pts).
    const pnl = calcMultiExitPnL(5000, [{ price: 5010, contracts: 2 }, { price: 4995, contracts: 1 }], 'LONG', 'ES');
    // (10 * 50 * 2) + (-5 * 50 * 1) = 1000 - 250 = 750
    expect(pnl).toBe(750);
  });

  it('returns 0 for an empty exits array', () => {
    expect(calcMultiExitPnL(5000, [], 'LONG', 'ES')).toBe(0);
  });

  it('respects direction for a short', () => {
    const pnl = calcMultiExitPnL(5000, [{ price: 4990, contracts: 1 }], 'SHORT', 'ES');
    expect(pnl).toBe(500); // 10pts favorable * 50 * 1
  });
});

describe('calcMultiExitRealizedR', () => {
  it('weights realized R by contracts across legs', () => {
    // Long entry 5000, stop 4990 (risk = 10pts = 1R). Exit 6 @ 5010 (1R), exit 4 @ 5020 (2R).
    const r = calcMultiExitRealizedR(5000, 4990, [{ price: 5010, contracts: 6 }, { price: 5020, contracts: 4 }], 'LONG');
    // (1*6 + 2*4) / 10 = 14/10 = 1.4
    expect(r).toBeCloseTo(1.4, 5);
  });

  it('returns null when there are no exits', () => {
    expect(calcMultiExitRealizedR(5000, 4990, [], 'LONG')).toBeNull();
  });
});

describe('calcWeightedExitPrice', () => {
  it('averages exit prices weighted by contracts', () => {
    const avg = calcWeightedExitPrice([{ price: 5010, contracts: 3 }, { price: 5020, contracts: 1 }]);
    // (5010*3 + 5020*1) / 4 = (15030+5020)/4 = 20050/4 = 5012.5
    expect(avg).toBeCloseTo(5012.5, 5);
  });

  it('returns null for an empty array', () => {
    expect(calcWeightedExitPrice([])).toBeNull();
  });
});
