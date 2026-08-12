// ─────────────────────────────────────────────────────────────────────────────
// Trade context — the circumstances a trade was taken UNDER.
//
// Pure. No AI, no network, no async.
//
// mistakes.ts answers "what did they do". This answers "what was true at the
// moment they did it", which is the only way to get from a count to a cause.
// Knowing a trader exits early 60% of the time is a statistic; knowing they
// exit early 70% of the time after a loss and 20% of the time after a win is
// the beginning of an explanation.
//
// Two kinds of dimension live here, and the difference matters:
//
//   Standing facts   — session, hour, direction, setup, symbol. Properties of
//                      the trade itself.
//   Antecedent state — what had already happened when the trade was taken:
//                      how the previous one ended, whether the day was up or
//                      down, whether this was the first trade or the fourth.
//
// The antecedent ones are where behavioural causes hide, and they are the
// reason this file needs the whole history in order in order to describe any
// single trade.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';
import { sortChronologically } from './mistakes';

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

export type PrevResult   = 'WIN' | 'LOSS' | 'BE' | 'none';
export type NthOfDay     = 'first' | 'later';
export type DayPnlBefore = 'up' | 'down' | 'flat';

export interface TradeContext {
  tradeId:      string;
  /* standing facts */
  session:      string;
  hourBucket:   string;
  direction:    string;
  setup:        string;
  symbol:       string;
  /* antecedent state */
  prevResult:   PrevResult;
  nthOfDay:     NthOfDay;
  dayPnlBefore: DayPnlBefore;
}

/** The dimensions step 2 crosses against each mistake. Order is the order
 *  they'll be reported in when two are equally strong, so the ones that
 *  suggest a behavioural cause come before the ones that merely describe the
 *  trade — "after a loss" is a more useful finding than "on NQ", and when
 *  both fit the data equally we should say the more useful one. */
export const CONTEXT_DIMENSIONS = [
  'prevResult',
  'dayPnlBefore',
  'nthOfDay',
  'session',
  'hourBucket',
  'direction',
  'setup',
  'symbol',
] as const;

export type ContextDimension = typeof CONTEXT_DIMENSIONS[number];

/** Hebrew labels for the dimensions, used when a finding is put into words. */
export const DIMENSION_LABELS: Record<ContextDimension, string> = {
  prevResult:   'תוצאת העסקה הקודמת',
  dayPnlBefore: 'מצב היום עד לאותו רגע',
  nthOfDay:     'מיקום בתוך היום',
  session:      'סשן',
  hourBucket:   'שעה',
  direction:    'כיוון',
  setup:        'סטאפ',
  symbol:       'מכשיר',
};

/** 'unknown' rather than null throughout: a missing session is a real group
 *  a trader can be told about ("your unlabelled trades behave differently"),
 *  and it keeps every dimension a plain string for the crosstab. */
const UNKNOWN = 'unknown';

function hourBucketOf(time: string | null): string {
  if (!time) return UNKNOWN;
  const m = /^(\d{1,2}):/.exec(time);
  if (!m) return UNKNOWN;
  const h = Number(m[1]);
  if (!Number.isInteger(h) || h < 0 || h > 23) return UNKNOWN;
  return `${String(h).padStart(2, '0')}:00`;
}

function prevResultOf(result: string | undefined): PrevResult {
  if (result === 'WIN' || result === 'LOSS' || result === 'BE') return result;
  return 'none';
}

/** Describe every decided trade in the history.
 *
 *  Antecedent state resets at each date boundary. A loss yesterday is part of
 *  a trader's week; it is not what they were carrying into their first trade
 *  this morning, and treating it as such would smear every "after a loss"
 *  finding across the overnight gap. */
export function buildContexts(trades: readonly TradeRow[]): Map<string, TradeContext> {
  const decided = sortChronologically(trades).filter(
    t => !t.deleted_at && DECIDED.has(t.result),
  );

  const out = new Map<string, TradeContext>();

  let currentDate  = '';
  let indexInDay   = 0;
  let pnlSoFar     = 0;
  let previous: TradeRow | null = null;

  for (const t of decided) {
    if (t.date !== currentDate) {
      currentDate = t.date;
      indexInDay  = 0;
      pnlSoFar    = 0;
      previous    = null;
    }

    const prevResult = prevResultOf(previous?.result);

    out.set(t.id, {
      tradeId:      t.id,
      session:      t.session   || UNKNOWN,
      hourBucket:   hourBucketOf(t.time),
      direction:    t.direction || UNKNOWN,
      setup:        t.setup     || UNKNOWN,
      symbol:       t.symbol    || UNKNOWN,
      prevResult,
      nthOfDay:     indexInDay === 0 ? 'first' : 'later',
      dayPnlBefore: pnlSoFar > 0 ? 'up' : pnlSoFar < 0 ? 'down' : 'flat',
    });

    indexInDay += 1;
    pnlSoFar   += t.pnl_usd ?? 0;
    previous    = t;
  }

  return out;
}

/** Read one dimension off a context. Keeps the crosstab in step 2 free of a
 *  switch over field names. */
export function dimensionValue(ctx: TradeContext, dim: ContextDimension): string {
  return ctx[dim];
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __internals = { hourBucketOf, prevResultOf };
