// ─────────────────────────────────────────────────────────────────────────────
// The cross-run state machine.
//
// Everything else in the behaviour layer is a pure function of the trades, so
// a wrong answer shows up as a wrong number. This file is different: it decides
// what the system BELIEVES over time, and its failures are all silent ones —
// an experiment that never gets judged, a question re-asked every morning, a
// relapse recorded as a discovery, a "first detected" date that quietly resets
// to today on every nightly run.
//
// None of those throw. They just make the product wrong in a way that reads
// like it is working.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  reconcile, familiesFor, watchedGuardrails,
  RECHECK_WINDOW, RELAPSE_TOLERANCE,
  type StoredFinding, type ReconcileInput,
} from '../../app/lib/coach-pipeline/behavior/memory';
import { computeGuardrails, pairGuardrails } from '../../app/lib/coach-pipeline/behavior/guardrails';
import { EXPERIMENT_WINDOW } from '../../app/lib/coach-pipeline/behavior/experiment';
import type { BehaviorFinding, Baselines } from '../../app/lib/coach-pipeline/behavior/finding';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

// ── fixtures ────────────────────────────────────────────────────────────────

const T0 = '2026-08-01T06:00:00.000Z';
const T1 = '2026-08-10T06:00:00.000Z';

const baselines = (o: Partial<Baselines> = {}): Baselines => ({
  historicalRate: 0.5, historicalN: 20, rollingRate: 0.5, rollingN: 20, ...o,
});

function fresh(o: Partial<BehaviorFinding> = {}): BehaviorFinding {
  return {
    kind: 'rule_violation', label: 'סטייה מהחוקים',
    status: 'confirmed', contrast: 'present',
    occurrences: 8, opportunities: 16, rate: 0.5,
    baselines: baselines(),
    trigger: null, confidence: 'medium',
    assessment: {
      level: 'medium',
      factors: {
        sample: { opportunities: 16, occurrences: 8, passes: 'high' },
        effect: { strength: 'moderate', lift: 0.4, passes: 'medium' },
        independence: { families: ['trade_telemetry'], count: 1 },
        consistency: { windows: 2, occurrencesPerWindow: [4, 4], passes: true },
      },
      limitedBy: ['independence'],
    },
    statements: [], question: 'למה?',
    priorityScore: 4, costPerOccurrenceR: -0.8,
    ...o,
  };
}

const READINGS = { trade_frequency: 3, avg_loss_r: -1, logging_rate: 1, rule_adherence: 0.7 };

function input(o: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    stored: null,
    fresh: fresh(),
    guardrailsNow:      { ...READINGS },
    guardrailsTrailing: { ...READINGS },
    isPrimary: false,
    now: T1,
    ...o,
  };
}

/** Run reconcile once and hand back the record, for chaining runs. */
function step(o: Partial<ReconcileInput> = {}) {
  return reconcile(input(o));
}

// ── first sighting ──────────────────────────────────────────────────────────

describe('first sighting', () => {
  it('creates the record and stamps when it was first seen', () => {
    const { record, transition } = step({ fresh: fresh({ status: 'detected' }) });
    expect(record.firstDetectedAt).toBe(T1);
    expect(record.status).toBe('detected');
    expect(record.relapses).toBe(0);
    expect(transition).toEqual({ from: null, to: 'detected', reason: 'נצפה לראשונה' });
  });

  it('does not open an experiment on the first run, even when confirmed and primary', () => {
    // A window opened against a baseline computed in the same instant has no
    // "before" — it would be measuring the behaviour against itself.
    const { record } = step({ fresh: fresh({ status: 'confirmed' }), isPrimary: true });
    expect(record.status).toBe('confirmed');
    expect(record.experiment).toBeNull();
  });
});

// ── the thing that must never happen ────────────────────────────────────────

describe('first_detected_at', () => {
  it('survives every subsequent run', () => {
    const stored = step().record;
    const later  = reconcile(input({ stored, now: '2026-09-01T06:00:00.000Z' })).record;
    expect(later.firstDetectedAt).toBe(T1);
    expect(later.lastSeenAt).toBe('2026-09-01T06:00:00.000Z');
  });
});

// ── the question ────────────────────────────────────────────────────────────

describe('the open question', () => {
  const asked: StoredFinding = { ...step().record, questionAskedAt: T0 };

  it('is not re-asked while the question is the same', () => {
    const { record } = reconcile(input({ stored: asked }));
    expect(record.questionAskedAt).toBe(T0);
  });

  it('keeps the answer once given', () => {
    const answered = { ...asked, traderAnswer: 'הייתי לחוץ', traderAnsweredAt: T0 };
    const { record } = reconcile(input({ stored: answered }));
    expect(record.traderAnswer).toBe('הייתי לחוץ');
  });

  it('drops the old answer when the question itself changes', () => {
    const answered = { ...asked, traderAnswer: 'הייתי לחוץ', traderAnsweredAt: T0 };
    const { record } = reconcile(input({ stored: answered, fresh: fresh({ question: 'שאלה אחרת' }) }));
    expect(record.question).toBe('שאלה אחרת');
    expect(record.traderAnswer).toBeNull();
  });

  it('counts only an ANSWERED question as a second evidence family', () => {
    expect(familiesFor(asked)).toEqual([]);
    expect(familiesFor({ ...asked, traderAnswer: 'כי כן' })).toEqual(['trader_answer']);
  });
});

// ── experiments ─────────────────────────────────────────────────────────────

describe('opening an experiment', () => {
  const confirmed = step({ fresh: fresh({ status: 'confirmed' }) }).record;

  it('opens on the primary and snapshots the world as it stands', () => {
    const { record, transition } = reconcile(input({ stored: confirmed, isPrimary: true }));
    expect(record.status).toBe('experiment');
    expect(transition?.to).toBe('experiment');
    // The window lives in the field, not in the prose — the sentence spells it
    // in words now that it reads as a measurement rather than an order.
    expect(record.experiment?.windowTrades).toBe(EXPERIMENT_WINDOW);
    expect(record.experiment?.instruction).toContain('נעקוב');
    expect(record.experimentBaseline?.opportunitiesAtStart).toBe(16);
    expect(record.experimentBaseline?.occurrencesAtStart).toBe(8);
    expect(record.experimentBaseline?.guardrails).toEqual(READINGS);
  });

  it('does not open on a behaviour that is not being worked on', () => {
    const { record } = reconcile(input({ stored: confirmed, isPrimary: false }));
    expect(record.status).toBe('confirmed');
    expect(record.experiment).toBeNull();
  });

  it('does not open on a behaviour with no counter-example', () => {
    const { record } = reconcile(input({
      stored: confirmed, isPrimary: true,
      fresh: fresh({ status: 'confirmed', contrast: 'always' }),
    }));
    expect(record.experiment).toBeNull();
  });
});

describe('a running experiment', () => {
  const running = reconcile(input({
    stored: step({ fresh: fresh({ status: 'confirmed' }) }).record,
    isPrimary: true,
  })).record;

  it('holds while the window is still filling', () => {
    const { record, measured } = reconcile(input({
      stored: running, isPrimary: true,
      fresh: fresh({ occurrences: 9, opportunities: 20 }),   // 4 of 10
    }));
    expect(record.status).toBe('experiment');
    expect(measured).toBeNull();
    expect(record.statusSince).toBe(running.statusSince);
  });

  it('is not dragged back to investigating by a new occurrence mid-window', () => {
    const { record } = reconcile(input({
      stored: running, isPrimary: true,
      fresh: fresh({ status: 'investigating', occurrences: 9, opportunities: 18 }),
    }));
    expect(record.status).toBe('experiment');
  });

  it('declares improved when the target fell on both baselines and nothing broke', () => {
    const { record, measured } = reconcile(input({
      stored: running, isPrimary: true,
      // 1 occurrence in 10 new opportunities = 0.10, against 0.50 before.
      fresh: fresh({ occurrences: 9, opportunities: 26, baselines: baselines({ rollingRate: 0.1 }) }),
    }));
    expect(measured?.verdict).toBe('improved');
    expect(record.status).toBe('improved');
    expect(record.experimentResult?.targetAfter).toBe(0.1);
  });

  it('refuses to call it improved when a guardrail broke', () => {
    const { record, measured } = reconcile(input({
      stored: running, isPrimary: true,
      fresh: fresh({ occurrences: 9, opportunities: 26 }),
      // They stopped trading: frequency 3 → 1.
      guardrailsNow: { ...READINGS, trade_frequency: 1 },
    }));
    expect(measured?.verdict).toBe('traded_one_problem_for_another');
    expect(measured?.broken).toContain('trade_frequency');
    expect(record.status).toBe('monitoring');
  });

  it('returns to confirmed when nothing moved', () => {
    const { record, measured } = reconcile(input({
      stored: running, isPrimary: true,
      // 5 occurrences in 10 new opportunities — same rate as before.
      fresh: fresh({ occurrences: 13, opportunities: 26 }),
    }));
    expect(measured?.verdict).toBe('unchanged');
    expect(record.status).toBe('confirmed');
  });
});

// ── after the experiment ────────────────────────────────────────────────────

describe('improved → resolved, or back again', () => {
  const improved: StoredFinding = {
    ...step().record,
    status: 'improved',
    occurrences: 9, opportunities: 26,
    experimentBaseline: {
      before: baselines(),
      occurrencesAtStart: 8, opportunitiesAtStart: 16,
      guardrails: { ...READINGS },
    },
    experimentResult: {
      verdict: 'improved', targetBefore: 0.5, targetAfter: 0.1, delta: -0.4,
      historicalImproved: true, rollingImproved: true, guardrails: [], broken: [],
    },
  };

  it('resolves once it has held for the re-check window', () => {
    const { record } = reconcile(input({
      stored: improved,
      fresh: fresh({
        occurrences: 10,
        opportunities: 16 + EXPERIMENT_WINDOW + RECHECK_WINDOW,
        baselines: baselines({ rollingRate: 0.1 }),
      }),
    }));
    expect(record.status).toBe('resolved');
  });

  it('stays in improved while the re-check window is still filling', () => {
    const { record } = reconcile(input({
      stored: improved,
      fresh: fresh({ occurrences: 9, opportunities: 30, baselines: baselines({ rollingRate: 0.1 }) }),
    }));
    expect(record.status).toBe('improved');
  });

  it('counts a relapse instead of quietly resolving it', () => {
    const { record, transition } = reconcile(input({
      stored: improved,
      fresh: fresh({
        occurrences: 16, opportunities: 36,
        baselines: baselines({ rollingRate: 0.1 + RELAPSE_TOLERANCE + 0.05 }),
      }),
    }));
    expect(record.status).toBe('confirmed');
    expect(record.relapses).toBe(1);
    expect(transition?.reason).toContain('חזרה');
    // The old window is cleared — the next experiment needs its own baseline.
    expect(record.experimentBaseline).toBeNull();
  });
});

describe('monitoring — the state that must not be a dead end', () => {
  // Reached by cutting trading in half to make the target fall.
  const monitoring: StoredFinding = {
    ...step().record,
    status: 'monitoring',
    occurrences: 9, opportunities: 26,
    experiment: {
      kind: 'rule_violation', instruction: '...', windowTrades: EXPERIMENT_WINDOW,
      targetFrom: 0.5, guardrails: ['trade_frequency', 'rule_adherence'],
    },
    experimentBaseline: {
      before: baselines(),
      occurrencesAtStart: 8, opportunitiesAtStart: 16,
      guardrails: { ...READINGS },
    },
    experimentResult: {
      verdict: 'traded_one_problem_for_another', targetBefore: 0.5, targetAfter: 0.1,
      delta: -0.4, historicalImproved: true, rollingImproved: true,
      guardrails: [], broken: ['trade_frequency'],
    },
  };

  it('becomes improved once the guardrail recovers and the target is still down', () => {
    const { record, measured } = reconcile(input({
      stored: monitoring,
      fresh: fresh({ occurrences: 9, opportunities: 30 }),
      guardrailsNow: { ...READINGS },              // frequency back to normal
    }));
    expect(measured?.broken).toEqual([]);
    expect(record.status).toBe('improved');
  });

  it('stays in monitoring while the guardrail is still broken', () => {
    const { record } = reconcile(input({
      stored: monitoring,
      fresh: fresh({ occurrences: 9, opportunities: 30 }),
      guardrailsNow: { ...READINGS, trade_frequency: 1 },
    }));
    expect(record.status).toBe('monitoring');
  });

  it('goes back to confirmed when the target climbs back', () => {
    const { record } = reconcile(input({
      stored: monitoring,
      // 7 occurrences over 14 new opportunities — back to the old rate.
      fresh: fresh({ occurrences: 15, opportunities: 30 }),
      guardrailsNow: { ...READINGS },
    }));
    expect(record.status).toBe('confirmed');
    expect(record.experimentBaseline).toBeNull();
  });
});

describe('resolved', () => {
  const resolved: StoredFinding = {
    ...step().record,
    status: 'resolved', occurrences: 9, opportunities: 40,
    experimentResult: {
      verdict: 'improved', targetBefore: 0.5, targetAfter: 0.1, delta: -0.4,
      historicalImproved: true, rollingImproved: true, guardrails: [], broken: [],
    },
  };

  it('stays resolved while the behaviour stays away', () => {
    const { record } = reconcile(input({
      stored: resolved,
      fresh: fresh({ occurrences: 9, opportunities: 44, baselines: baselines({ rollingRate: 0.05 }) }),
    }));
    expect(record.status).toBe('resolved');
  });

  it('reopens as a relapse when it comes back', () => {
    const { record } = reconcile(input({
      stored: resolved,
      fresh: fresh({ occurrences: 14, opportunities: 48, baselines: baselines({ rollingRate: 0.6 }) }),
    }));
    expect(record.status).toBe('confirmed');
    expect(record.relapses).toBe(1);
  });
});

// ── guardrail readings ──────────────────────────────────────────────────────

let seq = 0;
function trade(o: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    clerk_id: 'u', id: `g${seq}`,
    created_at: T0, updated_at: T0, deleted_at: null,
    date: '2026-08-01', time: '10:00', symbol: 'NQ', direction: 'LONG', contracts: 1,
    entry_price: 100, stop_loss: 90, take_profit: 130, exit_price: 130, exits: null,
    rr_planned: 3, r_multiple: 3, pnl_usd: 300, result: 'WIN',
    session: 'london', bias: null, setup: null, confirmations: null,
    emotional_state: null, followed_rules: true, stop_moved: null, management: null, notes: '', tags: [], screenshots: null,
    profile_processed_at: null, profile_processed_rev: 0,
    ...o,
  };
}

describe('guardrail readings', () => {
  it('measures trades per active day, not raw count', () => {
    const g = computeGuardrails([
      trade({ date: '2026-08-01' }), trade({ date: '2026-08-01' }),
      trade({ date: '2026-08-02' }), trade({ date: '2026-08-02' }),
    ]);
    expect(g.trade_frequency).toBe(2);
  });

  it('averages only the losses, and only measured ones', () => {
    const g = computeGuardrails([
      trade({ result: 'LOSS', r_multiple: -1 }),
      trade({ result: 'LOSS', r_multiple: -3 }),
      trade({ result: 'LOSS', r_multiple: null }),   // assumed, not measured
      trade({ result: 'WIN',  r_multiple: 2 }),
    ]);
    expect(g.avg_loss_r).toBe(-2);
  });

  it('reads logging completeness from the exit price', () => {
    const g = computeGuardrails([
      trade({ exit_price: 130 }), trade({ exit_price: null }),
      trade({ exit_price: 120 }), trade({ exit_price: null }),
    ]);
    expect(g.logging_rate).toBe(0.5);
  });

  it('excludes ungraded trades from rule adherence rather than counting them as clean', () => {
    const g = computeGuardrails([
      trade({ followed_rules: true }), trade({ followed_rules: false }),
      trade({ followed_rules: null }), trade({ followed_rules: null }),
    ]);
    expect(g.rule_adherence).toBe(0.5);
  });

  it('ignores open and deleted trades everywhere', () => {
    const g = computeGuardrails([
      trade({ result: 'OPEN' }),
      trade({ deleted_at: T0 }),
      trade({ result: 'WIN', exit_price: 130 }),
    ]);
    expect(g.trade_frequency).toBe(1);
    expect(g.logging_rate).toBe(1);
  });

  it('pairs only the guardrails the experiment declared', () => {
    const pairs = pairGuardrails(['trade_frequency', 'logging_rate'], READINGS, { ...READINGS, logging_rate: 0.4 });
    expect(pairs).toHaveLength(2);
    expect(pairs.find(p => p.kind === 'logging_rate')).toEqual({ kind: 'logging_rate', before: 1, after: 0.4 });
  });

  it('reports no watched guardrails when no experiment is running', () => {
    expect(watchedGuardrails(null)).toEqual([]);
    expect(watchedGuardrails(step().record)).toEqual([]);
  });
});
