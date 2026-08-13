// ─────────────────────────────────────────────────────────────────────────────
// Behavioural experiments — one instruction, one window, one measurement.
//
// Pure. No AI, no network, no async.
//
// WHY GUARDRAILS EXIST
//
// Tell someone to stop exiting early and there are several ways to succeed at
// the metric while failing at the point:
//
//   stop trading             — the rate drops because the denominator emptied
//   hold every loser to stop — the rate drops and the losses get bigger
//   stop logging exits       — the rate drops because we stopped being able
//                              to see it
//
// All three would read as improvement. So every experiment declares what must
// go DOWN and, separately, what must not get worse. An improvement on the
// target while a guardrail breaks is not an improvement; it is a trade of one
// problem for another, and saying so is the difference between a coach and a
// dashboard that congratulates you.
//
// The verdict is deliberately unforgiving: `improved` requires the target to
// move on BOTH baselines — a good fortnight and a changed habit look
// identical on the rolling number alone.
// ─────────────────────────────────────────────────────────────────────────────

import type { BehaviorKind } from './behaviors';
import type { Baselines } from './finding';
import type { TriggerFinding } from './contingency';

/** Opportunities the experiment runs for. Ten is short enough to stay in the
 *  trader's attention and long enough that two lucky trades don't decide it. */
export const EXPERIMENT_WINDOW = 10;
/** The target must fall by at least this much, in rate points, on both
 *  baselines. Below it we are reading noise. */
export const IMPROVEMENT_THRESHOLD = 0.2;
/** A guardrail counts as broken at this much deterioration. Looser than the
 *  target threshold on purpose: we are watching for damage, not for drift. */
export const GUARDRAIL_TOLERANCE = 0.3;

export type GuardrailKind =
  /** Did they stop trading to make the number go down. */
  | 'trade_frequency'
  /** Did the losses get bigger while the behaviour got rarer. */
  | 'avg_loss_r'
  /** Did they stop recording the thing we were measuring. */
  | 'logging_rate'
  /** Did rule adherence fall while attention went to one behaviour. */
  | 'rule_adherence';

export const GUARDRAIL_LABELS: Record<GuardrailKind, string> = {
  trade_frequency: 'מספר עסקאות',
  avg_loss_r:      'גודל הפסד ממוצע',
  logging_rate:    'שלמות התיעוד',
  rule_adherence:  'עמידה בחוקים',
};

export interface Experiment {
  kind:        BehaviorKind;
  /** What to do, in one sentence, phrased as an action and not as a virtue. */
  instruction: string;
  windowTrades: number;
  /** The rate we want to see fall, and where it started. */
  targetFrom:  number;
  guardrails:  GuardrailKind[];
}

/** Guardrails per behaviour — the specific ways each instruction could be
 *  "achieved" without the trader actually changing anything worth changing. */
const GUARDRAILS: Record<BehaviorKind, GuardrailKind[]> = {
  // Holding to the plan can turn into holding every loser to the stop, or
  // into simply not recording where you got out.
  discretionary_exit: ['avg_loss_r', 'logging_rate', 'trade_frequency'],
  // "Only enter with confirmation" is easiest to satisfy by not entering.
  no_confirmation:    ['trade_frequency', 'logging_rate'],
  // Attention on one rule can quietly cost the others.
  rule_violation:     ['trade_frequency', 'rule_adherence'],
  // Sizing down everywhere is not the same as sizing consistently.
  size_spike:         ['trade_frequency', 'avg_loss_r'],
  // "Stop holding" is trivially satisfied by not trading, and the loss size is
  // the thing widening a stop was hiding in the first place.
  stop_widened:       ['trade_frequency', 'avg_loss_r', 'logging_rate'],
};

/** The instruction. Concrete, checkable, and about the next few trades — not
 *  "be disciplined", which names a virtue and specifies no action. */
function instructionFor(kind: BehaviorKind, trigger: TriggerFinding | null): string {
  const when = trigger && trigger.strength !== 'weak'
    ? ' שים לב במיוחד לרגעים שזיהינו.'
    : '';
  switch (kind) {
    case 'discretionary_exit':
      return `ב-${EXPERIMENT_WINDOW} העסקאות הבאות: קבע יעד וסטופ לפני הכניסה, וצא רק באחד מהם.${when}`;
    case 'no_confirmation':
      return `ב-${EXPERIMENT_WINDOW} העסקאות הבאות: תעד את האישור שראית לפני הכניסה. אם אין אישור לתעד — אל תיכנס.${when}`;
    case 'rule_violation':
      return `ב-${EXPERIMENT_WINDOW} העסקאות הבאות: לפני כל כניסה, עבור על החוקים שלך וסמן אם עמדת בהם.${when}`;
    case 'size_spike':
      return `ב-${EXPERIMENT_WINDOW} העסקאות הבאות: החזק גודל פוזיציה קבוע, גם אחרי רצף.${when}`;
    case 'stop_widened':
      return `ב-${EXPERIMENT_WINDOW} העסקאות הבאות: הסטופ שקבעת בכניסה נשאר במקומו. מותר לקדם אותו לטובתך, לא להרחיק אותו.${when}`;
  }
}

export function designExperiment(
  kind: BehaviorKind,
  currentRate: number,
  trigger: TriggerFinding | null,
): Experiment {
  return {
    kind,
    instruction:  instructionFor(kind, trigger),
    windowTrades: EXPERIMENT_WINDOW,
    targetFrom:   currentRate,
    guardrails:   GUARDRAILS[kind],
  };
}

// ── measurement ─────────────────────────────────────────────────────────────

export type ExperimentVerdict =
  /** Target fell on both baselines and nothing broke. */
  | 'improved'
  /** Target fell, but something we were protecting got worse. */
  | 'traded_one_problem_for_another'
  /** No meaningful movement. */
  | 'unchanged'
  /** The window hasn't filled, or the trader stopped producing data. */
  | 'insufficient_data';

export interface GuardrailReading {
  kind:     GuardrailKind;
  before:   number;
  after:    number;
  /** Higher-is-better for adherence and logging; lower-is-better for losses.
   *  Direction is a property of the guardrail, not of the reading. */
  degraded: boolean;
}

export interface ExperimentResult {
  verdict:      ExperimentVerdict;
  targetBefore: number;
  targetAfter:  number;
  delta:        number;
  /** Both baselines, because agreeing is the whole test. */
  historicalImproved: boolean;
  rollingImproved:    boolean;
  guardrails:   GuardrailReading[];
  broken:       GuardrailKind[];
}

/** Is this guardrail worse than it was?
 *
 *  Direction is per-metric and easy to get backwards, which is exactly the
 *  kind of bug that would silently turn "you stopped trading" into "well
 *  done". Encoded once, here. */
export function guardrailDegraded(kind: GuardrailKind, before: number, after: number): boolean {
  const drop = before - after;
  const rise = after - before;
  switch (kind) {
    // Fewer trades, less logging, worse adherence — falls are bad.
    case 'trade_frequency':
    case 'logging_rate':
    case 'rule_adherence':
      return before > 0 && drop / before > GUARDRAIL_TOLERANCE;
    // Losses are negative R; getting worse means getting more negative.
    case 'avg_loss_r':
      return before !== 0 && rise / Math.abs(before) < -GUARDRAIL_TOLERANCE;
  }
}

export interface MeasureInput {
  before:  Baselines;
  /** Rate over the experiment window only. */
  afterRate: number;
  /** Opportunities seen since the experiment began. */
  afterN:  number;
  guardrails: Array<{ kind: GuardrailKind; before: number; after: number }>;
  windowTrades?: number;
}

export function measureExperiment(input: MeasureInput): ExperimentResult {
  const window = input.windowTrades ?? EXPERIMENT_WINDOW;
  const readings: GuardrailReading[] = input.guardrails.map(g => ({
    kind: g.kind, before: g.before, after: g.after,
    degraded: guardrailDegraded(g.kind, g.before, g.after),
  }));
  const broken = readings.filter(r => r.degraded).map(r => r.kind);

  const historicalImproved = input.before.historicalRate - input.afterRate >= IMPROVEMENT_THRESHOLD;
  const rollingImproved    = input.before.rollingRate    - input.afterRate >= IMPROVEMENT_THRESHOLD;

  const base: Omit<ExperimentResult, 'verdict'> = {
    targetBefore: input.before.rollingRate,
    targetAfter:  input.afterRate,
    delta:        Math.round((input.afterRate - input.before.rollingRate) * 100) / 100,
    historicalImproved,
    rollingImproved,
    guardrails:   readings,
    broken,
  };

  // An unfinished window cannot produce a verdict, and guessing one is how a
  // three-trade streak becomes a declared cure.
  if (input.afterN < window) return { ...base, verdict: 'insufficient_data' };

  // Both baselines have to agree. A good fortnight moves the rolling number
  // on its own; only a changed habit moves the historical one too.
  if (historicalImproved && rollingImproved) {
    return { ...base, verdict: broken.length ? 'traded_one_problem_for_another' : 'improved' };
  }
  return { ...base, verdict: 'unchanged' };
}
