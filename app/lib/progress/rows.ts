// ─────────────────────────────────────────────────────────────────────────────
// The journey, one row per behaviour.
//
// Pure. No AI, no network, no async.
//
// WHY ROWS AND NOT SECTIONS
//
// The first version grouped behaviours by stage — working / changed / watching
// — which is the right shape for an open-ended list. This list is not open
// ended: the detector taxonomy is exactly five kinds and has been since it was
// written. Grouping five things into three buckets put each behaviour in one
// bucket and scattered its history into a log at the bottom of the page, so a
// trader asking "what happened with my early exits" read three places.
//
// It also made a behaviour that was never detected disappear, and that is a
// real loss: the system having looked at something and found nothing is
// information, and it is the only thing that tells a trader what the system
// actually watches.
//
// So every kind gets a row, always, including the ones that never fired.
//
// AND THE FIVE ARE NOT EVERYTHING
//
// A trader's real problem may be none of them. It already has a home — the
// rules they wrote themselves, and the tick on the trade form saying which one
// they broke. That data has been collected for weeks and never had a screen.
// It arrives here as rows of the same shape, marked as the trader's own, and
// carrying the same denominator: breaches out of the trades they graded.
//
// They are NOT given a lifecycle stage. The stages mean something specific —
// confirmed on a sample that could have said no, an experiment with
// guardrails — and none of that machinery has run on a self-reported rule. A
// row that borrowed the vocabulary without the evidence behind it would be the
// same lie as a neutral 50.
// ─────────────────────────────────────────────────────────────────────────────

import { stageOf, type Stage } from './journey';

/** Which way a behaviour is moving, comparing the recent window against the
 *  whole history — the same pair the improvement verdict is judged on. */
export type Trend = 'improving' | 'worsening' | 'steady' | 'unknown';

/** How far apart the two rates must be before it is called movement.
 *
 *  Four points on a rate is inside the noise of a twenty-opportunity window,
 *  and a row that flickers between improving and worsening every night is a
 *  row a trader stops reading. */
const TREND_EPSILON = 0.04;

export function trendOf(
  historicalRate: number | null | undefined,
  rollingRate: number | null | undefined,
  rollingN: number | null | undefined,
): Trend {
  if (historicalRate == null || rollingRate == null) return 'unknown';
  // A rolling window with almost nothing in it is not a direction.
  if ((rollingN ?? 0) < 5) return 'unknown';
  const diff = rollingRate - historicalRate;
  if (Math.abs(diff) < TREND_EPSILON) return 'steady';
  // The rate is of a mistake, so down is better.
  return diff < 0 ? 'improving' : 'worsening';
}

export const TREND_LABELS: Record<Trend, string> = {
  improving: 'פוחת',
  worsening: 'גובר',
  steady:    'ללא שינוי',
  unknown:   'אין מספיק לאחרונה',
};

/** One line of the trader's record. */
export interface JourneyRow {
  kind: string;
  label: string;
  /** 'builtin' — one of the detectors. 'rule' — a rule the trader wrote. */
  source: 'builtin' | 'rule';
  /** Null for a kind that has never been detected, and for every rule row. */
  status: string | null;
  stage: Stage | 'undetected';
  occurrences: number;
  opportunities: number;
  /** Null when there were no opportunities to divide by. */
  rate: number | null;
  trend: Trend;
  historicalRate: number | null;
  rollingRate: number | null;
  isPrimary: boolean;
  relapses: number;
  /** The open window, when this row has one. */
  window: { what: string; done: number; of: number } | null;
  /** The judged experiment, when this row has one. */
  result: {
    verdict: string; before: number; after: number;
    historicalImproved: boolean; rollingImproved: boolean; broken: string[];
  } | null;
  firstDetectedAt: string | null;
  lastSeenAt: string | null;
  /** This row's own history, newest first. */
  events: Array<{ at: string; to: string; reason: string }>;
}

/** The part of the record a row belongs to.
 *
 *  'undetected' is its own value rather than a missing one: a kind that has
 *  never fired is not in an early stage of the process, it is outside it. */
export function stageFor(status: string | null): Stage | 'undetected' {
  return status === null ? 'undetected' : stageOf(status);
}

/** How the rows are ordered.
 *
 *  An open window first — it is the one thing the trader is being counted on
 *  right now. Then whatever is furthest along, because a behaviour close to a
 *  verdict is more interesting than one just noticed. Undetected kinds sink,
 *  and the trader's own rules sit after the detectors, since the detectors
 *  carry evidence the rules do not. */
const STAGE_RANK: Record<string, number> = {
  experiment: 0, monitoring: 0,
  confirmed: 1, investigating: 2, detected: 3,
  improved: 4, resolved: 5,
  archived: 6,
};

export function sortRows(rows: JourneyRow[]): JourneyRow[] {
  return [...rows].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
    if ((a.window !== null) !== (b.window !== null)) return a.window ? -1 : 1;
    if ((a.status === null) !== (b.status === null)) return a.status === null ? 1 : -1;
    const sa = a.status ? STAGE_RANK[a.status] ?? 9 : 9;
    const sb = b.status ? STAGE_RANK[b.status] ?? 9 : 9;
    if (sa !== sb) return sa - sb;
    return b.occurrences - a.occurrences;
  });
}

/** What a row with no detection yet should say.
 *
 *  Not "no problem found" — the denominator may simply be empty, and those are
 *  different facts. The wording turns on whether there was anything to look
 *  at. */
export function undetectedNote(opportunities: number): string {
  return opportunities > 0
    ? `נבדק ב-${opportunities} הזדמנויות ולא נמצא כדפוס חוזר.`
    : 'עוד לא היו עסקאות שמאפשרות לבדוק את זה.';
}
