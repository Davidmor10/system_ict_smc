// The notebook's stats strip invented two numbers.
//
// A break-even trade was shown as a 50% win rate, and a day of nothing but
// break-evens as 0% — which reads as having lost everything. Both looked
// exactly like a measurement. One trade that decided nothing has no win rate,
// and "no trade was decided" is not "no trade won".

import { describe, expect, it } from 'vitest';
import { tradeStrip, dayStrip } from '../../app/lib/notebook/strip';
import { makeTrade } from '../helpers/trade';

describe('tradeStrip', () => {
  it('has no win rate for a break-even trade', () => {
    expect(tradeStrip(makeTrade({ result: 'BE' })).wr).toBeNull();
  });

  it('is 100 for a win and 0 for a loss', () => {
    expect(tradeStrip(makeTrade({ result: 'WIN'  })).wr).toBe(100);
    expect(tradeStrip(makeTrade({ result: 'LOSS' })).wr).toBe(0);
  });

  it('reads the trader\'s label, not the sign of the money', () => {
    // Closed a tick the right side of entry, and called a break-even by the
    // trader. Their verdict is the one that counts.
    const t = tradeStrip(makeTrade({ result: 'BE', entry: 100, stop: 99, target: 102, pnlUsd: 4 }));
    expect(t.wr).toBeNull();
    expect(t.wins).toBe(0);
  });
});

describe('dayStrip', () => {
  const day = '2026-07-06';
  const on = (result: 'WIN' | 'LOSS' | 'BE') => makeTrade({ dateISO: day, result });

  it('has no win rate on a day that decided nothing', () => {
    const s = dayStrip([on('BE'), on('BE')], day);
    expect('empty' in s).toBe(false);
    if ('empty' in s) return;
    expect(s.wr).toBeNull();
    expect(s.trades).toBe(2);
  });

  it('counts only decided trades in the rate', () => {
    const s = dayStrip([on('WIN'), on('LOSS'), on('BE')], day);
    if ('empty' in s) throw new Error('expected a day');
    expect(s.wr).toBe(50);
    expect(s.trades).toBe(3);
  });

  it('marks a day with no closed trades as empty', () => {
    expect(dayStrip([], day)).toEqual({ kind: 'daily', empty: true });
  });

  it('ignores trades from other days', () => {
    const s = dayStrip([on('WIN'), makeTrade({ dateISO: '2026-07-07', result: 'LOSS' })], day);
    if ('empty' in s) throw new Error('expected a day');
    expect(s.trades).toBe(1);
    expect(s.wr).toBe(100);
  });
});
