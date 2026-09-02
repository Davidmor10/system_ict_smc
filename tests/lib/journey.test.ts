// The journey screen's arithmetic.
//
// The learning score is the reason this file exists. It returns exactly 50
// when it has fewer than two snapshots to compare against — a placeholder that
// its own docstring says must be read as "cannot say yet". Plotted without
// being identified, it is a flat line at the midpoint: months of standing
// still, shown to a trader who has simply not been measured yet.

import { describe, expect, it } from 'vitest';
import {
  learningTrajectory, edgeTrajectory, countJourney, stageOf, journeyIsEmpty,
  STATUS_LABELS, STATUS_ORDER, VERDICT_LABELS,
} from '../../app/lib/progress/journey';
import type { ScoreSnapshot } from '../../app/lib/intelligence/types';

const snap = (at: string, learningScore: number, edgeScore: number): ScoreSnapshot => ({
  at, learningScore, edgeScore, winRate: 0.5, avgRR: 1.2, profitFactor: 1.4,
});

describe('the learning trajectory', () => {
  // The engine appends a snapshot every run and computes that run's learning
  // score from the runs BEFORE it, so the first two are always the placeholder.
  it('drops the two placeholder snapshots at the head', () => {
    const t = learningTrajectory([
      snap('2026-01-01', 50, 40),
      snap('2026-01-08', 50, 44),
      snap('2026-01-15', 61, 48),
      snap('2026-01-22', 67, 52),
    ]);
    expect(t.points.map(p => p.learning)).toEqual([61, 67]);
  });

  it('says it cannot tell yet rather than drawing a flat 50', () => {
    expect(learningTrajectory([]).known).toBe(false);
    expect(learningTrajectory([snap('2026-01-01', 50, 40)]).known).toBe(false);
    expect(learningTrajectory([snap('2026-01-01', 50, 40), snap('2026-01-08', 50, 44)]).known).toBe(false);
  });

  it('reports no score at all while it cannot tell', () => {
    const t = learningTrajectory([snap('2026-01-01', 50, 40), snap('2026-01-08', 50, 44)]);
    expect(t.points).toEqual([]);
    expect(t.latest).toBeNull();
    expect(t.delta).toBeNull();
  });

  it('becomes known on the third snapshot, which is the first real one', () => {
    const t = learningTrajectory([snap('a', 50, 40), snap('b', 50, 44), snap('c', 58, 48)]);
    expect(t.known).toBe(true);
    expect(t.latest).toBe(58);
  });

  // One point is a position, not a direction, and an arrow drawn from it would
  // be an invention.
  it('reports no movement from a single real point', () => {
    expect(learningTrajectory([snap('a', 50, 40), snap('b', 50, 44), snap('c', 58, 48)]).delta).toBeNull();
  });

  it('measures movement across the real points only', () => {
    const t = learningTrajectory([
      snap('a', 50, 40), snap('b', 50, 44), snap('c', 58, 48), snap('d', 71, 55),
    ]);
    expect(t.delta).toBe(13);
  });

  it('reports a decline as a decline', () => {
    const t = learningTrajectory([snap('a', 50, 40), snap('b', 50, 44), snap('c', 66, 48), snap('d', 41, 39)]);
    expect(t.delta).toBe(-25);
  });

  it('survives a missing history rather than throwing on a new account', () => {
    expect(learningTrajectory(null).known).toBe(false);
    expect(learningTrajectory(undefined).points).toEqual([]);
  });
});

describe('the edge trajectory', () => {
  // Smoothed against its own previous value rather than computed from a
  // history, so there is no placeholder head to remove.
  it('keeps every snapshot', () => {
    const points = edgeTrajectory([snap('a', 50, 40), snap('b', 50, 44), snap('c', 58, 48)]);
    expect(points.map(p => p.edge)).toEqual([40, 44, 48]);
  });
});

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
  it('is empty only when there is neither a behaviour nor a measurable history', () => {
    const none = { working: 0, changed: 0, watching: 0, relapsed: 0 };
    expect(journeyIsEmpty(none, learningTrajectory([]))).toBe(true);
    expect(journeyIsEmpty({ ...none, watching: 1 }, learningTrajectory([]))).toBe(false);
    expect(journeyIsEmpty(none, learningTrajectory([snap('a', 50, 1), snap('b', 50, 2), snap('c', 60, 3)]))).toBe(false);
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
