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
import { resolveStopMoved, analyzeStopMoves, type ManagementEvent } from '../../trade/management';

export type BehaviorKind =
  | 'discretionary_exit'
  | 'no_confirmation'
  | 'rule_violation'
  | 'size_spike'
  | 'stop_widened';

/** Human-readable, evidence-first labels. Deliberately descriptive of the
 *  ACTION, never of a supposed state of mind — "closed short of target", not
 *  "fear of giving back profit". */
export const BEHAVIOR_LABELS: Record<BehaviorKind, string> = {
  discretionary_exit: 'סגירה שיקולית — לא ביעד ולא בסטופ',
  no_confirmation: 'כניסה בלי אישור מתועד',
  rule_violation:  'סטייה מהחוקים שהגדרת',
  size_spike:      'הגדלת גודל פוזיציה מעל הרגיל',
  stop_widened:    'הרחקת הסטופ אחרי הכניסה',
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

export interface BehaviorOccurrence {
  kind:    BehaviorKind;
  tradeId: string;
  date:    string;
  /** The numbers that prove it. Everything downstream — the prompt, the UI —
   *  cites from here, so no layer above can state a figure this file didn't
   *  produce. */
  evidence: Record<string, string | number | null>;
}

export interface BehaviorTally {
  kind:          BehaviorKind;
  occurrences:   number;
  /** Trades that COULD have exhibited this mistake. Never zero in a returned
   *  tally — a kind with no opportunities is omitted entirely. */
  opportunities: number;
  /** occurrences / opportunities. */
  rate:          number;
  events:        BehaviorOccurrence[];
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
 *  where it closed — the assumption already decided the answer.
 *
 *  AN ADVANCED STOP IS NOT A DISCRETIONARY EXIT
 *
 *  The detector compares the exit against the stop set AT ENTRY, because that
 *  is the stop the plan named. A trader who advances their stop to protect a
 *  position and is then taken out at the new level has closed at a stop — just
 *  not the one this comparison knows about. Judged against the entry stop,
 *  that exit sits between the two planned prices and looks identical to a
 *  mid-trade decision.
 *
 *  It is the opposite of one. Advancing a stop is the discipline this layer
 *  exists to encourage, and calling it a discretionary exit does not merely
 *  miscount — it opens a measurement window asking the trader to stop doing
 *  the right thing. Observed on live data: eight of ten flagged exits were
 *  trades where the trader had reported advancing their stop.
 *
 *  What happens next depends on whether the level survived. A trade carrying
 *  management events knows where the stop ended up, so the question is decided
 *  rather than guessed: the exit either reached that level or it did not, and
 *  only the second is a decision. A trade carrying only the trader's reported
 *  "I advanced it" has no level at all, and there "the advanced stop was hit"
 *  and "the stop was advanced and then the position was closed by hand" are
 *  the same row. That trade leaves the OPPORTUNITY set entirely — crediting it
 *  as a clean exit would assert the first reading, and flagging it asserts the
 *  second. Same rule as the stop and rule detectors below: silence is not a
 *  verdict, and an honest denominator leaves out what nobody can grade. */
function detectDiscretionaryExit(t: TradeRow): [boolean, BehaviorOccurrence | null] {
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

  // Between the two planned prices — which is also where an advanced stop
  // sits. Resolved the same way the stop detector resolves it, so a logged
  // move and a remembered one are read identically in both places.
  const direction = t.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const events = (t.management ?? null) as ManagementEvent[] | null;
  const { value: stopMoved } = resolveStopMoved(
    stop!,
    direction,
    events,
    t.stop_moved === 'none' || t.stop_moved === 'advanced' || t.stop_moved === 'widened'
      ? t.stop_moved : undefined,
  );

  if (stopMoved === 'advanced') {
    // With the levels on record there is nothing to guess: the exit either
    // reached the stop the trader moved to, or it did not, and only the second
    // is a decision. This is the case the events were added for.
    const moved = events ? analyzeStopMoves(stop!, direction, events).finalStop : null;
    if (moved != null) {
      const hitMovedStop = (exit! - moved) * dir <= EXIT_TOLERANCE * Math.abs(entry - stop!);
      if (hitMovedStop) return [true, null];
    } else {
      // Reported, with no level. Unjudgeable, and left out of the denominator
      // rather than credited as clean — see the note above.
      return [false, null];
    }
  }

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
 *  all the way to the wording the trader reads.
 *
 *  `adopted` is the guard that makes it a behaviour at all. Before the trader
 *  had ever used the field, every trade is empty — not because they entered
 *  without confirmation, but because they were not filling that box in yet.
 *  Counting those produces a clean-looking finding ("6 of 9") whose real
 *  correlate is the calendar: old trades versus new ones. We hit exactly that
 *  here, and it is the third time the same shape has appeared — an unfilled
 *  field reading as a discovered habit.
 *
 *  So opportunities start at the first trade that carries a confirmation. A
 *  trader who has never used the field gets no opportunities and the detector
 *  stays silent, which is the correct amount to say about a box nobody has
 *  ticked. */
function detectNoConfirmation(t: TradeRow, adopted: boolean): [boolean, BehaviorOccurrence | null] {
  if (!adopted) return [false, null];
  const count = t.confirmations?.length ?? 0;
  if (count > 0) return [true, null];
  return [true, {
    kind: 'no_confirmation',
    tradeId: t.id,
    date: t.date,
    evidence: { confirmations_logged: 0, setup: t.setup, session: t.session },
  }];
}

/** The trader's own rule verdict. The most reliable signal in the whole file,
 *  because it is judgement rather than our inference from prices.
 *
 *  An unanswered trade is not an opportunity. Counting silence as compliance
 *  would inflate the denominator with trades nobody graded and make the
 *  adherence rate a flattering fiction; counting it as a violation would be
 *  worse. The honest denominator is "trades the trader actually graded". */
function detectRuleViolation(t: TradeRow): [boolean, BehaviorOccurrence | null] {
  if (t.followed_rules == null) return [false, null];
  if (t.followed_rules) return [true, null];
  return [true, {
    kind: 'rule_violation',
    tradeId: t.id,
    date: t.date,
    evidence: { setup: t.setup, session: t.session, result: t.result },
  }];
}

/** The stop was moved away from entry after the trade was live.
 *
 *  Asked rather than inferred, because the schema keeps one stop value and not
 *  a history of edits — a widened stop is indistinguishable from a stop that
 *  was always there. Until the journal versions the field, the trader is the
 *  only witness.
 *
 *  Three answers and not two, which is the whole reason this detector can
 *  exist at all. "Moved the stop" merges the two opposite acts in trade
 *  management: advancing it to protect a position is discipline, widening it
 *  to avoid being stopped out is the thing that empties accounts. A boolean
 *  counts them together and measures nothing.
 *
 *  An unanswered trade is not an opportunity — same rule as the rule verdict.
 *  Counting silence as "didn't move it" would dilute the denominator with
 *  trades nobody graded and make the rate a flattering fiction. */
function detectStopWidened(t: TradeRow): [boolean, BehaviorOccurrence | null] {
  const reported = t.stop_moved === 'none' || t.stop_moved === 'advanced' || t.stop_moved === 'widened'
    ? t.stop_moved : undefined;

  // A logged move beats a remembered one. The events carry the level and the
  // moment it changed, so the direction is computed rather than recalled — and
  // the source travels with the finding, because a claim built on a record and
  // a claim built on a recollection are different claims.
  const { value, source } = resolveStopMoved(
    t.stop_loss,
    t.direction === 'SHORT' ? 'SHORT' : 'LONG',
    (t.management ?? null) as ManagementEvent[] | null,
    reported,
  );

  if (!value) return [false, null];
  if (value !== 'widened') return [true, null];
  return [true, {
    kind: 'stop_widened',
    tradeId: t.id,
    date: t.date,
    evidence: {
      planned_stop: t.stop_loss,
      source,
      moves: (t.management ?? []).filter(e => e.kind === 'stop').length,
      result: t.result,
      session: t.session,
    },
  }];
}

/** Size well above the recent norm.
 *
 *  Needs history, so it is the one detector that reads more than its own
 *  trade. Median, not mean, so a single outlier can't drag the baseline up
 *  and hide the next outlier behind it.
 *
 *  PER INSTRUMENT, BECAUSE A CONTRACT IS NOT A UNIT
 *
 *  "Three contracts" means nothing on its own. Three MNQ is a fraction of one
 *  NQ, and a trader who moves between the two would show a baseline that is
 *  neither instrument's — every switch down to the micro reading as a size
 *  spike, and every switch up to the full-size contract hiding inside a
 *  baseline the micros inflated. The comparison is only meaningful against the
 *  same instrument, so the history is filtered to it first.
 *
 *  The cost is that a new instrument has no baseline until it has its own
 *  five trades. That is the correct answer rather than a limitation: there is
 *  no "usual size" in something traded twice.
 *
 *  A trade with no contract count is not an opportunity, and never joins a
 *  baseline. Counting it as zero — which is what an absent number becomes on
 *  the way into arithmetic — drags the median down and turns ordinary size
 *  into a standing alarm. */
function detectSizeSpike(t: TradeRow, priorSizes: PriorSize[]): [boolean, BehaviorOccurrence | null] {
  const size = sizeOf(t);
  if (size == null) return [false, null];

  const symbol = symbolKey(t.symbol);
  const sameInstrument = priorSizes.filter(p => p.symbol === symbol).map(p => p.contracts);
  if (sameInstrument.length < SIZE_BASELINE_MIN) return [false, null];

  const base = median(sameInstrument.slice(-SIZE_BASELINE_WINDOW));
  if (base <= 0) return [false, null];

  if (size < base * SIZE_SPIKE_MULT) return [true, null];

  return [true, {
    kind: 'size_spike',
    tradeId: t.id,
    date: t.date,
    evidence: {
      contracts:      size,
      usual_contracts: round2(base),
      multiple:       round2(size / base),
      symbol,
      session:        t.session,
    },
  }];
}

/** One prior trade's size, kept with the instrument it was traded in. */
interface PriorSize { symbol: string; contracts: number }

/** Case and stray whitespace must not split one instrument into two
 *  baselines — "mnq" and "MNQ " are the same contract. */
function symbolKey(symbol: string | null | undefined): string {
  return (symbol ?? '').trim().toUpperCase();
}

/** The contract count, or null when there isn't one. Zero and negative are
 *  absences too: no position was taken in a trade of zero contracts. */
function sizeOf(t: TradeRow): number | null {
  const n = t.contracts;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

// ── public API ──────────────────────────────────────────────────────────────

/** Run every detector over a trade history.
 *
 *  Returns one tally per kind that had at least one opportunity, ordered by
 *  rate descending — the most frequent behaviour first. A kind nobody could
 *  have exhibited is absent rather than reported as a spotless record, since
 *  "0 of 0" reads as praise the trader hasn't earned. */
export function detectBehaviors(trades: readonly TradeRow[]): BehaviorTally[] {
  const decided = sortChronologically(trades).filter(
    t => !t.deleted_at && DECIDED.has(t.result),
  );

  const acc = new Map<BehaviorKind, { events: BehaviorOccurrence[]; opps: string[] }>();
  const bump = (kind: BehaviorKind, tradeId: string, opportunity: boolean, event: BehaviorOccurrence | null) => {
    if (!opportunity) return;
    const cur = acc.get(kind) ?? { events: [], opps: [] };
    cur.opps.push(tradeId);
    if (event) cur.events.push(event);
    acc.set(kind, cur);
  };

  // When the confirmations field entered service, in this history. Everything
  // before it is silence about the journal rather than evidence about a trade.
  const firstConfirmation = decided.findIndex(t => (t.confirmations?.length ?? 0) > 0);

  const priorSizes: PriorSize[] = [];
  for (const [i, t] of decided.entries()) {
    bump('discretionary_exit', t.id, ...detectDiscretionaryExit(t));
    bump('no_confirmation', t.id, ...detectNoConfirmation(t, firstConfirmation >= 0 && i >= firstConfirmation));
    bump('rule_violation',  t.id, ...detectRuleViolation(t));
    bump('size_spike',      t.id, ...detectSizeSpike(t, priorSizes));
    bump('stop_widened',    t.id, ...detectStopWidened(t));
    const size = sizeOf(t);
    if (size != null) priorSizes.push({ symbol: symbolKey(t.symbol), contracts: size });
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
export function occurrenceTradeIds(tally: BehaviorTally): Set<string> {
  return new Set(tally.events.map(e => e.tradeId));
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __internals = {
  detectDiscretionaryExit, detectNoConfirmation, detectRuleViolation, detectSizeSpike, detectStopWidened, median,
};
