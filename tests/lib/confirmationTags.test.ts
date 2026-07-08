import { describe, expect, it } from 'vitest';
import { analyzeConfirmationTags, analyzeConfirmationCombos, comboKey } from '../../app/lib/analytics/confirmationTags';
import { makeTrade } from '../helpers/trade';

describe('comboKey', () => {
  it('is order-independent', () => {
    expect(comboKey(['SMT', 'IFVG'])).toBe(comboKey(['IFVG', 'SMT']));
    expect(comboKey(['SMT', 'IFVG'])).toBe('IFVG+SMT');
  });
  it('is empty for no confirmations', () => {
    expect(comboKey(undefined)).toBe('');
    expect(comboKey([])).toBe('');
  });
});

describe('analyzeConfirmationTags', () => {
  it('counts a trade in every tag it carries', () => {
    const trades = [
      makeTrade({ confirmations: ['SMT', 'IFVG'], result: 'WIN' }),
      makeTrade({ confirmations: ['SMT'], result: 'LOSS' }),
    ];
    const groups = analyzeConfirmationTags(trades);
    const smt = groups.find(g => g.key === 'SMT')!;
    const ifvg = groups.find(g => g.key === 'IFVG')!;
    expect(smt.trades).toBe(2);   // appears in both trades
    expect(ifvg.trades).toBe(1);
    expect(smt.winRate).toBe(50); // 1W / 1L among the two SMT trades
    expect(ifvg.winRate).toBe(100);
  });

  it('ignores trades with no confirmations', () => {
    const groups = analyzeConfirmationTags([makeTrade({ confirmations: undefined })]);
    expect(groups).toEqual([]);
  });
});

describe('analyzeConfirmationCombos', () => {
  it('treats the exact tag set as its own group, distinct from single tags', () => {
    const trades = [
      makeTrade({ confirmations: ['SMT', 'IFVG'], result: 'WIN' }),
      makeTrade({ confirmations: ['SMT', 'IFVG'], result: 'WIN' }),
      makeTrade({ confirmations: ['SMT'], result: 'LOSS' }),
    ];
    const combos = analyzeConfirmationCombos(trades);
    const both = combos.find(g => g.key === 'IFVG+SMT')!;
    const single = combos.find(g => g.key === 'SMT')!;
    expect(both.trades).toBe(2);
    expect(both.winRate).toBe(100);
    expect(single.trades).toBe(1);
    expect(single.winRate).toBe(0);
  });

  it('excludes trades with no confirmations entirely', () => {
    const combos = analyzeConfirmationCombos([
      makeTrade({ confirmations: [] }),
      makeTrade({ confirmations: ['CISD'] }),
    ]);
    expect(combos).toHaveLength(1);
    expect(combos[0].key).toBe('CISD');
  });
});
