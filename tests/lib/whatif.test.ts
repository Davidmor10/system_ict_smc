import { describe, expect, it } from 'vitest';
import { simulate, availableScenarios } from '../../app/lib/analytics/whatif';
import { makeTrade } from '../helpers/trade';

describe('simulate', () => {
  it('recomputes metrics over the kept subset and reports the delta + subset confidence', () => {
    // 2 calm winners, 2 FOMO losers. Excluding FOMO should lift win rate from 50% to 100%.
    const trades = [
      makeTrade({ emotionalState: 'CALM', result: 'WIN' }),
      makeTrade({ emotionalState: 'CALM', result: 'WIN' }),
      makeTrade({ emotionalState: 'FOMO', result: 'LOSS' }),
      makeTrade({ emotionalState: 'FOMO', result: 'LOSS' }),
    ];
    const r = simulate(trades, t => t.emotionalState !== 'FOMO');
    expect(r.actual.winRate).toBe(50);
    expect(r.filtered.winRate).toBe(100);
    expect(r.delta.winRate).toBe(50);
    expect(r.keptTrades).toBe(2);
    expect(r.keptClosed).toBe(2);
    expect(r.removedTrades).toBe(2);
    expect(r.confidence.level).toBe('low'); // only 2 decided — never sold as a real edge
  });

  it('marks confidence high once the kept subset crosses 30 decided trades', () => {
    const trades = Array.from({ length: 40 }, (_, i) => makeTrade({ result: i % 2 === 0 ? 'WIN' : 'LOSS', emotionalState: 'CALM' }));
    const r = simulate(trades, () => true);
    expect(r.keptClosed).toBe(40);
    expect(r.confidence.level).toBe('high');
  });
});

describe('availableScenarios', () => {
  it('offers an exclude-emotion scenario only when some trades have it and some do not', () => {
    const mixed = [makeTrade({ emotionalState: 'FOMO' }), makeTrade({ emotionalState: 'CALM' })];
    expect(availableScenarios(mixed).some(s => s.kind === 'excludeEmotion' && s.value === 'FOMO')).toBe(true);

    const allFomo = [makeTrade({ emotionalState: 'FOMO' }), makeTrade({ emotionalState: 'FOMO' })];
    // Excluding FOMO would empty the set and change nothing meaningful → not offered.
    expect(availableScenarios(allFomo).some(s => s.kind === 'excludeEmotion')).toBe(false);
  });

  it('offers both directions only when both are present, and its predicate filters correctly', () => {
    const oneDir = [makeTrade({ direction: 'LONG' }), makeTrade({ direction: 'LONG' })];
    expect(availableScenarios(oneDir).some(s => s.kind === 'onlyDirection')).toBe(false);

    const both = [makeTrade({ direction: 'LONG' }), makeTrade({ direction: 'SHORT' })];
    const longOnly = availableScenarios(both).find(s => s.kind === 'onlyDirection' && s.value === 'LONG')!;
    expect(longOnly).toBeTruthy();
    expect(both.filter(longOnly.predicate)).toHaveLength(1);
  });

  it('offers bias-aligned only when there are counter-bias trades', () => {
    const withCounter = [makeTrade({ biasAlignment: 'ALIGNED' }), makeTrade({ biasAlignment: 'COUNTER' })];
    expect(availableScenarios(withCounter).some(s => s.kind === 'onlyBiasAligned')).toBe(true);

    const allAligned = [makeTrade({ biasAlignment: 'ALIGNED' }), makeTrade({ biasAlignment: 'ALIGNED' })];
    expect(availableScenarios(allAligned).some(s => s.kind === 'onlyBiasAligned')).toBe(false);
  });
});
