import { describe, expect, it } from 'vitest';
import { analyzeEmotions } from '../../app/lib/analytics/emotions';
import { makeTrade } from '../helpers/trade';

describe('analyzeEmotions', () => {
  it('groups by emotional state and computes win rate per state', () => {
    const trades = [
      makeTrade({ emotionalState: 'CALM', result: 'WIN' }),
      makeTrade({ emotionalState: 'CALM', result: 'WIN' }),
      makeTrade({ emotionalState: 'CALM', result: 'LOSS' }),
      makeTrade({ emotionalState: 'FOMO', result: 'LOSS' }),
      makeTrade({ emotionalState: 'FOMO', result: 'LOSS' }),
    ];
    const groups = analyzeEmotions(trades);
    const calm = groups.find(g => g.key === 'CALM')!;
    const fomo = groups.find(g => g.key === 'FOMO')!;
    expect(calm.winRate).toBeCloseTo(66.67, 1);
    expect(fomo.winRate).toBe(0);
  });

  it('excludes trades with no recorded emotional state', () => {
    const trades = [
      makeTrade({ emotionalState: 'CALM' }),
      makeTrade({ emotionalState: undefined }),
    ];
    const groups = analyzeEmotions(trades);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('CALM');
  });

  it('sorts by sample size, most-frequent state first', () => {
    const trades = [
      makeTrade({ emotionalState: 'STRESSED' }),
      makeTrade({ emotionalState: 'CALM' }),
      makeTrade({ emotionalState: 'CALM' }),
      makeTrade({ emotionalState: 'CALM' }),
    ];
    expect(analyzeEmotions(trades)[0].key).toBe('CALM');
  });

  it('returns an empty array when no trade has an emotional state', () => {
    expect(analyzeEmotions([makeTrade({ emotionalState: undefined })])).toEqual([]);
  });
});
