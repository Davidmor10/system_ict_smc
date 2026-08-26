// What happens after a window closes without moving anything.
//
// THE LOOP THIS CLOSES
//
// A verdict of `unchanged` returned the finding to `confirmed` and left its
// experiment and baseline in place. The next run fell straight back into the
// open-a-window branch and started an identical experiment the same morning,
// with nothing anywhere saying the last one had ended.
//
// Severity then kept it there. The single primary slot goes to the
// highest-scoring confirmed finding, and a behaviour that is not improving
// keeps its score — so the behaviour LEAST likely to release the slot was
// guaranteed to hold it, and no other behaviour would ever get a turn.
//
// Two halves to the fix and both are needed: the window has to actually close,
// and the slot has to rotate. Closing it alone changes nothing, because the
// same finding wins the next ranking and reopens.

import { describe, it, expect } from 'vitest';
import { reconcile, alreadyMeasured, type StoredFinding } from '../../app/lib/coach-pipeline/behavior/memory';
import { pickPrimary, type BehaviorFinding, type Baselines } from '../../app/lib/coach-pipeline/behavior/finding';
import { EXPERIMENT_WINDOW } from '../../app/lib/coach-pipeline/behavior/experiment';
import type { BehaviorKind } from '../../app/lib/coach-pipeline/behavior/behaviors';
import type { GuardrailReadings } from '../../app/lib/coach-pipeline/behavior/guardrails';

const NOW = '2026-09-01T04:00:00.000Z';

const baselines = (rate: number): Baselines => ({
  historicalRate: rate, historicalN: 40, rollingRate: rate, rollingN: 20,
});

/** A finding as the run recomputes it from trades. */
const fresh = (over: Partial<BehaviorFinding> = {}): BehaviorFinding => ({
  kind: 'discretionary_exit', label: 'x', status: 'confirmed', contrast: 'present',
  occurrences: 12, opportunities: 40, rate: 0.3, baselines: baselines(0.3),
  trigger: null, confidence: 'medium', assessment: {} as never,
  statements: [], question: null, priorityScore: 10, costPerOccurrenceR: null,
  ...over,
} as BehaviorFinding);

/** A finding mid-window, as the database holds it. */
const running = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  kind: 'discretionary_exit', status: 'experiment',
  firstDetectedAt: '2026-08-01T04:00:00.000Z',
  statusSince: '2026-08-15T04:00:00.000Z',
  lastSeenAt: '2026-08-31T04:00:00.000Z',
  occurrences: 9, opportunities: 30, rate: 0.3, baselines: baselines(0.3),
  confidence: 'medium',
  question: null, questionAskedAt: null, traderAnswer: null, traderAnsweredAt: null,
  experiment: {
    kind: 'discretionary_exit', instruction: 'x',
    windowTrades: EXPERIMENT_WINDOW, targetFrom: 0.3, guardrails: [],
  },
  experimentStartedAt: '2026-08-15T04:00:00.000Z',
  experimentBaseline: {
    before: baselines(0.3),
    occurrencesAtStart: 6, opportunitiesAtStart: 20,
    guardrails: FLAT,
  },
  experimentResult: null,
  relapses: 0, isPrimary: true, primarySince: '2026-08-15T04:00:00.000Z',
  ...over,
} as StoredFinding);

/** Every guardrail steady. The experiment under test has no guardrails
 *  declared, so these readings are carried and never compared — what matters
 *  is that they are a complete set, as the type requires. */
const FLAT: GuardrailReadings = {
  trade_frequency: 1, avg_loss_r: -1, logging_rate: 1, rule_adherence: 1,
};
const noGuardrails = { guardrailsNow: FLAT, guardrailsTrailing: FLAT } as const;

/** Close the window on a rate that did not move: 3 of 10 before, 3 of 10 after. */
const closeUnchanged = () => reconcile({
  stored: running(),
  fresh: fresh({ occurrences: 9, opportunities: 30 }),
  ...noGuardrails, isPrimary: true, now: NOW,
});

describe('a window that ended without moving anything', () => {
  it('is judged unchanged', () => {
    expect(closeUnchanged().measured?.verdict).toBe('unchanged');
  });

  it('returns the finding to confirmed', () => {
    expect(closeUnchanged().record.status).toBe('confirmed');
  });

  it('clears the experiment, so it cannot silently run on', () => {
    // THE REGRESSION. Left in place, the next run reopens an identical
    // experiment the same morning and the trader is never told the last one
    // ended.
    const { record } = closeUnchanged();
    expect(record.experiment).toBeNull();
    expect(record.experimentBaseline).toBeNull();
    expect(record.experimentStartedAt).toBeNull();
  });

  it('keeps the result, because a window that ran is a fact', () => {
    // It is what the tracking archive reads, and it is how the next run knows
    // this behaviour has already had its turn.
    expect(closeUnchanged().record.experimentResult?.verdict).toBe('unchanged');
  });

  it('records the transition so the timeline shows the window closing', () => {
    expect(closeUnchanged().transition).toMatchObject({ from: 'experiment', to: 'confirmed' });
  });
});

describe('an improvement is left alone', () => {
  const closeImproved = () => reconcile({
    // 6 of 20 before, 0 of 10 in the window.
    stored: running(),
    fresh: fresh({ occurrences: 6, opportunities: 30, baselines: baselines(0) }),
    ...noGuardrails, isPrimary: true, now: NOW,
  });

  it('is judged improved', () => {
    expect(closeImproved().measured?.verdict).toBe('improved');
  });

  it('keeps its baseline, because the re-check measures against it', () => {
    // `improved` waits to see whether it holds, and the wait is counted from
    // the same baseline. Clearing it here would strand the finding.
    const { record } = closeImproved();
    expect(record.status).toBe('improved');
    expect(record.experimentBaseline).not.toBeNull();
  });
});

describe('the slot rotates', () => {
  const measuredSet = (...kinds: BehaviorKind[]) => new Set(kinds);

  it('hands the slot to a behaviour that has not had a turn', () => {
    // THE OTHER HALF. Closing the window is not enough — the finding is still
    // the highest-scoring confirmed one, so severity alone gives it straight
    // back.
    const findings = [
      fresh({ kind: 'discretionary_exit', priorityScore: 10 }),
      fresh({ kind: 'size_spike', priorityScore: 4 }),
    ];
    const { primary } = pickPrimary(findings, 'discretionary_exit', measuredSet('discretionary_exit'));
    expect(primary?.kind).toBe('size_spike');
  });

  it('does not let the margin rule hand it back', () => {
    // The incumbent's grip survives a close score. It must not survive having
    // just spent a window.
    const findings = [
      fresh({ kind: 'discretionary_exit', priorityScore: 100 }),
      fresh({ kind: 'size_spike', priorityScore: 1 }),
    ];
    const { primary } = pickPrimary(findings, 'discretionary_exit', measuredSet('discretionary_exit'));
    expect(primary?.kind).toBe('size_spike');
  });

  it('still ranks readiness above whose turn it is', () => {
    // A measured finding that can start today beats an unmeasured one that
    // cannot. Only `confirmed` opens a window.
    const findings = [
      fresh({ kind: 'discretionary_exit', status: 'confirmed', priorityScore: 1 }),
      fresh({ kind: 'size_spike', status: 'investigating', priorityScore: 99 }),
    ];
    const { primary } = pickPrimary(findings, undefined, measuredSet('discretionary_exit'));
    expect(primary?.kind).toBe('discretionary_exit');
  });

  it('comes back around when everything has had a turn', () => {
    // Not abandoned — re-testing after another behaviour's window is a
    // different measurement, taken over different trades.
    const findings = [
      fresh({ kind: 'discretionary_exit', priorityScore: 10 }),
      fresh({ kind: 'size_spike', priorityScore: 4 }),
    ];
    const { primary } = pickPrimary(findings, 'size_spike', measuredSet('discretionary_exit', 'size_spike'));
    expect(primary?.kind).toBe('discretionary_exit');
  });

  it('never interrupts a window that is still running', () => {
    const findings = [
      fresh({ kind: 'discretionary_exit', status: 'experiment', priorityScore: 1 }),
      fresh({ kind: 'size_spike', status: 'confirmed', priorityScore: 99 }),
    ];
    const { primary } = pickPrimary(findings, 'discretionary_exit', measuredSet());
    expect(primary?.kind).toBe('discretionary_exit');
  });

  it('ranks by severity as before when nobody has been measured', () => {
    const findings = [
      fresh({ kind: 'size_spike', priorityScore: 4 }),
      fresh({ kind: 'discretionary_exit', priorityScore: 10 }),
    ];
    expect(pickPrimary(findings).primary?.kind).toBe('discretionary_exit');
  });
});

describe('alreadyMeasured', () => {
  it('lists a finding whose window has closed', () => {
    const closed = closeUnchanged().record;
    expect([...alreadyMeasured([closed])]).toEqual(['discretionary_exit']);
  });

  it('does not list one whose window is still open', () => {
    expect(alreadyMeasured([running()]).size).toBe(0);
  });

  it('stops listing it once a new window opens', () => {
    // Self-clearing: opening a window sets experimentResult back to null, so a
    // finding counts as having had its turn only between one window ending and
    // the next beginning.
    const reopened = reconcile({
      stored: { ...closeUnchanged().record, isPrimary: true },
      fresh: fresh({ status: 'confirmed' }),
      ...noGuardrails, isPrimary: true, now: NOW,
    }).record;
    expect(reopened.status).toBe('experiment');
    expect(alreadyMeasured([reopened]).size).toBe(0);
  });
});
