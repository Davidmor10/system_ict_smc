// The plan and the outcome agreeing about which way the trade was pointing.
//
// TWO FUNCTIONS, ONE TRADE
//
// calcRealizedR has always taken the direction the trader declared. calcRR
// INFERRED it from where the stop sat, which is right for every well-formed
// trade and wrong in the one case worth catching: a long whose stop was typed
// above the entry, or a short whose stop went below it.
//
// One mistyped price then made the plan and the outcome read the same trade as
// opposite trades — and the pair the journal exists to compare disagreed about
// its sign, with both numbers looking perfectly ordinary.
//
// AND ONE LEG THAT CANNOT BE READ
//
// A multi-exit trade folded an uncomputable leg in as 0R. That is not "no
// answer", it is the claim that the leg came back flat, and it drags the whole
// trade toward break-even: a 2R trade with one unreadable leg reported about
// 1R, which looks like an ordinary trade rather than a broken record.

import { describe, it, expect } from 'vitest';
import { calcRR, calcRealizedR, calcMultiExitRealizedR } from '../../app/lib/calc/trade';

describe('calcRR with a declared direction', () => {
  it('agrees with the inference on a well-formed long', () => {
    expect(calcRR(100, 95, 115, 'LONG')).toBe(calcRR(100, 95, 115));
    expect(calcRR(100, 95, 115, 'LONG')).toBe(3);
  });

  it('agrees with the inference on a well-formed short', () => {
    expect(calcRR(100, 105, 85, 'SHORT')).toBe(calcRR(100, 105, 85));
    expect(calcRR(100, 105, 85, 'SHORT')).toBe(3);
  });

  it('refuses a long whose stop sits above the entry', () => {
    // THE CASE. Declared LONG, stop typed on the profit side. The inference
    // read it as a short and returned an ordinary-looking number.
    expect(calcRR(100, 105, 115, 'LONG')).toBeNull();
  });

  it('refuses a short whose stop sits below the entry', () => {
    expect(calcRR(100, 95, 85, 'SHORT')).toBeNull();
  });

  it('still infers when no direction is given', () => {
    // Callers that genuinely do not have one keep the old behaviour.
    expect(calcRR(100, 105, 115)).not.toBeNull();
  });

  it('keeps refusing a zero-risk plan whatever the direction says', () => {
    expect(calcRR(100, 100, 115, 'LONG')).toBeNull();
    expect(calcRR(100, 100, 115)).toBeNull();
  });

  it('now points the same way as the realized side on the same trade', () => {
    // The invariant. Both read the trade as the trader declared it, or both
    // decline — never one of each.
    const contradictory = { entry: 100, stop: 105, exit: 110, target: 115 } as const;
    expect(calcRR(contradictory.entry, contradictory.stop, contradictory.target, 'LONG')).toBeNull();
    // The realized side never inferred, so it was always reading the declared
    // direction; what changed is that the planned side no longer disagrees.
    expect(calcRealizedR(contradictory.entry, contradictory.exit, contradictory.stop, 'LONG')).toBe(2);
  });
});

describe('calcRealizedR', () => {
  it('returns null rather than NaN for an absent price', () => {
    const bad = undefined as unknown as number;
    expect(calcRealizedR(100, bad, 95, 'LONG')).toBeNull();
    expect(calcRealizedR(bad, 110, 95, 'LONG')).toBeNull();
    expect(calcRealizedR(100, 110, bad, 'LONG')).toBeNull();
    expect(calcRealizedR(100, NaN, 95, 'LONG')).toBeNull();
  });

  it('still refuses a zero-risk trade', () => {
    expect(calcRealizedR(100, 110, 100, 'LONG')).toBeNull();
  });
});

describe('calcMultiExitRealizedR', () => {
  const legs = (...pairs: Array<[number, number]>) =>
    pairs.map(([price, contracts]) => ({ price, contracts }));

  it('weights ordinary legs by contracts', () => {
    // 2 contracts at +2R, 2 at +1R → 1.5R.
    expect(calcMultiExitRealizedR(100, 95, legs([110, 2], [105, 2]), 'LONG')).toBe(1.5);
  });

  it('excludes an unreadable leg instead of calling it flat', () => {
    // THE REGRESSION. Folded in as 0, this reported 1.33R for a trade whose
    // readable part returned 2R.
    const bad = undefined as unknown as number;
    expect(calcMultiExitRealizedR(100, 95, legs([110, 2], [bad, 1]), 'LONG')).toBe(2);
  });

  it('excludes a leg with no contracts behind it', () => {
    expect(calcMultiExitRealizedR(100, 95, legs([110, 2], [105, 0]), 'LONG')).toBe(2);
  });

  it('returns null when no leg can be read at all', () => {
    // Zero risk makes every leg unreadable. It used to return 0 — a confident
    // break-even for a trade with no risk defined.
    expect(calcMultiExitRealizedR(100, 100, legs([110, 2], [105, 2]), 'LONG')).toBeNull();
  });

  it('returns null for an empty leg list', () => {
    expect(calcMultiExitRealizedR(100, 95, [], 'LONG')).toBeNull();
  });

  it('never returns NaN', () => {
    const bad = undefined as unknown as number;
    const shapes = [
      legs([bad, 1]),
      legs([110, bad]),
      legs([NaN, 2], [105, 2]),
      legs([110, -1]),
    ];
    for (const l of shapes) {
      const out = calcMultiExitRealizedR(100, 95, l, 'LONG');
      expect(out === null || Number.isFinite(out), JSON.stringify(l)).toBe(true);
    }
  });

  it('works for shorts', () => {
    expect(calcMultiExitRealizedR(100, 105, legs([90, 2], [95, 2]), 'SHORT')).toBe(1.5);
  });
});
