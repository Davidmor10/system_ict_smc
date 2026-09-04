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

  // THE WARNING THAT FIRED ON NOTHING.
  //
  // A ten-point gap used to be the whole test. On eight decided trades one
  // extra loss moves the rate by twelve points, so an ordinary slice of an
  // ordinary trader cleared it constantly: simulated against a trader whose
  // slices are all identical, about half of their saves drew a warning that
  // some slice was "below your overall average". A panel that fires on half
  // of all saves is a panel the trader learns to close.
  it('stays silent on a gap that is only a small number wobbling', () => {
    // 3W/5L in the slice against 9W/3L everywhere else — a 22-point gap, and
    // Fisher puts it at p = 0.17. Nothing happened here.
    const wobble = [
      ...Array.from({ length: 3 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', result: 'WIN' })),
      ...Array.from({ length: 5 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', result: 'LOSS' })),
      ...Array.from({ length: 9 }, () => makeTrade({ direction: 'LONG', session: 'nyam', result: 'WIN' })),
      ...Array.from({ length: 3 }, () => makeTrade({ direction: 'LONG', session: 'nyam', result: 'LOSS' })),
    ];
    expect(checkTrade(pending({ direction: 'SHORT', session: 'nypm' }), wobble, TODAY)
      .some(x => x.id === 'weak_session_direction')).toBe(false);
  });

  // And the correction, which is what stops two slices being tested at 5%
  // each and the pair firing at ten.
  it('corrects for both slices when both are looked at', () => {
    // 2W/8L against 9W/1L: p = 0.0055 alone, 0.011 corrected for two — still
    // a real finding, and it must survive the correction.
    const real = [
      ...Array.from({ length: 2 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', emotionalState: 'CALM', result: 'WIN' })),
      ...Array.from({ length: 8 }, () => makeTrade({ direction: 'SHORT', session: 'nypm', emotionalState: 'CALM', result: 'LOSS' })),
      ...Array.from({ length: 9 }, () => makeTrade({ direction: 'LONG', session: 'nyam', emotionalState: 'CALM', result: 'WIN' })),
      ...Array.from({ length: 1 }, () => makeTrade({ direction: 'LONG', session: 'nyam', emotionalState: 'CALM', result: 'LOSS' })),
    ];
    expect(checkTrade(pending({ direction: 'SHORT', session: 'nypm' }), real, TODAY)
      .some(x => x.id === 'weak_session_direction')).toBe(true);
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

describe('checkTrade — counter bias', () => {
  it('flags a trade against the direction recorded on it', () => {
    const w = checkTrade(pending({ biasAlignment: 'COUNTER' }), [makeTrade()], TODAY);
    expect(w.some(x => x.id === 'counter_bias')).toBe(true);
  });

  it('says nothing for an aligned trade with no other issues', () => {
    const w = checkTrade(pending({ biasAlignment: 'ALIGNED' }), [makeTrade({ result: 'WIN' })], TODAY);
    expect(w).toHaveLength(0);
  });

  // No direction recorded is not a warning. The two notes that used to be
  // here existed because the direction lived on the dashboard, where it could
  // be forgotten in the morning or written in at night. It is a field on the
  // form now, in front of the trader as they log the trade.
  it('says nothing when no direction was recorded', () => {
    const w = checkTrade(pending({ biasAlignment: undefined }), [makeTrade({ result: 'WIN' })], TODAY);
    expect(w).toHaveLength(0);
  });
});
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
