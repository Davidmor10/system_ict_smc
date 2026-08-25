// ─────────────────────────────────────────────────────────────────────────────
// The plan against the execution — and how promptly any of it gets written
// down.
//
// Everything else in this pipeline measures a trader against their own
// baseline: this session versus your other sessions, this setup versus your
// other setups. None of it ever asked the question a journal exists for —
// how much of what you planned do you actually take.
//
// The number was in every row the whole time. `rr_planned` is the
// reward-to-risk the trade was TAKEN for; `r_multiple` is what it returned.
// Both were mirrored, and nothing read the pair.
//
// The second half is a habit, not an outcome: how many trades get written down
// the day they happened. Late logging is not a mistake, and this must never be
// phrased as one. It is measured because it travels with the days a trader
// would rather not look at — which is a claim the numbers can settle instead
// of the coach asserting it.
//
// Pure. Rows in, numbers out.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';

export interface PlanExecution {
  /** Decided trades that carried both a plan and an outcome. */
  n: number;
  /** Average planned reward-to-risk across them. */
  avgPlanned: number;
  /** Average realised R across them. */
  avgRealised: number;
  /** Realised as a share of planned, 0–100+. The headline: "you take 62% of
   *  what you plan". Above 100 is real and means winners ran past target. */
  capturePct: number;
  /** Winners that closed short of the level they were taken for. The
   *  behaviour layer counts the act per trade; this is the shape of it. */
  shortOfTarget: number;
}

export interface LoggingHabit {
  n: number;
  /** Share written down on the day they happened, 0–100. */
  sameDayPct: number;
  /** The longest gap in the window, in days — one trade written up a fortnight
   *  later is a different fact from a steady one-day lag. */
  maxLagDays: number;
}

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Null when nothing in the window carried both halves — a capture rate built
 *  on two trades is a number that will be quoted and should not exist. */
export function computePlanExecution(trades: readonly TradeRow[], minTrades = 4): PlanExecution | null {
  const usable = trades.filter(t =>
    !t.deleted_at
    && DECIDED.has(t.result)
    && typeof t.rr_planned === 'number' && t.rr_planned > 0
    && typeof t.r_multiple === 'number' && Number.isFinite(t.r_multiple));
  if (usable.length < minTrades) return null;

  const plannedSum  = usable.reduce((a, t) => a + (t.rr_planned as number), 0);
  const realisedSum = usable.reduce((a, t) => a + (t.r_multiple as number), 0);
  const shortOfTarget = usable.filter(t =>
    t.result === 'WIN' && (t.r_multiple as number) < (t.rr_planned as number) - 0.1).length;

  return {
    n: usable.length,
    avgPlanned:  round(plannedSum / usable.length),
    avgRealised: round(realisedSum / usable.length),
    // Guarded: a planned sum of zero cannot happen given the filter above, but
    // a divide that can produce Infinity has no business reaching a prompt.
    capturePct: plannedSum > 0 ? round((realisedSum / plannedSum) * 100, 0) : 0,
    shortOfTarget,
  };
}

/** How promptly the journal gets filled. `created_at` is when the row was
 *  written, `date` is the day it happened. */
export function computeLoggingHabit(trades: readonly TradeRow[], minTrades = 4): LoggingHabit | null {
  const alive = trades.filter(t => !t.deleted_at && typeof t.created_at === 'string');
  if (alive.length < minTrades) return null;

  let sameDay = 0;
  let maxLag = 0;
  for (const t of alive) {
    const logged = Date.parse(t.created_at);
    const happened = Date.parse(`${t.date}T00:00:00Z`);
    if (!Number.isFinite(logged) || !Number.isFinite(happened)) continue;
    const lagDays = Math.floor((logged - happened) / 86_400_000);
    // A negative lag means the row predates the day it is filed under — a
    // back-dated correction, not a habit. Ignored rather than counted as
    // promptness the trader did not earn.
    if (lagDays < 0) continue;
    if (lagDays === 0) sameDay += 1;
    if (lagDays > maxLag) maxLag = lagDays;
  }

  return {
    n: alive.length,
    sameDayPct: Math.round((sameDay / alive.length) * 100),
    maxLagDays: maxLag,
  };
}
