// ─────────────────────────────────────────────────────────────────────────────
// Mistake taxonomy + detectors.
//
// Pure. No AI, no network, no async. Given a list of trades, returns which
// behavioural mistakes occurred and — the part that matters — how many
// chances there were to make each one.
//
// THE DENOMINATOR IS THE POINT
//
// "You exited early 8 times" is not a finding; it is a count. "You exited
// early in 8 of the 12 trades that had a target set" is a finding, because it
// can be compared against another group, against last month, and against
// itself after an intervention. Every detector here declares an opportunity
// predicate alongside its occurrence predicate, and a kind with zero
// opportunities is reported as absent rather than as a clean record.
//
// WHAT IS DELIBERATELY MISSING
//
//   stop_moved   — the schema keeps one stop_loss value, not a history of
//                  edits, so a widened stop is indistinguishable from a stop
//                  that was always there. Detecting it needs the journal to
//                  version the field on write.
//   revenge_entry — needs the time the previous trade CLOSED. We store entry
//                  time only, so "entered 4 minutes after taking a loss"
//                  cannot be separated from "entered 4 minutes after opening
//                  the position that later lost".
//
// Both are real behaviours and both are in the brief. Neither is inferable
// from the data we hold, and a detector that guesses is worse than a missing
// one: it produces confident findings about something that never happened.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';

export type MistakeKind =
  | 'discretionary_exit'
  | 'no_confirmation'
  | 'rule_violation'
  | 'size_spike';

/** Human-readable, evidence-first labels. Deliberately descriptive of the
 *  ACTION, never of a supposed state of mind — "closed short of target", not
 *  "fear of giving back profit". */
export const MISTAKE_LABELS: Record<MistakeKind, string> = {
  discretionary_exit: 'סגירה שיקולית — לא ביעד ולא בסטופ',
  no_confirmation: 'כניסה בלי אישור מתועד',
  rule_violation:  'סטייה מהחוקים שהגדרת',
  size_spike:      'הגדלת גודל פוזיציה מעל הרגיל',
};

/** Decided trades only. An OPEN position hasn't finished happening, so it can
 *  neither exhibit a mistake nor count as a chance to make one. */
const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

/** How close to the target or the stop still counts as having reached it.
 *  Slippage and a few ticks of fill difference are not a decision; 3% of the
 *  planned distance absorbs those without excusing a real early exit. */
export const EXIT_TOLERANCE = 0.03;

/** Size counts as elevated at 1.5× the recent median. Below that, ordinary
 *  position sizing across instruments would trip it constantly. */
export const SIZE_SPIKE_MULT = 1.5;
/** Trades needed before a "usual size" exists at all. */
export const SIZE_BASELINE_MIN = 5;
/** How far back the baseline looks. Recent, so a size that has genuinely and
 *  permanently grown becomes the new normal rather than a standing alarm. */
export const SIZE_BASELINE_WINDOW = 20;

export interface MistakeEvent {
  kind:    MistakeKind;
  tradeId: string;
  date:    string;
  /** The numbers that prove it. Everything downstream — the prompt, the UI —
   *  cites from here, so no layer above can state a figure this file didn't
   *  produce. */
  evidence: Record<string, string | number | null>;
}

export interface MistakeTally {
  kind:          MistakeKind;
  occurrences:   number;
  /** Trades that COULD have exhibited this mistake. Never zero in a returned
   *  tally — a kind with no opportunities is omitted entirely. */
  opportunities: number;
  /** occurrences / opportunities. */
  rate:          number;
  events:        MistakeEvent[];
  /** WHICH trades were opportunities, in chronological order.
   *
   *  The count alone is enough to state a rate, but not to split the history
   *  into "it happened here" and "it didn't happen there" — and that split is
   *  the entire basis of trigger analysis. Comparing occurrences against ALL
   *  trades instead of against the trades that could have exhibited the
   *  mistake would silently corrupt every rate downstream. */
  opportunityTradeIds: string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Chronological, with a stable tiebreak so two trades sharing a timestamp
 *  always order the same way. Trades with no time sort after timed ones on
 *  the same date — an untimed entry is more likely a late backfill than the
 *  first trade of the morning. */
export function sortChronologically(trades: readonly TradeRow[]): TradeRow[] {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const at = a.time ?? '99:99';
    const bt = b.time ?? '99:99';
    if (at !== bt) return at.localeCompare(bt);
    return a.id.localeCompare(b.id);
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── detectors ───────────────────────────────────────────────────────────────
//
// Each returns [opportunity, event | null]. Keeping the two answers together
// is what stops the denominator drifting away from the numerator.

/** Closed the position somewhere other than the two places the plan named.
 *
 *  A trade is planned with exactly two exits: the target and the stop. Closing
 *  anywhere between them was a decision taken mid-trade, and that decision —
 *  not its outcome — is the behaviour.
 *
 *  Judged against the PLAN, never against the result. A discretionary exit
 *  that happened to work is still a departure from the plan, and arguably the
 *  more dangerous one, because it gets rewarded. Reading `result` here would
 *  make the detector agree with hindsight, which is exactly what a behaviour
 *  layer must not do.
 *
 *  Requires exit_price, so it only fires on trades where the exit was actually
 *  recorded. A trade whose R was assumed from its result cannot testify about
 *  where it closed — the assumption already decided the answer. */
function detectDiscretionaryExit(t: TradeRow): [boolean, MistakeEvent | null] {
  const exit   = t.exit_price;
  const target = t.take_profit;
  const stop   = t.stop_loss;
  const entry  = t.entry_price;
  const opportunity =
    exit != null && target != null && stop != null && entry != null
    && Number.isFinite(exit) && Number.isFinite(target) && Number.isFinite(stop);
  if (!opportunity) return [false, null];

  const dir = t.direction === 'SHORT' ? -1 : 1;
  // Distance travelled toward the target, as a share of the planned distance.
  // 1 or more = the target was reached. 0 or less = it went to the stop side.
  const planned  = (target! - entry) * dir;
  if (planned <= 0) return [false, null];          // malformed plan, not a behaviour
  const achieved = (exit! - entry) * dir;
  const progress = achieved / planned;

  const reachedTarget = progress >= 1 - EXIT_TOLERANCE;
  const hitStop       = (exit! - stop!) * dir <= EXIT_TOLERANCE * Math.abs(entry - stop!);
  if (reachedTarget || hitStop) return [true, null];

  return [true, {
    kind: 'discretionary_exit',
    tradeId: t.id,
    date: t.date,
    evidence: {
      exit_price:      round2(exit!),
      planned_target:  round2(target!),
      planned_stop:    round2(stop!),
      progress_to_target: round2(progress),
      result:          t.result,      // context for the reader, not a criterion
      session:         t.session,
    },
  }];
}

/** Entered with no confirmation logged.
 *
 *  This measures the JOURNAL, not the chart: an empty list means none was
 *  recorded, which is not proof none existed. That distinction has to survive
 *  all the way to the wording the trader reads. */
function detectNoConfirmation(t: TradeRow): [boolean, MistakeEvent | null] {
  const count = t.confirmations?.length ?? 0;
  if (count > 0) return [true, null];
  return [true, {
    kind: 'no_confirmation',
    tradeId: t.id,
    date: t.date,
    evidence: { confirmations_logged: 0, setup: t.setup, session: t.session },
  }];
}

/** The trader's own rule checkbox. The most reliable signal here, because it
 *  is the trader's own verdict rather than our inference. */
function detectRuleViolation(t: TradeRow): [boolean, MistakeEvent | null] {
  if (t.followed_rules) return [true, null];
  return [true, {
    kind: 'rule_violation',
    tradeId: t.id,
    date: t.date,
    evidence: { setup: t.setup, session: t.session, result: t.result },
  }];
}

/** Size well above the recent norm.
 *
 *  Needs history, so it is the one detector that reads more than its own
 *  trade. Median, not mean, so a single outlier can't drag the baseline up
 *  and hide the next outlier behind it. */
function detectSizeSpike(t: TradeRow, priorContracts: number[]): [boolean, MistakeEvent | null] {
  if (priorContracts.length < SIZE_BASELINE_MIN) return [false, null];
  const base = median(priorContracts.slice(-SIZE_BASELINE_WINDOW));
  if (base <= 0) return [false, null];

  const size = t.contracts ?? 0;
  if (size <= base || size < base * SIZE_SPIKE_MULT) return [true, null];

  return [true, {
    kind: 'size_spike',
    tradeId: t.id,
    date: t.date,
    evidence: {
      contracts:      size,
      usual_contracts: round2(base),
      multiple:       round2(size / base),
      session:        t.session,
    },
  }];
}

// ── public API ──────────────────────────────────────────────────────────────

/** Run every detector over a trade history.
 *
 *  Returns one tally per kind that had at least one opportunity, ordered by
 *  rate descending — the most frequent behaviour first. A kind nobody could
 *  have exhibited is absent rather than reported as a spotless record, since
 *  "0 of 0" reads as praise the trader hasn't earned. */
export function detectMistakes(trades: readonly TradeRow[]): MistakeTally[] {
  const decided = sortChronologically(trades).filter(
    t => !t.deleted_at && DECIDED.has(t.result),
  );

  const acc = new Map<MistakeKind, { events: MistakeEvent[]; opps: string[] }>();
  const bump = (kind: MistakeKind, tradeId: string, opportunity: boolean, event: MistakeEvent | null) => {
    if (!opportunity) return;
    const cur = acc.get(kind) ?? { events: [], opps: [] };
    cur.opps.push(tradeId);
    if (event) cur.events.push(event);
    acc.set(kind, cur);
  };

  const priorContracts: number[] = [];
  for (const t of decided) {
    bump('discretionary_exit', t.id, ...detectDiscretionaryExit(t));
    bump('no_confirmation', t.id, ...detectNoConfirmation(t));
    bump('rule_violation',  t.id, ...detectRuleViolation(t));
    bump('size_spike',      t.id, ...detectSizeSpike(t, priorContracts));
    priorContracts.push(t.contracts ?? 0);
  }

  return [...acc.entries()]
    .map(([kind, v]) => ({
      kind,
      occurrences:         v.events.length,
      opportunities:       v.opps.length,
      rate:                round2(v.events.length / v.opps.length),
      events:              v.events,
      opportunityTradeIds: v.opps,
    }))
    .sort((a, b) => b.rate - a.rate || b.occurrences - a.occurrences || a.kind.localeCompare(b.kind));
}

/** The trade ids on which a given mistake occurred. Step 2 needs this to
 *  split the history into "it happened" and "it didn't". */
export function eventTradeIds(tally: MistakeTally): Set<string> {
  return new Set(tally.events.map(e => e.tradeId));
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __internals = {
  detectDiscretionaryExit, detectNoConfirmation, detectRuleViolation, detectSizeSpike, median,
};
