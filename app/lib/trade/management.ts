// ─────────────────────────────────────────────────────────────────────────────
// Management events — what happened to the trade between entry and exit.
//
// Pure. No AI, no network, no async.
//
// WHY EVENTS AND NOT FIELDS
//
// The journal has always kept one stop value and one target value: the ones
// that were true when the row was last saved. That is enough to describe a
// plan and useless for describing its management, because a stop that was
// widened at 10:42 is indistinguishable from a stop that was always there.
// Everything a trader does between entry and exit was invisible.
//
// An event carries a level and the moment it changed. From a list of them the
// system can DERIVE what was previously only askable: whether the stop was
// advanced or widened, how many times, and how far into the trade.
//
// WHY THIS MATTERS MORE THAN THE FIELD IT REPLACES
//
// `stopMoved` is the trader's own report. It is honest and it is memory —
// collected after the fact, subject to the same drift as every other
// after-the-fact answer. A logged event is a record made at the time.
//
// Both are kept. The derived answer wins when events exist, the reported one
// stands in when they don't, and the two are never merged into a single number
// that hides which is which: a claim built on a record and a claim built on a
// recollection are different claims, and the system should be able to say
// which one it is making.
// ─────────────────────────────────────────────────────────────────────────────

export type ManagementKind =
  /** The stop was moved to a new level. */
  | 'stop'
  /** The target was moved to a new level. */
  | 'target'
  /** Part of the position was closed. */
  | 'partial';

export interface ManagementEvent {
  /** ISO timestamp — when the change was recorded. */
  at:   string;
  kind: ManagementKind;
  /** The new level: the stop, the target, or the price the partial filled at. */
  to:   number;
  /** Contracts closed. Partials only. */
  contracts?: number;
  /** Optional one-line reason, in the trader's words. */
  note?: string;
}

export type StopVerdict = 'none' | 'advanced' | 'widened' | 'both';

export interface StopAnalysis {
  verdict: StopVerdict;
  /** How many times the stop moved at all. */
  moves:   number;
  /** Moves that took the stop further from entry — more room, more risk. */
  widened: number;
  /** Moves that took it toward entry or past it — less risk. */
  advanced: number;
  /** Where the stop ended up. Null when it never moved. */
  finalStop: number | null;
}

const EMPTY: StopAnalysis = { verdict: 'none', moves: 0, widened: 0, advanced: 0, finalStop: null };

/** Chronological. Events are appended as they happen, but a trade edited later
 *  can interleave them, and direction of travel is only meaningful in order. */
export function sortEvents(events: readonly ManagementEvent[]): ManagementEvent[] {
  return [...events].sort((a, b) => a.at.localeCompare(b.at));
}

/** What the stop actually did, from the record rather than from memory.
 *
 *  Direction matters: for a long, a HIGHER stop is closer to entry and
 *  therefore less risk; for a short it is the reverse. Getting this backwards
 *  would label discipline as recklessness and vice versa, which is worse than
 *  not measuring it — so the sign is applied once, here. */
export function analyzeStopMoves(
  entryStop: number,
  direction: 'LONG' | 'SHORT',
  events: readonly ManagementEvent[],
): StopAnalysis {
  const moves = sortEvents(events).filter(e => e.kind === 'stop' && Number.isFinite(e.to));
  if (!moves.length) return EMPTY;

  // For a long, "toward entry" means up. For a short, down.
  const dir = direction === 'SHORT' ? -1 : 1;

  let prev = entryStop;
  let advanced = 0;
  let widened  = 0;
  for (const m of moves) {
    const delta = (m.to - prev) * dir;
    if (delta > 0) advanced += 1;
    else if (delta < 0) widened += 1;
    // A move to the same level is not a move. Recorded, ignored.
    prev = m.to;
  }

  const verdict: StopVerdict =
    widened > 0 && advanced > 0 ? 'both'
    : widened > 0 ? 'widened'
    : advanced > 0 ? 'advanced'
    : 'none';

  return { verdict, moves: moves.length, widened, advanced, finalStop: prev };
}

/** The single answer the detector reads, and where it came from.
 *
 *  `both` collapses to `widened` for the detector: a trade where the stop was
 *  advanced once and pulled back once still contains the act being measured,
 *  and treating it as clean because something good also happened would let
 *  every widening be cancelled by a preceding advance. The full analysis is
 *  still available for the evidence view, which is where the nuance belongs. */
export function resolveStopMoved(
  entryStop: number,
  direction: 'LONG' | 'SHORT',
  events: readonly ManagementEvent[] | null | undefined,
  reported: 'none' | 'advanced' | 'widened' | undefined,
): { value: 'none' | 'advanced' | 'widened' | undefined; source: 'recorded' | 'reported' | 'none' } {
  if (events && events.some(e => e.kind === 'stop')) {
    const a = analyzeStopMoves(entryStop, direction, events);
    const value = a.verdict === 'both' ? 'widened' : a.verdict;
    return { value, source: 'recorded' };
  }
  if (reported) return { value: reported, source: 'reported' };
  return { value: undefined, source: 'none' };
}

/** Contracts closed through partials, for reconciling against the exit legs. */
export function partialContracts(events: readonly ManagementEvent[]): number {
  return events
    .filter(e => e.kind === 'partial' && Number.isFinite(e.contracts ?? NaN))
    .reduce((sum, e) => sum + (e.contracts ?? 0), 0);
}
