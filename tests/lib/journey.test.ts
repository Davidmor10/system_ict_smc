// The journey screen's arithmetic.
//
// The learning-score curve that this file was originally written for is gone —
// it shipped and was pulled a day later, because it could not say WHICH habit
// moved, only that a number had. Its tests went with it; the engine keeps its
// own in intelligence.scores.test.ts.
//
// What is left is the part that decides what the trader sees: which of the
// three parts of the screen a behaviour belongs to, and how they are counted.
// One rule in here is load-bearing — a relapse is never folded into the
// success count.

import { describe, expect, it } from 'vitest';
import {
  countJourney, stageOf, journeyIsEmpty,
  STATUS_LABELS, STATUS_ORDER, VERDICT_LABELS,
} from '../../app/lib/progress/journey';

describe('which part of the screen a behaviour belongs to', () => {
  it('puts an open window under what I am working on', () => {
    expect(stageOf('experiment')).toBe('working');
    expect(stageOf('monitoring')).toBe('working');
  });

  it('puts a finished one under what I already changed', () => {
    expect(stageOf('improved')).toBe('changed');
    expect(stageOf('resolved')).toBe('changed');
  });

  it('puts everything earlier under what is being watched', () => {
    expect(stageOf('detected')).toBe('watching');
    expect(stageOf('investigating')).toBe('watching');
    expect(stageOf('confirmed')).toBe('watching');
  });
});

describe('the three numbers', () => {
  it('counts each behaviour into exactly one part', () => {
    const c = countJourney([
      { status: 'experiment' }, { status: 'resolved' }, { status: 'improved' },
      { status: 'detected' }, { status: 'confirmed' },
    ]);
    expect(c).toEqual({ working: 1, changed: 2, watching: 2, relapsed: 0 });
  });

  // Not in any of the three parts: it is a way out of the process.
  it('leaves an archived behaviour out of every count', () => {
    expect(countJourney([{ status: 'archived' }])).toEqual({ working: 0, changed: 0, watching: 0, relapsed: 0 });
  });

  // The one thing that would make this screen dishonest is a relapse counted
  // as a success, so it is counted alongside and never inside.
  it('counts a relapse separately from the behaviour’s own stage', () => {
    const c = countJourney([{ status: 'resolved', relapses: 2 }]);
    expect(c.changed).toBe(1);
    expect(c.relapsed).toBe(1);
  });

  it('is all zeroes for an account with nothing detected', () => {
    expect(countJourney([])).toEqual({ working: 0, changed: 0, watching: 0, relapsed: 0 });
  });
});

describe('the empty state', () => {
  it('is empty only when no behaviour has been detected at all', () => {
    const none = { working: 0, changed: 0, watching: 0, relapsed: 0 };
    expect(journeyIsEmpty(none)).toBe(true);
    expect(journeyIsEmpty({ ...none, watching: 1 })).toBe(false);
    expect(journeyIsEmpty({ ...none, changed: 1 })).toBe(false);
  });
});

describe('the labels', () => {
  it('names every step of the lifecycle', () => {
    for (const s of STATUS_ORDER) expect(STATUS_LABELS[s]).toBeTruthy();
    expect(STATUS_LABELS.archived).toBeTruthy();
  });

  it('does not draw archived as a step in the process', () => {
    expect(STATUS_ORDER).not.toContain('archived');
  });

  // The guardrails exist to catch exactly this verdict. Softening it here
  // would waste the mechanism that produced it.
  it('says plainly when one problem was traded for another', () => {
    expect(VERDICT_LABELS.traded_one_problem_for_another).toBe('הוחלפה בעיה באחרת');
  });

  it('never calls an unfinished window a result', () => {
    expect(VERDICT_LABELS.insufficient_data).not.toContain('שיפור');
    expect(VERDICT_LABELS.unchanged).not.toContain('שיפור');
  });
});
