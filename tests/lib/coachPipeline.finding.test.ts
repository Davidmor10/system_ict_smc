import { describe, expect, it } from 'vitest';
import {
  buildFinding, buildStatements, buildQuestion, computeBaselines,
  deriveStatus, pickPrimary, ROLLING_WINDOW, PRIORITY_MARGIN,
  type BehaviorFinding,
} from '../../app/lib/coach-pipeline/behavior/finding';
import {
  assessConfidence, assessConsistency, explanationTier,
  CONFIRM_MIN_OCCURRENCES, CONFIRM_MIN_OPPORTUNITIES,
} from '../../app/lib/coach-pipeline/behavior/evidence';
import { detectBehaviors } from '../../app/lib/coach-pipeline/behavior/behaviors';
import { buildContexts } from '../../app/lib/coach-pipeline/behavior/context';
import {
  designExperiment, measureExperiment, guardrailDegraded,
  EXPERIMENT_WINDOW, IMPROVEMENT_THRESHOLD,
} from '../../app/lib/coach-pipeline/behavior/experiment';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    clerk_id: 'user_test', id: `f${seq}`,
    created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z', deleted_at: null,
    date: '2026-08-01', time: '10:00', symbol: 'NQ', direction: 'LONG', contracts: 1,
    entry_price: 20000, stop_loss: 19980, take_profit: 20040, exit_price: 20040, exits: null,
    rr_planned: 2, r_multiple: 2, pnl_usd: 100, result: 'WIN',
    session: 'london', bias: null, setup: 'REVERSAL', confirmations: ['SMT'],
    emotional_state: null, followed_rules: true, notes: '', tags: [], screenshots: null,
    profile_processed_at: null, profile_processed_rev: 0,
    ...overrides,
  };
}
const bad  = (o: Partial<TradeRow> = {}) => T({ followed_rules: false, ...o });
const good = (o: Partial<TradeRow> = {}) => T({ followed_rules: true,  ...o });

function tallyOf(trades: TradeRow[], kind = 'rule_violation') {
  return detectBehaviors(trades).find(t => t.kind === kind)!;
}
function findingOf(trades: TradeRow[], kind = 'rule_violation', opts = {}) {
  return buildFinding(tallyOf(trades, kind), buildContexts(trades), opts);
}

/** A strictly increasing timestamp per index, so chronological order in the
 *  fixture matches array order. Wrapping dates with a modulo silently
 *  reshuffles the history and makes the rolling window pick up the wrong
 *  trades — which is how this helper earned its own comment. */
function stamp(i: number): { date: string; time: string } {
  const day  = Math.floor(i / 8) + 1;                    // 8 trades per day
  const slot = i % 8;
  return {
    date: `2026-08-${String(day).padStart(2, '0')}`,
    time: `${String(9 + slot).padStart(2, '0')}:00`,
  };
}

/** n trades in chronological order, the first `k` of them violations. */
function history(n: number, k: number, o: Partial<TradeRow> = {}): TradeRow[] {
  return Array.from({ length: n }, (_, i) => (i < k ? bad : good)({ ...stamp(i), ...o }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle — three occurrences is not a confirmation
// ═══════════════════════════════════════════════════════════════════════════

describe('lifecycle', () => {
  it('stays at detected while the sample is too thin to discuss', () => {
    expect(findingOf(history(6, 3)).status).toBe('detected');
  });

  it('moves to investigating once there is something to ask about', () => {
    expect(findingOf(history(10, 4)).status).toBe('investigating');
  });

  it('does not confirm on three occurrences', () => {
    const f = findingOf(history(20, 3));
    expect(f.occurrences).toBe(3);
    expect(f.status).not.toBe('confirmed');
  });

  it('does not confirm on frequency alone when the sample is small', () => {
    // Six occurrences but only twelve chances — below the opportunity floor.
    const f = findingOf(history(12, 6));
    expect(f.occurrences).toBeGreaterThanOrEqual(CONFIRM_MIN_OCCURRENCES);
    expect(f.opportunities).toBeLessThan(CONFIRM_MIN_OPPORTUNITIES);
    expect(f.status).not.toBe('confirmed');
  });

  it('confirms only with the sample AND a confidence above low', () => {
    // Violations spread across the whole history so consistency holds.
    const trades = Array.from({ length: 24 }, (_, i) =>
      (i % 2 === 0 ? bad : good)(stamp(i)));
    const f = findingOf(trades);
    expect(f.occurrences).toBeGreaterThanOrEqual(CONFIRM_MIN_OCCURRENCES);
    expect(f.opportunities).toBeGreaterThanOrEqual(CONFIRM_MIN_OPPORTUNITIES);
    expect(['confirmed', 'investigating']).toContain(f.status);
  });

  // Recounting mid-experiment would drop the behaviour back to
  // 'investigating' and throw away the only window that could show whether
  // the intervention worked.
  it('a running experiment holds its status against a recount', () => {
    expect(deriveStatus(tallyOf(history(6, 3)), 'low', 'experiment')).toBe('experiment');
    expect(deriveStatus(tallyOf(history(6, 3)), 'low', 'monitoring')).toBe('monitoring');
    expect(deriveStatus(tallyOf(history(6, 3)), 'low', 'resolved')).toBe('resolved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Confidence — four factors, and data alone is not enough
// ═══════════════════════════════════════════════════════════════════════════

describe('confidence', () => {
  const strong = () => {
    // 8 NY trades with 7 violations, 12 London with 1 — a clean split on a
    // sample that clears every floor.
    const trades = [
      ...Array.from({ length: 8 }, (_, i) =>
        (i < 7 ? bad : good)({ session: 'nyam', ...stamp(i) })),
      ...Array.from({ length: 12 }, (_, i) =>
        (i < 1 ? bad : good)({ session: 'london', ...stamp(8 + i) })),
    ];
    return { trades, tally: tallyOf(trades) };
  };

  it('never reaches high on trade telemetry alone, however clean the split', () => {
    const { trades, tally } = strong();
    const a = assessConfidence({ tally, trigger: null });
    expect(a.level).not.toBe('high');
    const f = findingOf(trades);
    expect(f.confidence).not.toBe('high');
    expect(f.assessment.limitedBy).toContain('independence');
  });

  it('reaches high only when a second, different source agrees', () => {
    const { trades } = strong();
    const f = buildFinding(tallyOf(trades), buildContexts(trades), {
      extraFamilies: ['trader_answer'],
    });
    if (f.assessment.limitedBy.length === 0) {
      expect(f.confidence).toBe('high');
    } else {
      // Whatever else is missing, it must no longer be independence.
      expect(f.assessment.limitedBy).not.toContain('independence');
    }
  });

  it('counts sources, not numbers — two telemetry signals are one source', () => {
    const { tally } = strong();
    const a = assessConfidence({ tally, trigger: null, extraFamilies: ['trade_telemetry'] });
    expect(a.factors.independence.count).toBe(1);
  });

  it('reports what held it back', () => {
    const f = findingOf(history(10, 4));
    expect(f.assessment.limitedBy.length).toBeGreaterThan(0);
  });
});

describe('consistency', () => {
  it('fails when the behaviour lives entirely in one stretch', () => {
    // Six violations up front, then nothing. A bad fortnight, not a habit.
    const c = assessConsistency(tallyOf(history(20, 6)));
    expect(c.occurrencesPerWindow[1]).toBe(0);
    expect(c.passes).toBe(false);
  });

  it('passes when it appears on both sides of the history', () => {
    const trades = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? bad : good)(stamp(i)));
    expect(assessConsistency(tallyOf(trades)).passes).toBe(true);
  });

  // A fading behaviour is still real, and calling it inconsistent would hide
  // exactly the improvement we want to be able to show.
  it('does not require equal halves', () => {
    const trades = [
      ...Array.from({ length: 10 }, (_, i) => (i < 5 ? bad : good)(stamp(i))),
      ...Array.from({ length: 10 }, (_, i) => (i < 1 ? bad : good)(stamp(10 + i))),
    ];
    expect(assessConsistency(tallyOf(trades)).passes).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Evidence tiers — correlation is never rendered as cause
// ═══════════════════════════════════════════════════════════════════════════

describe('evidence tiers', () => {
  it('always states the observed fact first', () => {
    const s = buildStatements(tallyOf(history(10, 4)), null, 'low');
    expect(s[0].tier).toBe('observed');
  });

  it('emits no pattern claim without a qualifying trigger', () => {
    const s = buildStatements(tallyOf(history(10, 4)), null, 'medium');
    expect(s.map(x => x.tier)).toEqual(['observed']);
  });

  it('never emits an explanation without a pattern under it', () => {
    for (const conf of ['high', 'medium', 'low', 'unknown'] as const) {
      const s = buildStatements(tallyOf(history(10, 4)), null, conf);
      expect(s.some(x => x.tier === 'possible')).toBe(false);
    }
  });

  // The line the product is not allowed to cross on the trader's behalf.
  it('caps any explanation at possible, whatever the confidence', () => {
    expect(explanationTier('high')).toBe('possible');
    expect(explanationTier('medium')).toBe('possible');
    expect(explanationTier('low')).toBe('unknown');
    expect(explanationTier('unknown')).toBe('unknown');
  });

  it('states both rates on a supported claim, never just the striking one', () => {
    const trades = [
      ...Array.from({ length: 8 }, (_, i) =>
        (i < 7 ? bad : good)({ session: 'nyam', ...stamp(i) })),
      ...Array.from({ length: 12 }, (_, i) =>
        (i < 1 ? bad : good)({ session: 'london', ...stamp(8 + i) })),
    ];
    const f = findingOf(trades);
    const supported = f.statements.find(s => s.tier === 'supported');
    expect(supported).toBeDefined();
    expect(supported!.text).toMatch(/מול/);
  });

  it('every statement points at the trades behind it', () => {
    const f = findingOf(history(20, 8));
    for (const s of f.statements) {
      expect(s.tradeIds.length).toBeGreaterThan(0);
    }
  });

  // "You are afraid of losing" is a diagnosis; "your decisions change after a
  // loss" is an observation. The difference has to be enforced, not intended.
  it('never uses diagnostic language', () => {
    const banned = ['פחד', 'חרדה', 'ביטחון עצמי', 'בעיה נפשית', 'אתה מפחד'];
    const f = findingOf(history(24, 10));
    for (const s of f.statements) {
      for (const word of banned) expect(s.text).not.toContain(word);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Questions
// ═══════════════════════════════════════════════════════════════════════════

describe('questions', () => {
  it('asks nothing before there is anything to ask about', () => {
    expect(buildQuestion(tallyOf(history(6, 2)), null)).toBeNull();
    expect(findingOf(history(6, 2)).question).toBeNull();
  });

  it('asks about the specific moment when a trigger is known', () => {
    const trades = [
      ...Array.from({ length: 8 }, (_, i) =>
        (i < 7 ? bad : good)({ session: 'nyam', ...stamp(i) })),
      ...Array.from({ length: 12 }, (_, i) =>
        (i < 1 ? bad : good)({ session: 'london', ...stamp(8 + i) })),
    ];
    const q = findingOf(trades).question!;
    expect(q).toMatch(/7 מתוך 8|מה שונה/);
  });

  // A generic question earns a generic answer and teaches the trader that
  // nobody is really looking.
  it('is never the generic one', () => {
    const q = buildQuestion(tallyOf(history(20, 8)), null)!;
    expect(q).not.toBe('למה אתה חושב שאתה עושה את זה?');
    expect(q).toMatch(/\d/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Baselines
// ═══════════════════════════════════════════════════════════════════════════

describe('baselines', () => {
  it('reports the whole history and the recent window separately', () => {
    // 30 opportunities: violations only in the first 10.
    const trades = Array.from({ length: 30 }, (_, i) => (i < 10 ? bad : good)(stamp(i)));
    const b = computeBaselines(tallyOf(trades));
    expect(b.historicalN).toBe(30);
    expect(b.historicalRate).toBeCloseTo(0.33, 2);
    expect(b.rollingN).toBe(ROLLING_WINDOW);
    expect(b.rollingRate).toBe(0);      // the recent window is clean
  });

  it('rolling equals historical when the history is shorter than the window', () => {
    const b = computeBaselines(tallyOf(history(10, 5)));
    expect(b.rollingN).toBe(10);
    expect(b.rollingRate).toBe(b.historicalRate);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Prioritisation — one thing to work on
// ═══════════════════════════════════════════════════════════════════════════

describe('pickPrimary', () => {
  const f = (kind: string, score: number, status = 'confirmed'): BehaviorFinding =>
    ({ kind, priorityScore: score, status, contrast: 'present' } as unknown as BehaviorFinding);

  it('returns exactly one primary and keeps the rest quiet', () => {
    const out = pickPrimary([f('rule_violation', 5), f('size_spike', 9), f('no_confirmation', 2)]);
    expect(out.primary!.kind).toBe('size_spike');
    expect(out.watching).toHaveLength(2);
  });

  it('returns null when there is nothing to work on', () => {
    expect(pickPrimary([]).primary).toBeNull();
    expect(pickPrimary([f('rule_violation', 9, 'resolved')]).primary).toBeNull();
  });

  // "Seen enough to notice, not enough to discuss" is the definition of
  // 'detected'. Promoted to primary it becomes "1 of 4" presented as today's
  // work — the absence of an insight dressed as one. Silence is the answer.
  it('will not promote a merely detected behaviour, however high it ranks', () => {
    const out = pickPrimary([f('size_spike', 50, 'detected'), f('rule_violation', 1, 'detected')]);
    expect(out.primary).toBeNull();
    expect(out.watching).toHaveLength(0);
  });

  it('picks the investigating one over a higher-scoring detected one', () => {
    const out = pickPrimary([f('size_spike', 50, 'detected'), f('rule_violation', 1, 'investigating')]);
    expect(out.primary!.kind).toBe('rule_violation');
  });

  // Without hysteresis the primary changes most mornings and nothing is ever
  // worked through.
  it('keeps the incumbent when a challenger is only marginally ahead', () => {
    const out = pickPrimary(
      [f('rule_violation', 10), f('size_spike', 10 * (1 + PRIORITY_MARGIN) - 0.1)],
      'rule_violation',
    );
    expect(out.primary!.kind).toBe('rule_violation');
  });

  it('hands over when a challenger is clearly ahead', () => {
    const out = pickPrimary([f('rule_violation', 10), f('size_spike', 25)], 'rule_violation');
    expect(out.primary!.kind).toBe('size_spike');
  });

  // Interrupting a running measurement discards the only thing that could
  // have told us whether the first intervention worked.
  it('never interrupts a running experiment, however loud a rival gets', () => {
    const out = pickPrimary(
      [f('rule_violation', 1, 'experiment'), f('size_spike', 99)],
      'rule_violation',
    );
    expect(out.primary!.kind).toBe('rule_violation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Experiments + guardrails
// ═══════════════════════════════════════════════════════════════════════════

describe('designExperiment', () => {
  it('names an action, not a virtue', () => {
    const e = designExperiment('discretionary_exit', 0.6, null);
    expect(e.instruction).toMatch(/\d/);
    for (const platitude of ['תהיה ממושמע', 'תסמוך על התוכנית', 'שלוט ברגשות', 'תהיה סבלני']) {
      expect(e.instruction).not.toContain(platitude);
    }
  });

  it('declares guardrails for every behaviour', () => {
    for (const kind of ['discretionary_exit', 'no_confirmation', 'rule_violation', 'size_spike'] as const) {
      expect(designExperiment(kind, 0.5, null).guardrails.length).toBeGreaterThan(0);
    }
  });

  it('guards trade frequency everywhere — "stop trading" satisfies every target', () => {
    for (const kind of ['discretionary_exit', 'no_confirmation', 'rule_violation', 'size_spike'] as const) {
      expect(designExperiment(kind, 0.5, null).guardrails).toContain('trade_frequency');
    }
  });
});

describe('guardrailDegraded', () => {
  it('knows which direction is bad for each metric', () => {
    expect(guardrailDegraded('trade_frequency', 10, 3)).toBe(true);
    expect(guardrailDegraded('trade_frequency', 10, 11)).toBe(false);
    expect(guardrailDegraded('rule_adherence', 0.9, 0.4)).toBe(true);
    expect(guardrailDegraded('logging_rate', 1, 0.5)).toBe(true);
    // Losses are negative R: more negative is worse.
    expect(guardrailDegraded('avg_loss_r', -1, -2)).toBe(true);
    expect(guardrailDegraded('avg_loss_r', -1, -0.5)).toBe(false);
  });
});

describe('measureExperiment', () => {
  const before = { historicalRate: 0.6, historicalN: 30, rollingRate: 0.6, rollingN: 20 };
  const clean = [
    { kind: 'trade_frequency' as const, before: 10, after: 10 },
    { kind: 'avg_loss_r' as const, before: -1, after: -1 },
  ];

  it('refuses a verdict on an unfinished window', () => {
    const r = measureExperiment({ before, afterRate: 0.1, afterN: EXPERIMENT_WINDOW - 1, guardrails: clean });
    expect(r.verdict).toBe('insufficient_data');
  });

  it('calls a real change improved', () => {
    const r = measureExperiment({ before, afterRate: 0.1, afterN: EXPERIMENT_WINDOW, guardrails: clean });
    expect(r.verdict).toBe('improved');
    expect(r.historicalImproved && r.rollingImproved).toBe(true);
  });

  it('calls a small move unchanged', () => {
    const r = measureExperiment({
      before, afterRate: 0.6 - IMPROVEMENT_THRESHOLD / 2, afterN: EXPERIMENT_WINDOW, guardrails: clean,
    });
    expect(r.verdict).toBe('unchanged');
  });

  // A good fortnight and a changed habit look identical on the rolling number
  // alone. Requiring both baselines is what separates them.
  it('is not fooled by a lucky window when the long record disagrees', () => {
    const r = measureExperiment({
      before: { historicalRate: 0.25, historicalN: 40, rollingRate: 0.6, rollingN: 20 },
      afterRate: 0.1, afterN: EXPERIMENT_WINDOW, guardrails: clean,
    });
    expect(r.rollingImproved).toBe(true);
    expect(r.historicalImproved).toBe(false);
    expect(r.verdict).toBe('unchanged');
  });

  it('refuses to call it improved when the trader simply stopped trading', () => {
    const r = measureExperiment({
      before, afterRate: 0.05, afterN: EXPERIMENT_WINDOW,
      guardrails: [{ kind: 'trade_frequency', before: 10, after: 2 }],
    });
    expect(r.verdict).toBe('traded_one_problem_for_another');
    expect(r.broken).toContain('trade_frequency');
  });

  it('refuses to call it improved when the losses got bigger instead', () => {
    const r = measureExperiment({
      before, afterRate: 0.05, afterN: EXPERIMENT_WINDOW,
      guardrails: [{ kind: 'avg_loss_r', before: -1, after: -2.5 }],
    });
    expect(r.verdict).toBe('traded_one_problem_for_another');
  });

  it('refuses to call it improved when the trader stopped logging', () => {
    const r = measureExperiment({
      before, afterRate: 0.05, afterN: EXPERIMENT_WINDOW,
      guardrails: [{ kind: 'logging_rate', before: 1, after: 0.3 }],
    });
    expect(r.verdict).toBe('traded_one_problem_for_another');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Insufficient evidence stays insufficient
// ═══════════════════════════════════════════════════════════════════════════

describe('insufficient evidence', () => {
  it('produces a finding with no pattern and no explanation', () => {
    const f = findingOf(history(9, 3));
    expect(f.trigger).toBeNull();
    expect(f.statements.map(s => s.tier)).toEqual(['observed']);
    expect(['low', 'unknown']).toContain(f.confidence);
  });

  it('never fabricates a trigger to have something to say', () => {
    // Violations spread evenly — there is no "when".
    const trades = Array.from({ length: 20 }, (_, i) =>
      (i % 2 === 0 ? bad : good)({ session: i % 4 < 2 ? 'london' : 'nyam', ...stamp(i) }));
    expect(findingOf(trades).trigger).toBeNull();
  });

  it('is deterministic', () => {
    const trades = history(20, 8);
    expect(findingOf(trades)).toEqual(findingOf(trades));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Contrast — a rate of 100% is a data shape, not a behaviour
//
// Found on real trades: six of six trades had no confirmation logged. Read as
// a behaviour that is "you do this every single time", which is an accusation
// built on an empty field. It can never produce a trigger — there is no
// comparison group — so it would have sat as the primary behaviour forever,
// repeating one number every morning.
// ═══════════════════════════════════════════════════════════════════════════

describe('contrast', () => {
  const allBad  = () => Array.from({ length: 8 }, (_, i) => bad(stamp(i)));
  const allGood = () => Array.from({ length: 8 }, (_, i) => good(stamp(i)));

  it('marks a behaviour with no counter-example as always', () => {
    const f = findingOf(allBad());
    expect(f.rate).toBe(1);
    expect(f.contrast).toBe('always');
  });

  it('marks a behaviour that never happened as never', () => {
    expect(findingOf(allGood()).contrast).toBe('never');
  });

  it('marks a normal split as present', () => {
    expect(findingOf(history(20, 8)).contrast).toBe('present');
  });

  it('scores a contrastless finding at zero — nothing can be worked on yet', () => {
    expect(findingOf(allBad()).priorityScore).toBe(0);
  });

  it('never makes a contrastless finding the primary', () => {
    const always  = findingOf(allBad());
    const normal  = { ...findingOf(history(20, 8)), priorityScore: 0.01 } as BehaviorFinding;
    const out = pickPrimary([always, normal]);
    expect(out.primary!.kind).toBe(normal.kind);
  });

  it('leaves nothing primary when every finding lacks contrast', () => {
    expect(pickPrimary([findingOf(allBad())]).primary).toBeNull();
  });

  it('asks no question it could never answer', () => {
    expect(findingOf(allBad()).question).toBeNull();
  });

  // "You did this every single time" reads as an accusation, and the usual
  // cause is an empty field rather than a universal habit.
  it('says what the absence of contrast means instead of dressing it as a pattern', () => {
    const s = findingOf(allBad()).statements;
    expect(s).toHaveLength(1);
    expect(s[0].tier).toBe('observed');
    expect(s[0].text).toMatch(/אין נקודת השוואה/);
  });
});
