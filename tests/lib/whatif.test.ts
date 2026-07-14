import { describe, expect, it } from 'vitest';
import { simulate, availableScenarios, tradedHours, hourScenario } from '../../app/lib/analytics/whatif';
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

  it('offers "only emotion X" when it has >=2 trades and something to remove', () => {
    const trades = [
      makeTrade({ emotionalState: 'FOMO' }), makeTrade({ emotionalState: 'FOMO' }),
      makeTrade({ emotionalState: 'STRESSED' }),
    ];
    const onlyFomo = availableScenarios(trades).find(s => s.kind === 'onlyEmotion' && s.value === 'FOMO')!;
    expect(onlyFomo).toBeTruthy();
    expect(trades.filter(onlyFomo.predicate)).toHaveLength(2);
    // STRESSED has only 1 trade → below the min, not offered as "only".
    expect(availableScenarios(trades).some(s => s.kind === 'onlyEmotion' && s.value === 'STRESSED')).toBe(false);
    // and never when every trade shares the one emotion (nothing to remove)
    const allFomo = [makeTrade({ emotionalState: 'FOMO' }), makeTrade({ emotionalState: 'FOMO' })];
    expect(availableScenarios(allFomo).some(s => s.kind === 'onlyEmotion')).toBe(false);
  });

  it('offers "only untagged emotion" when some trades are left untagged', () => {
    const trades = [
      makeTrade({ emotionalState: 'FOMO' }),
      makeTrade({ emotionalState: undefined }), makeTrade({ emotionalState: undefined }),
    ];
    expect(availableScenarios(trades).some(s => s.kind === 'onlyNoEmotion')).toBe(true);
  });

  it('offers "only symbol X" only when more than one instrument was traded', () => {
    const oneSym = [makeTrade({ symbol: 'ES' }), makeTrade({ symbol: 'ES' })];
    expect(availableScenarios(oneSym).some(s => s.kind === 'onlySymbol')).toBe(false);

    const two = [makeTrade({ symbol: 'ES' }), makeTrade({ symbol: 'ES' }), makeTrade({ symbol: 'NQ' }), makeTrade({ symbol: 'NQ' })];
    const onlyEs = availableScenarios(two).find(s => s.kind === 'onlySymbol' && s.value === 'ES')!;
    expect(onlyEs).toBeTruthy();
    expect(two.filter(onlyEs.predicate)).toHaveLength(2);
  });
});

describe('custom hour window', () => {
  it('tradedHours lists distinct entry hours with counts, sorted', () => {
    const trades = [
      makeTrade({ time: '16:05' }), makeTrade({ time: '16:59' }),
      makeTrade({ time: '09:30' }),
    ];
    expect(tradedHours(trades)).toEqual([{ hour: 9, count: 1 }, { hour: 16, count: 2 }]);
  });

  it('hourScenario keeps only trades entered in that one-hour window', () => {
    const trades = [makeTrade({ time: '16:05' }), makeTrade({ time: '16:45' }), makeTrade({ time: '17:00' })];
    const s = hourScenario(16);
    expect(s.kind).toBe('onlyHour');
    expect(trades.filter(s.predicate)).toHaveLength(2); // 17:00 is the next window
  });
});
