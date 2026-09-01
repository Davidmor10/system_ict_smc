import { describe, expect, it } from 'vitest';
import { simulate, availableScenarios, timedTradeCount, hourScenario, ruleScenarios } from '../../app/lib/analytics/whatif';
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

  it('offers "only setup X" per ICT model with >=2 trades and something to remove', () => {
    const trades = [makeTrade({ model: 'FVG' }), makeTrade({ model: 'FVG' }), makeTrade({ model: 'OTE' })];
    const s = availableScenarios(trades).find(x => x.kind === 'onlySetup' && x.value === 'FVG')!;
    expect(s).toBeTruthy();
    expect(trades.filter(s.predicate)).toHaveLength(2);
    // a single model everywhere → nothing to remove → not offered
    const allFvg = [makeTrade({ model: 'FVG' }), makeTrade({ model: 'FVG' })];
    expect(availableScenarios(allFvg).some(x => x.kind === 'onlySetup')).toBe(false);
  });
});

describe('custom time window', () => {
  it('timedTradeCount counts trades with a parseable entry time', () => {
    expect(timedTradeCount([makeTrade({ time: '16:05' }), makeTrade({ time: '' }), makeTrade({ time: '09:30' })])).toBe(2);
  });

  it('hourScenario keeps trades in [start, start+60) with minute precision', () => {
    const trades = [makeTrade({ time: '16:05' }), makeTrade({ time: '16:45' }), makeTrade({ time: '17:00' })];
    const s = hourScenario(16 * 60); // 16:00 → window 16:00–17:00
    expect(s.kind).toBe('onlyHour');
    expect(trades.filter(s.predicate)).toHaveLength(2); // 17:00 is the next window

    // custom start 16:03 → 16:03–17:03, so 17:00 is now inside, 16:00 would be out
    const custom = hourScenario(16 * 60 + 3);
    const t2 = [makeTrade({ time: '16:00' }), makeTrade({ time: '16:30' }), makeTrade({ time: '17:00' }), makeTrade({ time: '17:03' })];
    expect(t2.filter(custom.predicate).map(t => t.time)).toEqual(['16:30', '17:00']);
  });

  it('hourScenario wraps past midnight', () => {
    const s = hourScenario(23 * 60 + 30); // 23:30 → 00:30
    const trades = [makeTrade({ time: '23:45' }), makeTrade({ time: '00:15' }), makeTrade({ time: '01:00' })];
    expect(trades.filter(s.predicate).map(t => t.time)).toEqual(['23:45', '00:15']);
  });
});

describe('ruleScenarios', () => {
  it('compares clean days vs. days a rule was broken', () => {
    const trades = [makeTrade({ dateISO: '2026-07-01' }), makeTrade({ dateISO: '2026-07-02' })];
    const rules = [{ id: 'r1', text: 'no revenge trading', violationDates: ['2026-07-02'] }];
    const scns = ruleScenarios(trades, rules);

    const clean = scns.find(s => s.kind === 'cleanRuleDays')!;
    expect(clean).toBeTruthy();
    expect(trades.filter(clean.predicate).map(t => t.dateISO)).toEqual(['2026-07-01']);

    const xr = scns.find(s => s.kind === 'excludeRuleDay' && s.value === 'r1')!;
    expect(xr).toBeTruthy();
    expect(trades.filter(xr.predicate).map(t => t.dateISO)).toEqual(['2026-07-01']);
  });

  it('offers nothing when no traded day has a violation', () => {
    const trades = [makeTrade({ dateISO: '2026-07-01' }), makeTrade({ dateISO: '2026-07-02' })];
    const rules = [{ id: 'r1', text: 'x', violationDates: ['2026-06-30'] }]; // a day with no trades
    expect(ruleScenarios(trades, rules)).toHaveLength(0);
  });
});

// A trade taken on a day with no declared direction has NO alignment. The
// predicate used to be `!== 'COUNTER'`, which swept every one of those in as
// though it had been aligned — so "only trading with my bias" actually
// measured "everything except the days I admitted going against it". On a
// trader who declares sporadically that is most of the journal, and the
// flattering number was presented as a simulation result.
describe('the only-bias-aligned scenario', () => {
  const withAlignment = () => [
    makeTrade({ biasAlignment: 'ALIGNED', result: 'WIN' }),
    makeTrade({ biasAlignment: 'ALIGNED', result: 'WIN' }),
    makeTrade({ biasAlignment: 'COUNTER', result: 'LOSS' }),
    makeTrade({ biasAlignment: undefined, result: 'LOSS' }),   // never declared
  ];

  it('keeps only the trades actually aligned with a declared direction', () => {
    const scenario = availableScenarios(withAlignment()).find(s => s.kind === 'onlyBiasAligned');
    expect(scenario).toBeDefined();
    const kept = withAlignment().filter(scenario!.predicate);
    expect(kept).toHaveLength(2);
    expect(kept.every(t => t.biasAlignment === 'ALIGNED')).toBe(true);
  });

  it('does not count a trade with no declaration as aligned', () => {
    const scenario = availableScenarios(withAlignment()).find(s => s.kind === 'onlyBiasAligned');
    expect(scenario!.predicate(makeTrade({ biasAlignment: undefined }))).toBe(false);
  });

  // Nothing to simulate when the trader never went against their own call.
  it('is not offered when no trade was taken against the declared direction', () => {
    const trades = [
      makeTrade({ biasAlignment: 'ALIGNED', result: 'WIN' }),
      makeTrade({ biasAlignment: undefined, result: 'LOSS' }),
    ];
    expect(availableScenarios(trades).find(s => s.kind === 'onlyBiasAligned')).toBeUndefined();
  });
});
