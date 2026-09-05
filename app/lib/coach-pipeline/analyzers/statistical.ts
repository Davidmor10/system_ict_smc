// ─────────────────────────────────────────────────────────────────────────────
// Statistical computer — the deterministic pillar of the Rolling Profile.
//
// Given a list of TradeRow, returns the Statistical object exactly as designed
// in Step 2. NO AI. NO NETWORK. NO ASYNC. Pure function of its input.
//
// The whole point: this file is the guarantee that "Claude will never see
// invented numbers." The narrative + behavioral layers can ONLY cite what
// this computer produced.
//
// Rules baked in:
//   - "Decided trades" = result ∈ {WIN, LOSS, BE}. OPEN is ignored throughout.
//   - Wins count as: WIN with r_multiple > 0 (BE and losses excluded).
//     A WIN with r_multiple <= 0 (rare, but possible in bad data) is still a win.
//   - by_session: only sessions with n >= 5 (Step 2 §1 rule)
//   - by_setup:   top 5 by sample size
//   - by_symbol:  top 3 by sample size
//   - last_7d trend: compare avg_r of last 7d vs the 7d before.
//     up if diff > +0.10R, down if diff < -0.10R, else flat.
//
// Design note: the token cap of the profile is enforced at write-time
// (tokens.ts), not here. This computer just returns the natural shape; the
// caller decides whether to shrink `by_setup` further if it's blowing the cap.
// In practice the caps here (5 setups, 3 symbols) keep it well under 200 tok.
// ─────────────────────────────────────────────────────────────────────────────

import type { StatBucket, Statistical, TradeRow } from '../types';
import { MIN_DECIDED_FOR_CLAIM } from '../../stats/evidence';
import { meanDiffFloor } from '../../stats/movement';

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

/** Bucket aggregate for by_session / by_setup / by_symbol. */
interface Bucket { n: number; wins: number; rSum: number; }
const emptyBucket = (): Bucket => ({ n: 0, wins: 0, rSum: 0 });

/** A count is a fact at any size; a RATE is not.
 *
 *  `by_setup` and `by_symbol` were built at a minimum sample of ONE, so a
 *  setup tried once and won showed up as `wr: 1.00` — and the note's own style
 *  rules forbid the model from hedging about a value it was handed. Below the
 *  shared claim floor the bucket now carries only how many trades it holds,
 *  which is true, and the prompt's glossary already reads an absent field as
 *  "not computed". */
function finish(b: Bucket): StatBucket {
  if (b.n < MIN_DECIDED_FOR_CLAIM) return { n: b.n };
  return { n: b.n, wr: round2(b.wins / b.n), r: round2(b.rSum / b.n) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum of pnl for a bucket — used only for the top-level P&L stats, not for
 *  the per-bucket breakdowns (which use R, not $). */
function isWin(t: TradeRow): boolean {
  return t.result === 'WIN' && (t.r_multiple ?? 0) > 0;
}

/** Days between two 'YYYY-MM-DD' strings (Israel-time already; no TZ math). */
function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later}T12:00:00Z`);
  const b = Date.parse(`${earlier}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

/** ISO date string for `daysAgo` days before `today` — used for the 7-day
 *  windows. Both `today` and the returned value are 'YYYY-MM-DD'. */
export function shiftDate(today: string, daysAgo: number): string {
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - daysAgo);
  return t.toISOString().slice(0, 10);
}

/** Top-N buckets by sample size. Ties broken by higher R. Returns a keyed
 *  object exactly as Statistical expects — an empty input yields undefined
 *  (not an empty object) so the JSON stays compact. */
function topN(
  raw: Map<string, Bucket>,
  n: number,
  minSampleSize: number,
): Record<string, StatBucket> | undefined {
  const filtered = [...raw.entries()].filter(([, b]) => b.n >= minSampleSize);
  if (!filtered.length) return undefined;
  filtered.sort(([, a], [, b]) => b.n - a.n || b.rSum / b.n - a.rSum / a.n);
  const kept = filtered.slice(0, n);
  const out: Record<string, StatBucket> = {};
  for (const [key, b] of kept) out[key] = finish(b);
  return out;
}

/** Current streak: positive = consecutive wins from most recent trade,
 *  negative = consecutive losses. BE breaks a streak. Uses the most recent
 *  decided trades in reverse chronological order. */
function currentStreak(sortedDecidedNewestFirst: TradeRow[]): number {
  if (!sortedDecidedNewestFirst.length) return 0;
  const first = sortedDecidedNewestFirst[0];
  if (first.result === 'BE') return 0;
  const winRun = first.result === 'WIN';
  let count = 0;
  for (const t of sortedDecidedNewestFirst) {
    const isW = t.result === 'WIN';
    const isL = t.result === 'LOSS';
    if (winRun && isW) count += 1;
    else if (!winRun && isL) count += 1;
    else break;
  }
  return winRun ? count : -count;
}

/** Peak-to-trough max drawdown of the running cumulative $ P&L. Returns 0
 *  when no losses have occurred. Value is negative (drawdown). */
function maxDrawdownUsd(sortedByDateAscending: TradeRow[]): number {
  let peak    = 0;
  let cum     = 0;
  let maxDd   = 0;
  for (const t of sortedByDateAscending) {
    cum += t.pnl_usd ?? 0;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < maxDd) maxDd = dd;
  }
  return Math.round(maxDd);
}

/** Trend classification for last_7d vs. the 7d before it.
 *
 *  A FIXED TENTH OF AN R DECIDED THIS, on two windows that are often three or
 *  four trades each. R multiples are spread over several R, so two windows
 *  drawn from an unchanged distribution land more than 0.10 apart about nine
 *  times in ten — simulated at every window size from one trade to twenty, it
 *  never fell below 81%. The note is then written by a model whose style rules
 *  forbid it from hedging about a value it was handed.
 *
 *  The floor now comes from how far apart the trades themselves landed, the
 *  same rule the weekly comparison uses. Returns null — not 'flat' — when
 *  neither window can carry a direction, so the field is omitted rather than
 *  asserting stability that was not measured either. */
function trendOf(curr: readonly number[], prev: readonly number[]): 'up' | 'down' | 'flat' | null {
  if (curr.length === 0 || prev.length === 0) return null;
  const mean = (a: readonly number[]) => a.reduce((s, r) => s + r, 0) / a.length;
  const sd = (a: readonly number[], m: number) =>
    (a.length > 1 ? Math.sqrt(a.reduce((s, r) => s + (r - m) ** 2, 0) / (a.length - 1)) : null);
  const mc = mean(curr), mp = mean(prev);
  const floor = meanDiffFloor(0.10, { n: curr.length, sd: sd(curr, mc) }, { n: prev.length, sd: sd(prev, mp) });
  if (!Number.isFinite(floor)) return null;
  const diff = mc - mp;
  if (diff >  floor) return 'up';
  if (diff < -floor) return 'down';
  return 'flat';
}

/** Options for compute (mainly for testability — pass a fixed `today` so
 *  snapshot tests aren't wall-clock-dependent). */
export interface ComputeOptions {
  /** 'YYYY-MM-DD' Israel today; defaults to real today in Israel. */
  today?: string;
}

function israelToday(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());   // 'YYYY-MM-DD'
}

/** Main entry: turn all a user's trades (all-time) into a Statistical blob
 *  ready to be stored as `user_profile.statistical`. Pure and cheap —
 *  runs in a few ms for thousands of trades. */
export function computeStatistical(
  trades: readonly TradeRow[],
  opts: ComputeOptions = {},
): Statistical {
  const today = opts.today ?? israelToday();

  const decided = trades.filter(t => !t.deleted_at && DECIDED.has(t.result));
  if (decided.length === 0) return { n: 0 };

  // Top-level aggregates
  let wins       = 0;
  let sumR       = 0;
  let sumPnlPos  = 0;  // gross wins in $
  let sumPnlNeg  = 0;  // gross losses in $ (absolute value)
  let sumPnl     = 0;
  for (const t of decided) {
    if (isWin(t)) wins += 1;
    sumR += t.r_multiple ?? 0;
    const p = t.pnl_usd ?? 0;
    sumPnl += p;
    if (p > 0) sumPnlPos += p;
    else       sumPnlNeg += -p;
  }
  const n     = decided.length;
  const wr    = round2(wins / n);
  const avgR  = round2(sumR / n);
  const pf    = sumPnlNeg > 0 ? round2(sumPnlPos / sumPnlNeg) : 0;
  const expUsd = Math.round(sumPnl / n);

  // Buckets
  const bySession = new Map<string, Bucket>();
  const bySetup   = new Map<string, Bucket>();
  const bySymbol  = new Map<string, Bucket>();
  for (const t of decided) {
    const w = isWin(t) ? 1 : 0;
    const r = t.r_multiple ?? 0;
    const put = (m: Map<string, Bucket>, key: string) => {
      const b = m.get(key) ?? emptyBucket();
      b.n += 1; b.wins += w; b.rSum += r;
      m.set(key, b);
    };
    if (t.session) put(bySession, t.session);
    if (t.setup)   put(bySetup,   t.setup);
    if (t.symbol)  put(bySymbol,  t.symbol);
  }

  // Order matters for streak + drawdown
  const asc  = [...decided].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const desc = [...asc].reverse();

  // last_7d and the window before it
  const from7  = shiftDate(today, 6);      // today .. 7d
  const from14 = shiftDate(today, 13);     // 7d before that .. day before from7
  const to14   = shiftDate(today, 7);
  const last7  = decided.filter(t => t.date >= from7  && t.date <= today);
  const prev7  = decided.filter(t => t.date >= from14 && t.date <= to14);
  // The previous window's mean is no longer computed here: `trendOf` takes the
  // trades themselves now, because the floor depends on how far apart they
  // landed and a mean has thrown that away.
  const last7Sum   = last7.reduce((s, t) => s + (t.r_multiple ?? 0), 0);
  const last7Wins  = last7.filter(isWin).length;

  const out: Statistical = {
    n,
    wr,
    avg_r:      avgR,
    pf,
    exp_usd:    expUsd,
    max_dd_usd: maxDrawdownUsd(asc),
    streak_now: currentStreak(desc),
  };

  const bs = topN(bySession, 20, 5);   // sessions cap: no per-N cap, only sample-size
  if (bs) out.by_session = bs;
  const bp = topN(bySetup, 5, 1);      // top 5 setups by n
  if (bp) out.by_setup = bp;
  const by = topN(bySymbol, 3, 1);     // top 3 symbols by n
  if (by) out.by_symbol = by;

  if (last7.length > 0) {
    const rsOf = (ts: TradeRow[]) => ts.map(t => t.r_multiple ?? 0);
    const trend = trendOf(rsOf(last7), rsOf(prev7));
    // Same rule as every other bucket: the count stands, the rates need the
    // floor under them, and a trend that could not be measured is left out.
    out.last_7d = {
      ...finish({ n: last7.length, wins: last7Wins, rSum: last7Sum }),
      ...(trend ? { trend } : {}),
    };
  }

  return out;
}

// ── Exports for tests (internal helpers) ────────────────────────────────────
export const __internals = {
  currentStreak, maxDrawdownUsd, trendOf, topN, daysBetween, shiftDate,
};
