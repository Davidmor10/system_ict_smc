// Ready to measure is not the same as ready to explain.
//
// `confirmed` is the only status a measurement window opens for, and it used
// to require a confidence of `medium` — which requires a trigger, a context
// the behaviour demonstrably concentrates in. So a habit the system could
// count perfectly well was refused a window because nobody could say WHEN it
// happened.
//
// Those are different questions, and a window only asks one of them: it
// compares a rate before against the same rate after. `measureExperiment`
// does not take a trigger at all, and `designExperiment` takes one only to
// add a clause to a sentence.
//
// Observed live: three behaviours at 7-of-28, 6-of-33 and 6-of-33, every one
// with a HIGH sample grade and present in both halves of the history, none of
// them measurable — their contexts came in at a corrected p of 0.31 and 0.43.
// The evidence for WHERE they happen is genuinely weak. The evidence THAT
// they happen is not, and that is all a window needs.
//
// The other half of these tests matters as much: nothing the system SAYS may
// get stronger. A behaviour confirmed under the new rule is still capped at
// reporting a count.

import { describe, it, expect } from 'vitest';
import { deriveStatus } from '../../app/lib/coach-pipeline/behavior/finding';
import {
  assessConfidence, explanationTier,
  CONFIRM_MIN_OCCURRENCES, CONFIRM_MIN_OPPORTUNITIES,
} from '../../app/lib/coach-pipeline/behavior/evidence';
import type { BehaviorTally } from '../../app/lib/coach-pipeline/behavior/behaviors';

/** `hits` marks which opportunities the behaviour occurred on, in order. */
const tally = (hits: readonly boolean[]): BehaviorTally => {
  const ids = hits.map((_, i) => `t${i}`);
  return {
    kind: 'size_spike',
    occurrences: hits.filter(Boolean).length,
    opportunities: hits.length,
    rate: hits.filter(Boolean).length / hits.length,
    opportunityTradeIds: ids,
    events: ids.filter((_, i) => hits[i]).map(id => ({
      kind: 'size_spike', tradeId: id, date: '2026-08-10', evidence: {},
    })),
  } as BehaviorTally;
};

/** n opportunities with `k` hits spread evenly across the whole history. */
const spread = (n: number, k: number) =>
  tally(Array.from({ length: n }, (_, i) => i % Math.floor(n / k) === 0 && i < (n / k) * k));

/** k hits crammed into the opening of the history and never again. */
const burst = (n: number, k: number) =>
  tally(Array.from({ length: n }, (_, i) => i < k));

const statusOf = (t: BehaviorTally) =>
  deriveStatus(t, assessConfidence({ tally: t, trigger: null }));

describe('a behaviour with no trigger at all', () => {
  const t = spread(28, 7);

  it('has a sample the system is confident in', () => {
    const a = assessConfidence({ tally: t, trigger: null });
    expect(a.factors.sample.passes).toBe('high');
    expect(a.factors.consistency.passes).toBe(true);
  });

  it('has low confidence, because nothing explains it', () => {
    expect(assessConfidence({ tally: t, trigger: null }).level).toBe('low');
  });

  it('is confirmed anyway — countable is enough to measure', () => {
    // THE CHANGE. This returned 'investigating' and the loop never started.
    expect(statusOf(t)).toBe('confirmed');
  });

  it('still may not be explained', () => {
    // The half that must not move. A low-confidence finding is capped at the
    // bare observation, whatever its status.
    expect(explanationTier('low')).toBe('unknown');
  });
});

describe('what still holds a behaviour back', () => {
  it('too few occurrences', () => {
    expect(statusOf(spread(30, CONFIRM_MIN_OCCURRENCES - 1))).not.toBe('confirmed');
  });

  it('too few opportunities', () => {
    expect(statusOf(spread(CONFIRM_MIN_OPPORTUNITIES - 1, 6))).not.toBe('confirmed');
  });

  it('a burst that never recurred', () => {
    // Consistency stays, and it is the factor that speaks to whether there is
    // a standing habit here at all. Six in one bad fortnight and never again
    // is not worth a ten-trade window.
    const t = burst(33, 6);
    expect(assessConfidence({ tally: t, trigger: null }).factors.consistency.passes).toBe(false);
    expect(statusOf(t)).toBe('investigating');
  });
});

describe('the live journal that prompted this', () => {
  // The three that sat blocked, by their real counts.
  const cases: Array<[string, number, number]> = [
    ['size_spike', 28, 7],
    ['rule_violation', 33, 6],
    ['stop_widened', 33, 6],
  ];

  for (const [name, opportunities, occurrences] of cases) {
    it(`${name} — ${occurrences} of ${opportunities} — becomes measurable`, () => {
      expect(statusOf(spread(opportunities, occurrences))).toBe('confirmed');
    });
  }
});

describe('a running window is still never recounted away', () => {
  const t = spread(28, 7);
  const a = assessConfidence({ tally: t, trigger: null });

  it('holds every in-flight status', () => {
    for (const s of ['experiment', 'monitoring', 'improved', 'resolved', 'archived'] as const) {
      expect(deriveStatus(t, a, s)).toBe(s);
    }
  });
});
