import { describe, expect, it } from 'vitest';
import { checkTrade, type PendingTrade } from '../../app/lib/guardian/checkTrade';
import { makeTrade } from '../helpers/trade';
import { computeBiasAlignment } from '../../app/lib/dailyBias';

const TODAY = '2026-07-09';

const pending = (over: Partial<PendingTrade> = {}): PendingTrade => ({
  symbol: 'ES', direction: 'SHORT', session: 'nypm', ...over,
});

describe('checkTrade — tilt', () => {
  it('flags high severity at 3 losses today', () => {
    const trades = [
      makeTrade({ dateISO: TODAY, result: 'LOSS' }),
      makeTrade({ dateISO: TODAY, result: 'LOSS' }),
      makeTrade({ dateISO: TODAY, result: 'LOSS' }),
    ];
    const w = checkTrade(pending(), trades, TODAY);
    const tilt = w.find(x => x.id === 'tilt');
    expect(tilt?.severity).toBe('high');
    expect(tilt?.text).toContain('3');
  });

  it('does not count losses from other days', () => {
    const trades = [makeTrade({ dateISO: '2026-07-01', result: 'LOSS' }), makeTrade({ dateISO: '2026-07-02', result: 'LOSS' })];
    expect(checkTrade(pending(), trades, TODAY).some(x => x.id === 'tilt')).toBe(false);
  });
});

describe('checkTrade — weak slice (evidence-gated)', () => {
  it('warns on a weak session×direction only when the sample is large enough', () => {
    // 10 SHORT/nypm trades at 20% win rate, plus 10 winning LONG trades → overall well above the slice.
    const weakShorts = [
      ...Array.from({ length: 2 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', result: 'WIN' })),
      ...Array.from({ length: 8 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', result: 'LOSS' })),
      ...Array.from({ length: 10 }, () => makeTrade({ direction: 'LONG', session: 'nyam', result: 'WIN' })),
    ];
    const w = checkTrade(pending({ direction: 'SHORT', session: 'nypm' }), weakShorts, TODAY);
    const weak = w.find(x => x.id === 'weak_session_direction');
    expect(weak).toBeTruthy();
    expect(weak?.text).toContain('20%');
    expect(weak?.text).toContain('10'); // sample size cited
  });

  it('stays silent when the weak slice sample is too small', () => {
    // Only 3 SHORT/nypm trades — below the 8-decided floor → no warning.
    const few = [
      ...Array.from({ length: 3 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', result: 'LOSS' })),
      ...Array.from({ length: 10 }, () => makeTrade({ direction: 'LONG', session: 'nyam', result: 'WIN' })),
    ];
    expect(checkTrade(pending({ direction: 'SHORT', session: 'nypm' }), few, TODAY).some(x => x.id === 'weak_session_direction')).toBe(false);
  });
});

describe('checkTrade — the day\'s direction', () => {
  it('flags a counter-bias trade', () => {
    const w = checkTrade(pending({ biasAlignment: 'COUNTER', declarationState: 'before' }), [makeTrade()], TODAY);
    expect(w.some(x => x.id === 'counter_bias')).toBe(true);
  });

  it('says nothing for an aligned trade with no other issues', () => {
    const w = checkTrade(pending({ biasAlignment: 'ALIGNED', declarationState: 'before' }), [makeTrade({ result: 'WIN' })], TODAY);
    expect(w).toHaveLength(0);
  });

  // The gap this closes. The guardian spoke only when a trade went AGAINST a
  // declared direction, so it was silent on the days nothing was declared —
  // the days with no plan to go against, and the ones where friction is worth
  // most.
  it('speaks when no direction was declared for the day', () => {
    const w = checkTrade(pending({ declarationState: 'none' }), [makeTrade({ result: 'WIN' })], TODAY);
    expect(w.some(x => x.id === 'no_bias_declared')).toBe(true);
  });

  it('separates a direction declared after the trade from one declared before', () => {
    const w = checkTrade(pending({ declarationState: 'after' }), [makeTrade({ result: 'WIN' })], TODAY);
    expect(w.some(x => x.id === 'bias_declared_late')).toBe(true);
    expect(w.some(x => x.id === 'no_bias_declared')).toBe(false);
  });

  // One statement about the day's direction, never two.
  it('does not stack the missing-direction note onto a counter-bias trade', () => {
    const w = checkTrade(pending({ biasAlignment: 'COUNTER', declarationState: 'before' }), [makeTrade()], TODAY);
    expect(w.filter(x => ['counter_bias', 'no_bias_declared', 'bias_declared_late'].includes(x.id))).toHaveLength(1);
  });

  // Neither note is a verdict: the trade may still be right, and the guardian
  // never says otherwise.
  it('keeps both notes at the lowest severity', () => {
    const none = checkTrade(pending({ declarationState: 'none' }), [makeTrade({ result: 'WIN' })], TODAY);
    const late = checkTrade(pending({ declarationState: 'after' }), [makeTrade({ result: 'WIN' })], TODAY);
    expect(none.find(x => x.id === 'no_bias_declared')!.severity).toBe('info');
    expect(late.find(x => x.id === 'bias_declared_late')!.severity).toBe('info');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bias alignment
//
// The live symptom: every trade the trader logged, long and short alike, came
// back marked "aligned with today's bias". The cause was the same one that has
// produced every other silent failure here — an absent answer read as a
// positive one.
// ═══════════════════════════════════════════════════════════════════════════

describe('computeBiasAlignment', () => {
  it('answers nothing when no direction was declared', () => {
    expect(computeBiasAlignment(null, 'LONG')).toBeNull();
    expect(computeBiasAlignment(null, 'SHORT')).toBeNull();
  });

  // A trader with no directional view has nothing for a trade to agree or
  // disagree with. Calling that alignment invents a comparison.
  it('answers nothing for an explicitly undecided day', () => {
    expect(computeBiasAlignment('INDECISIVE', 'LONG')).toBeNull();
  });

  it('reads a long under a bullish bias as aligned, a short as counter', () => {
    expect(computeBiasAlignment('BULLISH', 'LONG')).toBe('ALIGNED');
    expect(computeBiasAlignment('BULLISH', 'SHORT')).toBe('COUNTER');
  });

  it('reads a short under a bearish bias as aligned, a long as counter', () => {
    expect(computeBiasAlignment('BEARISH', 'SHORT')).toBe('ALIGNED');
    expect(computeBiasAlignment('BEARISH', 'LONG')).toBe('COUNTER');
  });

  // The bug in its exact shape: two opposite trades on the same day both
  // reported as being with the day's direction.
  it('cannot mark a long and a short on the same day as both aligned', () => {
    const long  = computeBiasAlignment(null, 'LONG');
    const short = computeBiasAlignment(null, 'SHORT');
    expect([long, short].filter(a => a === 'ALIGNED')).toHaveLength(0);
  });
});
