import { describe, expect, it } from 'vitest';
import {
  measureExperiment, improvedAgainst, measurableIn,
  EXPERIMENT_WINDOW, IMPROVEMENT_RATIO,
  type MeasureInput,
} from '../../app/lib/coach-pipeline/behavior/experiment';
import { hasRelapsed, type StoredFinding } from '../../app/lib/coach-pipeline/behavior/memory';

// ═══════════════════════════════════════════════════════════════════════════
// The improvement bar.
//
// It used to be a fixed twenty rate points. Measured against a live journal,
// two of the three behaviours ready to be worked on could not have been judged
// `improved` by ANY window — a habit at 18% would have had to fall to minus
// two. These tests pin the shape that replaced it: halve, and move by at least
// one occurrence's worth of the window.
// ═══════════════════════════════════════════════════════════════════════════

/** A finished window with no guardrail damage — only the target rates vary. */
function measured(historicalRate: number, rollingRate: number, afterRate: number): MeasureInput {
  return {
    before: { historicalRate, historicalN: 33, rollingRate, rollingN: 20 },
    afterRate,
    afterN: EXPERIMENT_WINDOW,
    guardrails: [],
  };
}

describe('improvedAgainst', () => {
  it('accepts a fall to half', () => {
    expect(improvedAgainst(0.4, 0.2, EXPERIMENT_WINDOW)).toBe(true);
  });

  it('rejects a fall that stops short of half', () => {
    expect(improvedAgainst(0.4, 0.21, EXPERIMENT_WINDOW)).toBe(false);
  });

  it('rejects a halving too small for the window to resolve', () => {
    // 4% → 2%: "halved", and a difference no ten-trade window can see.
    expect(improvedAgainst(0.04, 0.02, EXPERIMENT_WINDOW)).toBe(false);
  });

  it('has nothing to say when the behaviour never happened', () => {
    expect(improvedAgainst(0, 0, EXPERIMENT_WINDOW)).toBe(false);
  });
});

describe('measurableIn', () => {
  it('rejects a rate below one expected occurrence in the window', () => {
    // Under 10% of ten trades, a clean window is the ordinary outcome and
    // says nothing — so no window opens at all.
    expect(measurableIn(0.09)).toBe(false);
    expect(measurableIn(0.05)).toBe(false);
  });

  it('accepts a rate the window can actually see', () => {
    expect(measurableIn(0.1)).toBe(true);
    expect(measurableIn(0.18)).toBe(true);
  });

  it('scales with the window, not with a constant', () => {
    expect(measurableIn(0.05, 20)).toBe(true);
    expect(measurableIn(0.05, 10)).toBe(false);
  });
});

describe('measureExperiment on the live journal rates', () => {
  // Rule violations: 6 of 33 in the history, 4 of 20 rolling. Under the old
  // fixed bar this needed an after-rate of minus two per cent.
  it('a perfect window on an 18% habit now reads as improved', () => {
    expect(measureExperiment(measured(0.18, 0.2, 0)).verdict).toBe('improved');
  });

  // Size spikes: 7 of 28 in the history, 5 of 20 rolling.
  it('one slip in ten on a 25% habit still reads as improved', () => {
    expect(measureExperiment(measured(0.25, 0.25, 0.1)).verdict).toBe('improved');
  });

  it('three slips in ten on the same habit does not', () => {
    expect(measureExperiment(measured(0.25, 0.25, 0.3)).verdict).toBe('unchanged');
  });

  it('still needs both baselines to agree', () => {
    // A good fortnight: the rolling number halves, the history holds.
    expect(measureExperiment(measured(0.15, 0.4, 0.15)).verdict).toBe('unchanged');
  });

  it('still refuses to judge an unfinished window', () => {
    const input = { ...measured(0.18, 0.2, 0), afterN: EXPERIMENT_WINDOW - 1 };
    expect(measureExperiment(input).verdict).toBe('insufficient_data');
  });
});

describe('hasRelapsed', () => {
  const stored = (targetBefore: number) =>
    ({ experimentResult: { targetBefore } } as unknown as StoredFinding);

  it('uses the same bar the improvement was declared against', () => {
    // Improved from 20% means holding at or under 10%.
    expect(hasRelapsed(stored(0.2), 0.2 * IMPROVEMENT_RATIO)).toBe(false);
    expect(hasRelapsed(stored(0.2), 0.2 * IMPROVEMENT_RATIO + 0.01)).toBe(true);
  });

  it('never relapses a finding with no measurement behind it', () => {
    expect(hasRelapsed({} as StoredFinding, 0.9)).toBe(false);
    expect(hasRelapsed(stored(0), 0.9)).toBe(false);
  });
});
