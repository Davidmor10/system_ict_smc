// ─────────────────────────────────────────────────────────────────────────────
// Reported vs verified — which of a trade's claims the data can check.
//
// Pure. No AI, no network, no async.
//
// THE DISTINCTION
//
// A journal holds two kinds of statement and treats them identically. Some are
// records: the entry, the stop, the exits, the sizes. Some are reports: the
// trader saying they followed their rules, saw a confirmation, felt calm, left
// the stop alone. Both end up as columns, and once they are columns nothing
// downstream can tell which is which.
//
// That matters because they fail differently. A record is wrong when something
// was mistyped. A report is wrong when memory drifts toward the outcome — and
// memory drifts toward the outcome reliably, in everyone, without dishonesty
// and without being noticed.
//
// WHAT THIS FILE DOES AND DOES NOT DO
//
// It checks the reports that the records can actually check, and says nothing
// about the ones they can't. Three of them are checkable today. Emotional
// state, confirmations and the rule verdict are not — there is nothing in the
// data to hold them against — and the honest output for those is
// `unverifiable`, which is a real answer and not a failure.
//
// A disagreement is NOT an accusation. Nine times in ten it is a typo, and the
// tenth is memory doing what memory does. So the wording everywhere downstream
// is "these two don't match", never "you were wrong" — and the trader is the
// one who decides which of the two to fix.
// ─────────────────────────────────────────────────────────────────────────────

import { calcWeightedExitPrice, inferResult } from '../calc/trade';
import { analyzeStopMoves, type ManagementEvent } from './management';

export type CheckStatus =
  /** The report and the record say the same thing. */
  | 'agrees'
  /** They say different things. Worth a look — not a verdict. */
  | 'disagrees'
  /** Nothing in the data can speak to this claim. */
  | 'unverifiable';

export interface Check {
  id:     string;
  /** What was compared, in the trader's language. */
  label:  string;
  status: CheckStatus;
  /** Both sides, so the trader can see which one to correct. */
  reported?: string;
  recorded?: string;
}

export interface VerifiableTrade {
  direction:  'LONG' | 'SHORT';
  entry:      number;
  stop:       number;
  target:     number | null;
  contracts:  number;
  result:     string;
  exits?:     Array<{ price: number; contracts: number }> | null;
  stopMoved?: 'none' | 'advanced' | 'widened' | null;
  management?: ManagementEvent[] | null;
}

const RESULT_HE: Record<string, string> = {
  WIN: 'טייק', LOSS: 'סטופ', BE: 'ברייק איוון', OPEN: 'פתוחה',
};
const MOVE_HE: Record<string, string> = {
  none: 'לא נגעתי', advanced: 'קידמתי', widened: 'הרחקתי',
};

/** Did the result the trader chose match where the trade actually closed.
 *
 *  The one check that catches a mistyped price as reliably as a mislabelled
 *  outcome, because the two are the same error seen from opposite ends. A BE
 *  whose exits say +1R is either the wrong button or a price entered in points
 *  rather than as a price — and both are worth seeing. */
function checkResultAgainstExits(t: VerifiableTrade): Check {
  const base = { id: 'result_vs_exit', label: 'התוצאה שסימנת מול מחיר היציאה' };
  const exits = t.exits ?? [];
  if (!exits.length || t.result === 'OPEN') {
    return { ...base, status: 'unverifiable' };
  }
  const weighted = calcWeightedExitPrice(exits);
  if (weighted == null) return { ...base, status: 'unverifiable' };

  const derived = inferResult(t.entry, t.stop, t.target, weighted, t.direction);
  return {
    ...base,
    status:   derived === t.result ? 'agrees' : 'disagrees',
    reported: RESULT_HE[t.result] ?? t.result,
    recorded: RESULT_HE[derived] ?? derived,
  };
}

/** Did the stop answer match the logged moves.
 *
 *  Only checkable once the trader has logged at least one move. Without events
 *  the report is all there is, and calling that `agrees` would dress a single
 *  unchecked source up as a corroborated one. */
function checkStopMoved(t: VerifiableTrade): Check {
  const base = { id: 'stop_moved_vs_log', label: 'תשובת הסטופ מול הרישום בזמן אמת' };
  const events = (t.management ?? []).filter(e => e.kind === 'stop');
  if (!events.length || !t.stopMoved) return { ...base, status: 'unverifiable' };

  const a = analyzeStopMoves(t.stop, t.direction, events);
  const recorded = a.verdict === 'both' ? 'widened' : a.verdict;
  return {
    ...base,
    status:   recorded === t.stopMoved ? 'agrees' : 'disagrees',
    reported: MOVE_HE[t.stopMoved] ?? t.stopMoved,
    recorded: MOVE_HE[recorded] ?? recorded,
  };
}

/** Do the exit legs add up to the position.
 *
 *  Closing more contracts than were opened is arithmetic, not judgement, and
 *  it silently corrupts the weighted exit price — which is the number every
 *  R in the system is computed from. */
function checkExitContracts(t: VerifiableTrade): Check {
  const base = { id: 'exit_contracts', label: 'סך החוזים ביציאות מול גודל הפוזיציה' };
  const exits = t.exits ?? [];
  if (!exits.length) return { ...base, status: 'unverifiable' };

  const closed = exits.reduce((sum, e) => sum + (e.contracts || 0), 0);
  return {
    ...base,
    // Closing fewer is legitimate — a runner may still be open, or the trader
    // may have logged only part of the exit. Closing MORE cannot happen.
    status:   closed > t.contracts ? 'disagrees' : 'agrees',
    reported: `${t.contracts} חוזים`,
    recorded: `${closed} ביציאות`,
  };
}

/** Every check for one trade, in the order a trader would read them. */
export function verifyTrade(t: VerifiableTrade): Check[] {
  return [
    checkResultAgainstExits(t),
    checkStopMoved(t),
    checkExitContracts(t),
  ];
}

export interface VerificationSummary {
  /** Trades where at least one check disagreed. */
  disagreeing: number;
  /** Trades where at least one check could be run at all. */
  checkable:   number;
  /** Per-check counts, so the readout can name what to fix. */
  byCheck:     Array<{ id: string; label: string; disagrees: number }>;
}

/** Roll the checks up across a history.
 *
 *  Deliberately counts TRADES and not checks: three contradictions on one
 *  mistyped trade is one trade to fix, and reporting it as three would make a
 *  single typo look like a pattern. */
export function summarizeVerification(trades: readonly VerifiableTrade[]): VerificationSummary {
  const counts = new Map<string, { label: string; disagrees: number }>();
  let disagreeing = 0;
  let checkable   = 0;

  for (const t of trades) {
    const checks = verifyTrade(t);
    if (checks.some(c => c.status !== 'unverifiable')) checkable += 1;
    if (checks.some(c => c.status === 'disagrees'))    disagreeing += 1;
    for (const c of checks) {
      const entry = counts.get(c.id) ?? { label: c.label, disagrees: 0 };
      if (c.status === 'disagrees') entry.disagrees += 1;
      counts.set(c.id, entry);
    }
  }

  return {
    disagreeing, checkable,
    byCheck: [...counts.entries()]
      .map(([id, v]) => ({ id, label: v.label, disagrees: v.disagrees }))
      .filter(c => c.disagrees > 0),
  };
}
