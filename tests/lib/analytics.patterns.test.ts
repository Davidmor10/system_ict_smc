import { describe, expect, it } from 'vitest';
import { discoverPatterns } from '../../app/lib/analytics/patterns';
import { makeTrade } from '../helpers/trade';

describe('discoverPatterns — bias alignment / setup / weekday dimensions', () => {
  it('surfaces a bias-alignment candidate when aligned trades clearly outperform', () => {
    const trades = [
      ...Array.from({ length: 5 }, () => makeTrade({ biasAlignment: 'ALIGNED', result: 'WIN' })),
      ...Array.from({ length: 5 }, () => makeTrade({ biasAlignment: 'COUNTER', result: 'LOSS' })),
    ];
    const candidates = discoverPatterns(trades);
    const aligned = candidates.find(c => c.kind === 'bias_alignment' && c.subject.biasAlignment === 'ALIGNED');
    expect(aligned).toBeDefined();
    expect(aligned!.metric.winRate).toBe(100);
    expect(aligned!.metric.trades).toBe(5);
  });

  it('surfaces a setup candidate (reversal vs continuation)', () => {
    const trades = [
      ...Array.from({ length: 4 }, () => makeTrade({ setup: 'REVERSAL', result: 'WIN' })),
      ...Array.from({ length: 4 }, () => makeTrade({ setup: 'CONTINUATION', result: 'LOSS' })),
    ];
    const candidates = discoverPatterns(trades);
    const reversal = candidates.find(c => c.kind === 'setup' && c.subject.setup === 'REVERSAL');
    const continuation = candidates.find(c => c.kind === 'setup' && c.subject.setup === 'CONTINUATION');
    expect(reversal?.metric.winRate).toBe(100);
    expect(continuation?.metric.winRate).toBe(0);
  });

  it('surfaces a weekday candidate for a day with enough trades', () => {
    // 2026-07-14 is a Tuesday.
    const trades = Array.from({ length: 4 }, () => makeTrade({ dateISO: '2026-07-14', result: 'WIN' }));
    const candidates = discoverPatterns(trades);
    const tuesday = candidates.find(c => c.kind === 'weekday');
    expect(tuesday).toBeDefined();
    expect(tuesday!.subject.weekday).toBe(2); // Sunday=0 .. Tuesday=2
    expect(tuesday!.metric.trades).toBe(4);
  });

  it('does not surface a bias/setup/weekday candidate below the 3-trade floor', () => {
    const trades = [
      makeTrade({ biasAlignment: 'ALIGNED', setup: 'REVERSAL', dateISO: '2026-07-14' }),
      makeTrade({ biasAlignment: 'ALIGNED', setup: 'REVERSAL', dateISO: '2026-07-14' }),
    ];
    const candidates = discoverPatterns(trades);
    expect(candidates.some(c => c.kind === 'bias_alignment')).toBe(false);
    expect(candidates.some(c => c.kind === 'setup')).toBe(false);
    expect(candidates.some(c => c.kind === 'weekday')).toBe(false);
  });
});
