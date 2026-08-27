// ─────────────────────────────────────────────────────────────────────────────
// Cross-run memory — what the system knows about a behaviour that cannot be
// recomputed from trades.
//
// Pure. No AI, no network, no async. The database module is a thin shell
// around this; every decision lives here so it can be tested without one.
//
// WHY THIS EXISTS
//
// Steps 1–3 recompute everything from scratch on every run, which makes them
// honest and makes them amnesiac. Four things are lost between runs, and all
// four are load-bearing:
//
//   when it started      — "three weeks" is a different sentence to "6 of 15",
//                          and only one of them explains why it matters
//   the experiment       — an instruction given, a window opened, and the
//                          numbers as they stood at that moment. Without the
//                          BEFORE snapshot there is nothing to measure against,
//                          so an experiment can be started but never judged
//   the question         — asked once and left open, not re-asked every morning
//                          until the trader learns to scroll past it. And when
//                          it IS answered, that answer is the only evidence
//                          family in the system that is not trade telemetry,
//                          which makes it the only route to `high` confidence
//   the relapse          — a behaviour that was resolved and came back is a
//                          different finding to one seen for the first time.
//                          Forgetting that turns a regression into a discovery
//
// WHAT IT DELIBERATELY DOES NOT STORE
//
// Anything derivable from trades. Counts, rates, triggers and confidence are
// recomputed every run from the source rows, so a corrected or deleted trade
// propagates instead of being frozen into a record nobody can revise. The
// stored copies of those numbers are a snapshot for display and for detecting
// movement — never an input to the next computation.
// ─────────────────────────────────────────────────────────────────────────────

import type { BehaviorKind } from './behaviors';
import type { BehaviorFinding, Baselines, FindingStatus } from './finding';
import {
  designExperiment, measureExperiment,
  EXPERIMENT_WINDOW, IMPROVEMENT_RATIO,
  type Experiment, type ExperimentResult, type GuardrailKind,
} from './experiment';
import { pairGuardrails, type GuardrailReadings } from './guardrails';
import type { Confidence, EvidenceFamily } from './evidence';

/** Opportunities an `improved` verdict must survive before it becomes
 *  `resolved`. A behaviour is not beaten the first time it goes quiet — it is
 *  beaten when it stays quiet through a window the trader is no longer
 *  consciously watching. */
export const RECHECK_WINDOW = 10;

/** Has the rate climbed back above the bar that declared the improvement?
 *
 *  Matched to that bar deliberately, so a finding cannot be improved and
 *  relapsed on the same number. The bar is a share of where the behaviour
 *  started, not a fixed number of rate points — see IMPROVEMENT_RATIO — so
 *  the relapse test has to be the same shape or a habit at 18% would relapse
 *  the moment it was declared improved. */
export function hasRelapsed(stored: StoredFinding, rollingNow: number): boolean {
  const before = stored.experimentResult?.targetBefore;
  if (before == null || before <= 0) return false;
  return rollingNow > before * IMPROVEMENT_RATIO;
}

/** The state of an experiment at the moment it began. Everything needed to
 *  measure it later, and nothing that could be recomputed differently between
 *  now and then. */
export interface ExperimentBaseline {
  before: Baselines;
  /** Cumulative counts when the window opened. The difference against the
   *  fresh counts is the window itself — exact, and immune to trades being
   *  edited or reordered in between. */
  occurrencesAtStart:   number;
  opportunitiesAtStart: number;
  /** How many trades the history held when the window opened.
   *
   *  The verdict counts the window as a difference of cumulative counts, which
   *  is exact. Everything else used to re-derive the window by filtering on
   *  `date >= the day it opened` — a different set, and a different answer:
   *  trades logged earlier on the opening day fall inside the date filter and
   *  inside `opportunitiesAtStart`, so they were counted twice, and a trade
   *  logged late under an older date was counted by the verdict and by nothing
   *  else. Sliced from here instead, every reading is over the same trades the
   *  verdict is about.
   *
   *  Optional: findings whose window opened before this field existed have no
   *  value for it, and their callers fall back to the date filter. */
  tradesAtStart?:       number;
  guardrails: GuardrailReadings;
}

export interface StoredFinding {
  kind:   BehaviorKind;
  status: FindingStatus;

  firstDetectedAt: string;
  statusSince:     string;
  lastSeenAt:      string;

  /** Snapshot of the last run, for display and for movement — never fed back
   *  into the next computation. */
  occurrences:   number;
  opportunities: number;
  rate:          number;
  baselines:     Baselines;
  confidence:    Confidence;

  question:         string | null;
  questionAskedAt:  string | null;
  traderAnswer:     string | null;
  traderAnsweredAt: string | null;

  experiment:          Experiment | null;
  experimentStartedAt: string | null;
  experimentBaseline:  ExperimentBaseline | null;
  experimentResult:    ExperimentResult | null;

  /** Times this came back after being resolved. Shown to the trader, because
   *  "this is the second time" is the most useful sentence the system has. */
  relapses: number;

  isPrimary:    boolean;
  primarySince: string | null;
}

export interface Transition {
  from:   FindingStatus | null;
  to:     FindingStatus;
  /** Why, in a form a human can read in a log. Stored on the event row — the
   *  timeline is what makes a claim of improvement auditable. */
  reason: string;
}

export interface ReconcileInput {
  stored: StoredFinding | null;
  /** Freshly computed this run. Build it with `previousStatus: stored?.status`
   *  and `extraFamilies: familiesFor(stored)` so the two agree. */
  fresh:  BehaviorFinding;
  /** Guardrail readings over the window since the experiment began. Ignored
   *  unless an experiment is running. */
  guardrailsNow: GuardrailReadings;
  /** Readings over the trailing window, snapshotted if an experiment starts. */
  guardrailsTrailing: GuardrailReadings;
  /** True when this is the one behaviour being worked on. Only the primary
   *  gets an experiment — a trader running four experiments is running none. */
  isPrimary: boolean;
  /** Trades in the history this run analysed. Snapshotted if a window opens,
   *  so the window can later be sliced by position rather than by date. */
  tradeCount?: number;
  now: string;
}

export interface Reconciled {
  record:     StoredFinding;
  transition: Transition | null;
  /** Present on the run where a window finished and was judged. */
  measured:   ExperimentResult | null;
}

/** Evidence families a stored finding contributes.
 *
 *  Only an ANSWERED question counts. An unanswered one is a question, and
 *  treating it as a second source would let the system reach `high` confidence
 *  by asking itself. */
export function familiesFor(stored: StoredFinding | null): EvidenceFamily[] {
  return stored?.traderAnswer ? ['trader_answer'] : [];
}

function snapshot(fresh: BehaviorFinding, now: string): Pick<
  StoredFinding,
  'occurrences' | 'opportunities' | 'rate' | 'baselines' | 'confidence' | 'lastSeenAt'
> {
  return {
    occurrences:   fresh.occurrences,
    opportunities: fresh.opportunities,
    rate:          fresh.rate,
    baselines:     fresh.baselines,
    confidence:    fresh.confidence,
    lastSeenAt:    now,
  };
}

/** First sighting. */
function create(input: ReconcileInput): Reconciled {
  const { fresh, now } = input;
  return {
    record: {
      kind:   fresh.kind,
      status: fresh.status,
      firstDetectedAt: now,
      statusSince:     now,
      ...snapshot(fresh, now),
      question:         fresh.question,
      questionAskedAt:  fresh.question ? now : null,
      traderAnswer:     null,
      traderAnsweredAt: null,
      experiment:          null,
      experimentStartedAt: null,
      experimentBaseline:  null,
      experimentResult:    null,
      relapses:  0,
      isPrimary: input.isPrimary,
      primarySince: input.isPrimary ? now : null,
    },
    transition: { from: null, to: fresh.status, reason: 'נצפה לראשונה' },
    measured:   null,
  };
}

/** The question, carried or replaced.
 *
 *  Replaced only when the text actually changes — the same question re-asked
 *  every morning is how a trader learns that nothing they say is being read.
 *  An answered question stays answered until the question itself changes. */
function reconcileQuestion(stored: StoredFinding, fresh: BehaviorFinding, now: string) {
  if (fresh.question === stored.question) {
    return {
      question:         stored.question,
      questionAskedAt:  stored.questionAskedAt,
      traderAnswer:     stored.traderAnswer,
      traderAnsweredAt: stored.traderAnsweredAt,
    };
  }
  return {
    question:         fresh.question,
    questionAskedAt:  fresh.question ? now : null,
    // A new question means the old answer was about something else.
    traderAnswer:     null,
    traderAnsweredAt: null,
  };
}

export function reconcile(input: ReconcileInput): Reconciled {
  const { stored, fresh, now } = input;
  if (!stored) return create(input);

  const base: StoredFinding = {
    ...stored,
    ...snapshot(fresh, now),
    ...reconcileQuestion(stored, fresh, now),
    isPrimary:    input.isPrimary,
    primarySince: input.isPrimary ? (stored.primarySince ?? now) : null,
  };

  const move = (to: FindingStatus, reason: string, extra: Partial<StoredFinding> = {}): Reconciled => ({
    record: { ...base, ...extra, status: to, statusSince: to === stored.status ? stored.statusSince : now },
    transition: to === stored.status ? null : { from: stored.status, to, reason },
    measured: null,
  });

  // ── a window is open ──────────────────────────────────────────────────────
  if (stored.status === 'experiment' && stored.experimentBaseline && stored.experiment) {
    const b = stored.experimentBaseline;
    const afterN   = fresh.opportunities - b.opportunitiesAtStart;
    const afterOcc = fresh.occurrences   - b.occurrencesAtStart;

    if (afterN < EXPERIMENT_WINDOW) {
      return move('experiment', `הניסוי רץ — ${afterN} מתוך ${EXPERIMENT_WINDOW} הזדמנויות`);
    }

    const result = measureExperiment({
      before:     b.before,
      afterRate:  afterN > 0 ? Math.round((afterOcc / afterN) * 100) / 100 : 0,
      afterN,
      guardrails: pairGuardrails(stored.experiment.guardrails, b.guardrails, input.guardrailsNow),
      windowTrades: stored.experiment.windowTrades,
    });

    // The verdict, and nothing softened. `traded_one_problem_for_another` goes
    // to monitoring rather than to improved on purpose: the target moved, so
    // there is something real here, but declaring victory while a guardrail is
    // broken is the exact failure the guardrails were added to prevent.
    const to: FindingStatus =
      result.verdict === 'improved' ? 'improved'
      : result.verdict === 'traded_one_problem_for_another' ? 'monitoring'
      : 'confirmed';

    const reason =
      result.verdict === 'improved' ? `הניסוי הסתיים: ירידה משמעותית בשני הבסיסים`
      : result.verdict === 'traded_one_problem_for_another' ? `היעד ירד אבל נשבר: ${result.broken.join(', ')}`
      : 'הניסוי הסתיים בלי שינוי מדיד';

    // A window that ended without moving the target CLOSES. The experiment and
    // its baseline go with it.
    //
    // Carrying them forward is what made this a loop. Status returns to
    // `confirmed`, the next run falls into the open-a-window branch below,
    // and an identical experiment reopens the same morning — with no line
    // anywhere saying the last one had finished. The finding then holds the
    // single primary slot for as long as it keeps not improving, which is
    // exactly the behaviour least likely to release it, and no other
    // behaviour ever gets a turn.
    //
    // `experimentResult` stays. It is the record that a window ran and what it
    // came to, it is what the tracking archive reads, and it is how the next
    // run knows this finding has already had its turn.
    const cleared = result.verdict === 'unchanged'
      ? { experiment: null, experimentBaseline: null, experimentStartedAt: null }
      : {};

    return {
      record: {
        ...base,
        ...cleared,
        status: to,
        statusSince: now,
        experimentResult: result,
      },
      transition: { from: stored.status, to, reason },
      measured: result,
    };
  }

  // ── improved, waiting to see if it holds ──────────────────────────────────
  if (stored.status === 'improved' && stored.experimentBaseline) {
    const b = stored.experimentBaseline;
    const since = fresh.opportunities - b.opportunitiesAtStart - EXPERIMENT_WINDOW;
    const relapsed = hasRelapsed(stored, fresh.baselines.rollingRate);

    if (relapsed) {
      return {
        record: { ...base, status: 'confirmed', statusSince: now, relapses: stored.relapses + 1,
                  experiment: null, experimentBaseline: null, experimentStartedAt: null },
        transition: { from: 'improved', to: 'confirmed', reason: 'ההתנהגות חזרה אחרי השיפור' },
        measured: null,
      };
    }
    if (since >= RECHECK_WINDOW) {
      return move('resolved', `החזיק ${RECHECK_WINDOW} הזדמנויות נוספות אחרי השיפור`);
    }
    return move('improved', `במעקב — ${Math.max(0, since)} מתוך ${RECHECK_WINDOW}`);
  }

  // ── monitoring: the target moved but something else broke ─────────────────
  //
  // This state needs a way out in both directions. Without one, a trader who
  // cut their trading in half to stop breaking a rule, then went back to
  // trading normally while keeping the rule, would sit in "monitoring"
  // permanently — punished by a snapshot of a fortnight they already fixed.
  // So it is re-measured against the same baseline on every run: repair the
  // guardrail and it becomes an improvement; lose the target and it goes back
  // to confirmed.
  if (stored.status === 'monitoring' && stored.experiment && stored.experimentBaseline) {
    const b = stored.experimentBaseline;
    const afterN   = fresh.opportunities - b.opportunitiesAtStart;
    const afterOcc = fresh.occurrences   - b.occurrencesAtStart;
    const result = measureExperiment({
      before:    b.before,
      afterRate: afterN > 0 ? Math.round((afterOcc / afterN) * 100) / 100 : 0,
      afterN,
      guardrails: pairGuardrails(stored.experiment.guardrails, b.guardrails, input.guardrailsNow),
      windowTrades: stored.experiment.windowTrades,
    });

    if (result.verdict === 'improved') {
      return {
        record: { ...base, status: 'improved', statusSince: now, experimentResult: result },
        transition: { from: 'monitoring', to: 'improved', reason: 'הבטחה תוקנה — היעד ירד בלי נזק' },
        measured: result,
      };
    }
    if (result.verdict === 'unchanged') {
      return {
        record: { ...base, status: 'confirmed', statusSince: now, experimentResult: result,
                  experiment: null, experimentBaseline: null, experimentStartedAt: null },
        transition: { from: 'monitoring', to: 'confirmed', reason: 'היעד חזר לרמתו הקודמת' },
        measured: result,
      };
    }
    return {
      record: { ...base, experimentResult: result },
      transition: null,
      measured: result,
    };
  }

  // ── resolved, and it came back ────────────────────────────────────────────
  if (stored.status === 'resolved') {
    const grew = fresh.occurrences > stored.occurrences;
    const back = grew && hasRelapsed(stored, fresh.baselines.rollingRate);
    if (back) {
      return {
        record: { ...base, status: 'confirmed', statusSince: now, relapses: stored.relapses + 1,
                  experiment: null, experimentBaseline: null, experimentStartedAt: null },
        transition: { from: stored.status, to: 'confirmed', reason: 'חזר אחרי שנסגר' },
        measured: null,
      };
    }
    return move(stored.status, 'ללא שינוי');
  }

  // ── confirmed and being worked on → open a window ─────────────────────────
  // Only the primary, and only once: a trader running four experiments is
  // running none, and re-opening a window mid-flight discards the measurement
  // that was the point of opening the first one.
  if (fresh.status === 'confirmed' && input.isPrimary && fresh.contrast === 'present') {
    const experiment = designExperiment(fresh.kind, fresh.baselines.rollingRate, fresh.trigger);
    return move('experiment', 'נפתח ניסוי התנהגותי', {
      experiment,
      experimentStartedAt: now,
      experimentBaseline: {
        before: fresh.baselines,
        occurrencesAtStart:   fresh.occurrences,
        opportunitiesAtStart: fresh.opportunities,
        tradesAtStart:        input.tradeCount,
        guardrails: input.guardrailsTrailing,
      },
      experimentResult: null,
    });
  }

  // ── ordinary progress ─────────────────────────────────────────────────────
  return move(
    fresh.status,
    fresh.status === stored.status
      ? 'ללא שינוי'
      : `${fresh.occurrences} מתוך ${fresh.opportunities} — עבר ל-${fresh.status}`,
  );
}

/** When each behaviour's last measurement window closed.
 *
 *  Absent from the map means it has never had one, which sorts ahead of every
 *  behaviour that has.
 *
 *  A BOOLEAN IS NOT ENOUGH, AND THAT IS THE WHOLE POINT
 *
 *  "Has it had a turn" rotates the slot exactly once. As soon as every
 *  behaviour has been measured they are all equal again, the tiebreak falls
 *  back to severity, and the highest-scoring finding takes the slot and keeps
 *  it — which is the deadlock this was written to break, arriving one full
 *  rotation later. Ordering by WHEN turns it into a real queue.
 *
 *  `statusSince` is the timestamp: a finding holding an `experimentResult` got
 *  it when its window closed, and that is the transition that set the field.
 *  Derived rather than stored, so no column has to exist for the queue to
 *  work. */
/** How far into its window a running experiment is — the count on screen.
 *
 *  The same subtraction the verdict makes, so the trader watches the number
 *  that decides rather than a second one that resembles it. `opportunitiesNow`
 *  must come from the same detection pass the verdict uses.
 *
 *  Null when nothing is running. Clamped to the window: the count is judged
 *  the moment it reaches the end, so "11 of 10" is never a thing to show. */
export function windowProgress(
  stored: StoredFinding,
  opportunitiesNow: number,
): { done: number; of: number } | null {
  if (!stored.experiment || !stored.experimentBaseline || stored.experimentResult) return null;
  const done = opportunitiesNow - stored.experimentBaseline.opportunitiesAtStart;
  return {
    done: Math.max(0, Math.min(done, stored.experiment.windowTrades)),
    of:   stored.experiment.windowTrades,
  };
}

export function measuredAt(
  stored: Iterable<StoredFinding>,
): Map<BehaviorKind, string> {
  const out = new Map<BehaviorKind, string>();
  for (const f of stored) if (f.experimentResult) out.set(f.kind, f.statusSince);
  return out;
}

/** Which guardrails a stored experiment is watching. Empty when none is
 *  running, which is the caller's signal that the readings aren't needed. */
export function watchedGuardrails(stored: StoredFinding | null): GuardrailKind[] {
  return stored?.experiment?.guardrails ?? [];
}
