// ─────────────────────────────────────────────────────────────────────────────
// What the trader is currently HOLDING — the same five behaviours read from
// the other side.
//
// Every detector in behaviors.ts answers "how often does this go wrong". That
// is the half of the picture a trader already feels. The half they cannot see
// from inside their own week is the one that is going right and has been for a
// while: eight days without breaking a rule, twelve entries in a row with a
// confirmation logged, a stop that has not been widened since June.
//
// Deliberately non-monetary. A streak of green days is not a strength, it is
// an outcome, and telling someone their edge is that they made money is the
// oldest way to teach a trader the wrong lesson. Everything here is process:
// what they DID, never what it paid.
//
// Pure and deterministic, like every other analyzer in this folder. Numbers
// in, numbers out, no AI.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';
import type { BehaviorKind, BehaviorTally } from './behaviors';
import { occurrenceTradeIds } from './behaviors';
import { MIN_DECIDED_FOR_CLAIM } from '../../stats/evidence';

export interface HoldingStreak {
  kind: BehaviorKind;
  /** Consecutive most-recent opportunities where the behaviour did NOT occur. */
  trades: number;
  /** Distinct trading days those trades span. The number a trader recognises:
   *  "eight days" lands where "nineteen trades" is just a figure. */
  days: number;
  /** Total opportunities in the history, so the streak can be read against it. */
  opportunities: number;
  /** True when the behaviour has happened before — which is what makes the
   *  streak an achievement rather than an absence. Someone who has never once
   *  widened a stop has not stopped doing anything. */
  recovered: boolean;
}

/** A streak has to clear the same evidence floor as any other claim here —
 *  three trades without a slip is a Tuesday, not a strength. */
const MIN_STREAK_TRADES = MIN_DECIDED_FOR_CLAIM;

/** How many to hand the prompt. One is the point; the second exists so a note
 *  that leads on the first has somewhere to go when it is the same subject as
 *  the difficulty being discussed. */
const MAX_STREAKS = 2;

/** Current run of clean opportunities, newest-first, and the days it spans. */
function streakFor(tally: BehaviorTally, dateOf: Map<string, string>): { trades: number; days: number } {
  const failed = occurrenceTradeIds(tally);
  const days = new Set<string>();
  let trades = 0;

  for (let i = tally.opportunityTradeIds.length - 1; i >= 0; i--) {
    const id = tally.opportunityTradeIds[i];
    if (failed.has(id)) break;
    trades += 1;
    const date = dateOf.get(id);
    if (date) days.add(date);
  }
  return { trades, days: days.size };
}

/** The streaks worth telling the trader about, strongest first.
 *
 *  Ranked by recovery before length: a behaviour they used to exhibit and have
 *  now held off for eight days is a different, better fact than one they never
 *  had. Length breaks the tie, in days rather than trades, because that is the
 *  unit the streak is felt in. */
export function computeHoldingStreaks(
  tallies: readonly BehaviorTally[],
  trades: readonly TradeRow[],
): HoldingStreak[] {
  const dateOf = new Map(trades.map(t => [t.id, t.date]));

  return tallies
    .map(tally => {
      const { trades: n, days } = streakFor(tally, dateOf);
      return {
        kind:          tally.kind,
        trades:        n,
        days,
        opportunities: tally.opportunities,
        recovered:     tally.occurrences > 0,
      };
    })
    .filter(s => s.trades >= MIN_STREAK_TRADES)
    // A streak covering the entire history of a behaviour that never happened
    // is not a run of good decisions, it is a field nobody has filled in yet.
    .filter(s => s.recovered || s.trades >= MIN_STREAK_TRADES * 2)
    .sort((a, b) =>
      Number(b.recovered) - Number(a.recovered)
      || b.days - a.days
      || b.trades - a.trades
      || a.kind.localeCompare(b.kind))
    .slice(0, MAX_STREAKS);
}

export const __internals = { MIN_STREAK_TRADES, MAX_STREAKS, streakFor };
