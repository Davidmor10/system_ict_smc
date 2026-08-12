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
  | 'early_exit'
  | 'no_confirmation'
  | 'rule_violation'
  | 'size_spike';

/** Human-readable, evidence-first labels. Deliberately descriptive of the
 *  ACTION, never of a supposed state of mind — "closed short of target", not
 *  "fear of giving back profit". */
export const MISTAKE_LABELS: Record<MistakeKind, string> = {
  early_exit:      'סגירה מוקדמת לפני היעד המתוכנן',
  no_confirmation: 'כניסה בלי אישור מתועד',
  rule_violation:  'סטייה מהחוקים שהגדרת',
  size_spike:      'הגדלת גודל פוזיציה מעל הרגיל',
};

/** Decided trades only. An OPEN position hasn't finished happening, so it can
 *  neither exhibit a mistake nor count as a chance to make one. */
const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

/** A win that banked less than this share of its planned reward counts as
 *  cut short. 0.6 is a judgement call, not a discovery — it is the point
 *  where "took a bit less" stops being noise and starts being a decision. */
export const EARLY_EXIT_CAPTURE = 0.6;

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

/** Cut a winner short of its plan.
 *
 *  Restricted to wins on purpose. A break-even scratch on a trade with a 2R
 *  target might be a premature exit or might be a setup that never moved —
 *  telling those apart needs the maximum favourable excursion, which we don't
 *  record. Losses are excluded for the same reason: exiting a loser early is
 *  usually good risk management, not a mistake. */
function detectEarlyExit(t: TradeRow): [boolean, MistakeEvent | null] {
  const planned = t.rr_planned;
  const actual  = t.r_multiple;
  const opportunity =
    t.take_profit != null && planned != null && planned > 0 && actual != null;
  if (!opportunity) return [false, null];

  const isCutShort = t.result === 'WIN' && actual! > 0 && actual! < planned! * EARLY_EXIT_CAPTURE;
  if (!isCutShort) return [true, null];

  return [true, {
    kind: 'early_exit',
    tradeId: t.id,
    date: t.date,
    evidence: {
      planned_r:  round2(planned!),
      actual_r:   round2(actual!),
      captured:   round2(actual! / planned!),
      symbol:     t.symbol,
      session:    t.session,
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

  const acc = new Map<MistakeKind, { occ: number; opp: number; events: MistakeEvent[] }>();
  const bump = (kind: MistakeKind, opportunity: boolean, event: MistakeEvent | null) => {
    if (!opportunity) return;
    const cur = acc.get(kind) ?? { occ: 0, opp: 0, events: [] };
    cur.opp += 1;
    if (event) { cur.occ += 1; cur.events.push(event); }
    acc.set(kind, cur);
  };

  const priorContracts: number[] = [];
  for (const t of decided) {
    bump('early_exit',      ...detectEarlyExit(t));
    bump('no_confirmation', ...detectNoConfirmation(t));
    bump('rule_violation',  ...detectRuleViolation(t));
    bump('size_spike',      ...detectSizeSpike(t, priorContracts));
    priorContracts.push(t.contracts ?? 0);
  }

  return [...acc.entries()]
    .map(([kind, v]) => ({
      kind,
      occurrences:   v.occ,
      opportunities: v.opp,
      rate:          round2(v.occ / v.opp),
      events:        v.events,
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
  detectEarlyExit, detectNoConfirmation, detectRuleViolation, detectSizeSpike, median,
};
