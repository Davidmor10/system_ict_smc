// ─────────────────────────────────────────────────────────────────────────────
// The weekly behaviour review.
//
// Its one failure mode is being interesting every week. A review that always
// finds seven things to report is a review nobody reads by the third week, and
// the standing state — "you still do this, it is still unclear" — is exactly
// what feels like content while being none.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  buildWeeklyReview, MOVEMENT_THRESHOLD,
  type ReviewEvent, type WeeklyReviewInput,
} from '../../app/lib/coach-pipeline/behavior/weekly';
import type { BehaviorFinding, Baselines } from '../../app/lib/coach-pipeline/behavior/finding';
import type { StoredFinding } from '../../app/lib/coach-pipeline/behavior/memory';
import type { BehaviorKind } from '../../app/lib/coach-pipeline/behavior/behaviors';

const FROM = '2026-08-06T00:00:00.000Z';
const TO   = '2026-08-13T00:00:00.000Z';

const baselines = (o: Partial<Baselines> = {}): Baselines =>
  ({ historicalRate: 0.5, historicalN: 20, rollingRate: 0.5, rollingN: 20, ...o });

function finding(kind: BehaviorKind, o: Partial<BehaviorFinding> = {}): BehaviorFinding {
  return {
    kind, label: `label:${kind}`, status: 'confirmed', contrast: 'present',
    occurrences: 8, opportunities: 16, rate: 0.5, baselines: baselines(),
    trigger: null, confidence: 'medium',
    assessment: { level: 'medium', factors: {
      sample: { opportunities: 16, occurrences: 8, passes: 'high' },
      effect: { strength: 'weak', lift: 0, passes: 'none' },
      independence: { families: ['trade_telemetry'], count: 1 },
      consistency: { windows: 2, occurrencesPerWindow: [4, 4], passes: true },
    }, limitedBy: [] },
    statements: [], question: null, priorityScore: 1, costPerOccurrenceR: null,
    ...o,
  };
}

function stored(kind: BehaviorKind, o: Partial<StoredFinding> = {}): StoredFinding {
  return {
    kind, status: 'confirmed',
    firstDetectedAt: FROM, statusSince: FROM, lastSeenAt: TO,
    occurrences: 8, opportunities: 16, rate: 0.5, baselines: baselines(),
    confidence: 'medium',
    question: null, questionAskedAt: null, traderAnswer: null, traderAnsweredAt: null,
    experiment: null, experimentStartedAt: null, experimentBaseline: null, experimentResult: null,
    relapses: 0, isPrimary: false, primarySince: null,
    ...o,
  };
}

const ev = (kind: string, to_status: string, from_status: string | null, at = '2026-08-10T09:00:00.000Z'): ReviewEvent =>
  ({ kind, at, from_status, to_status, reason: '' });

function input(o: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput {
  return {
    findings: [], stored: new Map(), events: [], primaryKind: null,
    from: FROM, to: TO, ...o,
  };
}

describe('a quiet week says so', () => {
  it('is quiet when nothing moved, nothing is running and nothing was asked', () => {
    const r = buildWeeklyReview(input({ findings: [finding('rule_violation')] }));
    expect(r.quiet).toBe(true);
  });

  // The standing state is not news. Reporting it weekly is how a review turns
  // into furniture.
  it('stays quiet when the only content is "still unclear"', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('size_spike', { status: 'detected', occurrences: 1, opportunities: 4 })],
    }));
    expect(r.stillUnclear).toHaveLength(1);
    expect(r.quiet).toBe(true);
  });
});

describe('what changed', () => {
  it('reports an improvement inside the window', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('discretionary_exit')],
      events: [ev('discretionary_exit', 'improved', 'experiment')],
    }));
    expect(r.improved.map(i => i.kind)).toEqual(['discretionary_exit']);
    expect(r.quiet).toBe(false);
  });

  it('ignores an event from before the window', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('discretionary_exit')],
      events: [ev('discretionary_exit', 'improved', 'experiment', '2026-07-01T09:00:00.000Z')],
    }));
    expect(r.improved).toHaveLength(0);
  });

  // A behaviour that came back is a different sentence to one just found, and
  // a purely forward-looking review would lose it.
  it('reports a relapse and how many times it has happened', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('rule_violation')],
      stored: new Map([['rule_violation', stored('rule_violation', { relapses: 2 })]]),
      events: [ev('rule_violation', 'confirmed', 'resolved')],
    }));
    expect(r.relapsed[0]).toMatchObject({ kind: 'rule_violation', times: 2 });
  });

  it('does not read an ordinary promotion to confirmed as a relapse', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('rule_violation')],
      events: [ev('rule_violation', 'confirmed', 'investigating')],
    }));
    expect(r.relapsed).toHaveLength(0);
  });
});

describe('experiments in flight', () => {
  it('reports how far through the window it is', () => {
    const s = stored('discretionary_exit', {
      status: 'experiment',
      experiment: { kind: 'discretionary_exit', instruction: 'צא רק ביעד או בסטופ', windowTrades: 10, targetFrom: 0.5, guardrails: [] },
      experimentBaseline: { before: baselines(), occurrencesAtStart: 8, opportunitiesAtStart: 16, guardrails: { trade_frequency: 3, avg_loss_r: -1, logging_rate: 1, rule_adherence: 1 } },
    });
    const r = buildWeeklyReview(input({
      findings: [finding('discretionary_exit', { opportunities: 22 })],
      stored: new Map([['discretionary_exit', s]]),
    }));
    expect(r.underTest[0]).toMatchObject({ done: 6, of: 10 });
    expect(r.quiet).toBe(false);
  });
});

describe('movement — you against you', () => {
  it('calls a falling rolling rate an improvement', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('rule_violation', {
        baselines: baselines({ historicalRate: 0.5, rollingRate: 0.5 - MOVEMENT_THRESHOLD }),
      })],
    }));
    expect(r.movement[0].direction).toBe('improving');
    expect(r.quiet).toBe(false);
  });

  it('calls a small difference steady rather than progress', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('rule_violation', {
        baselines: baselines({ historicalRate: 0.5, rollingRate: 0.45 }),
      })],
    }));
    expect(r.movement[0].direction).toBe('steady');
  });

  // Two readings of the same handful of trades is not a comparison.
  it('leaves out behaviours with too little history on either side', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('size_spike', {
        baselines: { historicalRate: 0.5, historicalN: 6, rollingRate: 0.2, rollingN: 4 },
      })],
    }));
    expect(r.movement).toHaveLength(0);
  });

  it('excludes a behaviour with no counter-example', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('no_confirmation', { contrast: 'always' })],
    }));
    expect(r.movement).toHaveLength(0);
  });
});

describe('questions and focus', () => {
  // The review used to carry the question TEXT and the panel printed every
  // one. The daily insight asks the same sentences — that is where they get
  // answered — so this screen repeated three near-identical lines already
  // sitting on another one. The count survives only because a week with an
  // unanswered question is not a quiet week.
  it('counts the unanswered questions and carries none of their text', () => {
    const s = new Map<BehaviorKind, StoredFinding>([
      ['rule_violation',    stored('rule_violation',    { question: 'מה קרה?' })],
      ['discretionary_exit', stored('discretionary_exit', { question: 'ומה שם?', traderAnswer: 'עניתי' })],
    ]);
    const r = buildWeeklyReview(input({ findings: [finding('rule_violation')], stored: s }));
    expect(r.openQuestionCount).toBe(1);
    expect(JSON.stringify(r)).not.toContain('מה קרה?');
  });

  it('does not call a week quiet while a question is waiting', () => {
    const s = new Map<BehaviorKind, StoredFinding>([
      ['rule_violation', stored('rule_violation', { question: 'מה קרה?' })],
    ]);
    expect(buildWeeklyReview(input({ findings: [], stored: s })).quiet).toBe(false);
  });

  it('names next week\'s focus from the primary', () => {
    const r = buildWeeklyReview(input({
      findings: [finding('size_spike')],
      primaryKind: 'size_spike',
    }));
    expect(r.focus).toMatchObject({ kind: 'size_spike', status: 'confirmed' });
  });

  it('has no focus when nothing is primary', () => {
    expect(buildWeeklyReview(input()).focus).toBeNull();
  });
});
