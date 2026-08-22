// ─────────────────────────────────────────────────────────────────────────────
// Everything the statistics screen shows, derived from one array of trades.
//
// The screen asks one question six ways: is the edge real, and is it being
// executed. Nothing here calls an AI, reads the network, or knows what a
// component looks like — the page renders this object and nothing else, so
// every figure on screen traces to one function in this file.
//
// Not to be confused with `analytics/performance.ts`, which summarises trades
// for the AI stacks. This module exists for the screen: it carries display
// concerns the analysers do not need (day series, sparkline windows, an index)
// and it never feeds a prompt.
//
// Two rules run through all of it, and they are why this is not a direct port
// of the design prototype's `buildStats`:
//
//   An unanswered question is not a negative answer. The prototype's ledger
//   had `rulesFull: boolean` on every trade because it generated its own data.
//   A real journal has trades where the trader never said. Those leave the
//   denominator rather than joining the failures — see `adherence`.
//
//   A component that cannot be measured is dropped, not scored zero. The Edge
//   Score renormalizes over whatever is measurable and reports what it left
//   out. A trader with no losing trades yet has no risk-control score; giving
//   them 0 would be a worse lie than giving them 100.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { tradePnL, rMultiple, plannedRR } from '../journal';
import { chronological, expectancy, streaks, planVsExecution, completeness } from './journalStats';
import type { Expectancy, Streaks, PlanVsExecution, Completeness } from './journalStats';
import { SESS, sessionTable, type SessionDef } from '../sessions';
import { MIN_DECIDED_FOR_CLAIM, MIN_DECIDED_FOR_CONFIRMED } from '../stats/evidence';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ── the day series ──────────────────────────────────────────────────────────

export interface DayPoint {
  dateISO: string;
  /** Dollars won or lost that day. */
  pnl: number;
  /** Account equity at the close of that day. */
  equity: number;
  /** Highest equity reached on or before this day. */
  peak: number;
  trades: number;
}

export interface DaySeries {
  days: DayPoint[];
  start: number;
  /** Equity at the close of the last day, or `start` when there are no days. */
  end: number;
  peak: number;
  /** Deepest fall from a running peak, in dollars and as a share of that peak. */
  maxDrawdown: number;
  maxDrawdownPct: number;
  /** Longest run of consecutive trading days spent below the running peak. */
  drawdownDays: number;
  best: number;
  worst: number;
  green: number;
  red: number;
  avgDay: number;
}

/** Trades collapsed into calendar days, with equity carried forward.
 *
 *  Days, not trades, because drawdown is a fact about an account and an
 *  account has one value per day. A per-trade curve reports intraday swings
 *  the trader never actually sat through, which makes the worst number on the
 *  page — the one that decides whether they keep trading — larger than the
 *  thing it claims to measure. */
export function daySeries(trades: readonly TradeEntry[], start: number): DaySeries {
  const byDay = new Map<string, { pnl: number; trades: number }>();
  for (const t of chronological(trades)) {
    const d = byDay.get(t.dateISO) ?? { pnl: 0, trades: 0 };
    d.pnl += tradePnL(t) ?? 0;
    d.trades += 1;
    byDay.set(t.dateISO, d);
  }

  const days: DayPoint[] = [];
  let equity = start, peak = start, maxDD = 0, below = 0, drawdownDays = 0;

  for (const dateISO of Array.from(byDay.keys()).sort()) {
    const d = byDay.get(dateISO)!;
    equity += d.pnl;
    if (equity >= peak) {
      peak = equity;
      drawdownDays = Math.max(drawdownDays, below);
      below = 0;
    } else {
      below += 1;
    }
    maxDD = Math.max(maxDD, peak - equity);
    days.push({ dateISO, pnl: round2(d.pnl), equity: round2(equity), peak: round2(peak), trades: d.trades });
  }
  drawdownDays = Math.max(drawdownDays, below);

  const pnls = days.map(d => d.pnl);
  return {
    days,
    start,
    end: days.length ? days[days.length - 1].equity : start,
    peak: round2(peak),
    maxDrawdown: round2(maxDD),
    maxDrawdownPct: peak > 0 ? round2((maxDD / peak) * 100) : 0,
    drawdownDays,
    best: pnls.length ? Math.max(...pnls) : 0,
    worst: pnls.length ? Math.min(...pnls) : 0,
    green: pnls.filter(p => p > 0).length,
    red: pnls.filter(p => p < 0).length,
    avgDay: days.length ? round2(sum(pnls) / days.length) : 0,
  };
}

// ── groups ──────────────────────────────────────────────────────────────────

export interface GroupStat {
  key: string;
  label: string;
  n: number;
  wins: number;
  losses: number;
  pnl: number;
  /** Null below the evidence floor: a rate off three trades is a number, not a
   *  win rate, and printing it invites a decision it cannot support. */
  winRate: number | null;
}

const SESSION_LABEL: Record<string, string> = Object.fromEntries(SESS.map(s => [s.key, s.he]));
const WEEKDAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/** The futures week. Always rendered, even at zero — an empty Friday is itself
 *  information, and a row that appears and disappears between visits reads as
 *  a bug. */
const CORE_WEEKDAYS = [1, 2, 3, 4, 5];

function groupBy(
  trades: readonly TradeEntry[],
  keyOf: (t: TradeEntry) => string,
  alwaysShow: string[],
  labelOf: (key: string) => string,
): GroupStat[] {
  const m = new Map<string, GroupStat>();
  const touch = (key: string) => {
    if (!m.has(key)) m.set(key, { key, label: labelOf(key), n: 0, wins: 0, losses: 0, pnl: 0, winRate: null });
    return m.get(key)!;
  };
  for (const key of alwaysShow) touch(key);

  for (const t of chronological(trades)) {
    const g = touch(keyOf(t));
    g.n += 1;
    g.pnl += tradePnL(t) ?? 0;
    if (t.result === 'WIN') g.wins += 1;
    else if (t.result === 'LOSS') g.losses += 1;
  }

  return Array.from(m.values()).map(g => {
    const decided = g.wins + g.losses;
    return {
      ...g,
      pnl: round2(g.pnl),
      winRate: decided >= MIN_DECIDED_FOR_CLAIM ? round2(g.wins / decided) : null,
    };
  });
}

export function bySession(trades: readonly TradeEntry[], table: SessionDef[] = sessionTable()): GroupStat[] {
  // Anything that is not one of the four tracked windows collapses into a
  // single bucket. A trade logged at 03:00 and one whose session the form
  // never recognised are the same fact to a trader — "outside the sessions I
  // track" — and splitting them into one-trade rows would fill the panel with
  // noise shaped like data.
  const known = new Set<string>(table.map(s => s.key));
  return groupBy(
    trades,
    t => (t.session && known.has(t.session) ? t.session : 'other'),
    table.map(s => s.key),
    key => table.find(s => s.key === key)?.he ?? SESSION_LABEL[key] ?? 'מחוץ לסשן',
  ).filter(g => g.key !== 'other' || g.n > 0);
}

export function byWeekday(trades: readonly TradeEntry[]): GroupStat[] {
  const dayOf = (dateISO: string) => {
    const [y, m, d] = dateISO.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  };
  return groupBy(
    trades,
    t => String(dayOf(t.dateISO)),
    CORE_WEEKDAYS.map(String),
    key => WEEKDAY_HE[Number(key)],
  )
    .filter(g => g.n > 0 || CORE_WEEKDAYS.includes(Number(g.key)))
    .sort((a, b) => Number(a.key) - Number(b.key));
}

/** The group carrying the most profit — the one painted gold on screen.
 *
 *  Null when nothing is positive. "Best" among four losing sessions is a
 *  ranking, not a strength, and highlighting one in gold would tell the trader
 *  to do more of whatever lost them the least. */
export function bestGroup(groups: readonly GroupStat[]): GroupStat | null {
  const positive = groups.filter(g => g.n > 0 && g.pnl > 0);
  if (!positive.length) return null;
  return positive.reduce((a, b) => (b.pnl > a.pnl ? b : a));
}

// ── edge score ──────────────────────────────────────────────────────────────

export type EdgeKey = 'winRate' | 'rr' | 'consistency' | 'drawdown' | 'risk' | 'rules';

export interface EdgeComponent {
  key: EdgeKey;
  label: string;
  short: string;
  /** Weight as designed. When a component is unmeasurable the remaining
   *  weights scale up; `effectiveWeight` is what actually applied. */
  weight: number;
  effectiveWeight: number;
  /** 0–100, or null when the journal cannot answer this yet. */
  score: number | null;
  /** Why it is null. Shown to the trader verbatim. */
  missing?: string;
}

export type EdgeBand = 'strong' | 'solid' | 'developing';

export interface EdgeScore {
  components: EdgeComponent[];
  /** Null when nothing at all is measurable. */
  score: number | null;
  band: EdgeBand | null;
  measured: number;
  total: number;
}

const EDGE_DEF: Array<{ key: EdgeKey; label: string; short: string; weight: number }> = [
  { key: 'winRate',     label: 'אחוז הצלחה',      short: 'הצלחה',  weight: 0.15 },
  { key: 'rr',          label: 'סיכון / סיכוי',   short: 'R:R',    weight: 0.20 },
  { key: 'consistency', label: 'עקביות',          short: 'עקביות', weight: 0.20 },
  { key: 'drawdown',    label: 'ירידה מקסימלית',  short: 'ירידה',  weight: 0.20 },
  { key: 'risk',        label: 'בקרת סיכון',      short: 'סיכון',  weight: 0.15 },
  { key: 'rules',       label: 'עמידה בכללים',    short: 'כללים',  weight: 0.10 },
];

/** The weighted quality model, with its arithmetic in the open.
 *
 *  The normalizations are the design's, unchanged — each maps a realistic band
 *  of its metric onto 0–100 and clamps outside it. They are arbitrary in the
 *  way every index is arbitrary, which is exactly why the screen prints each
 *  component's weight and raw score beside the total. */
export function edgeScore(input: {
  winRate: number | null;
  avgRR: number | null;
  bestShare: number | null;
  drawdownPct: number;
  avgLossR: number | null;
  adherence: number | null;
  hasDays: boolean;
}): EdgeScore {
  const raw: Record<EdgeKey, { score: number | null; missing?: string }> = {
    winRate: input.winRate == null
      ? { score: null, missing: 'צריך עסקאות סגורות' }
      : { score: Math.round(clamp01((input.winRate - 0.33) / 0.34) * 100) },
    rr: input.avgRR == null
      ? { score: null, missing: 'צריך גם עסקה מרוויחה וגם מפסידה' }
      : { score: Math.round(clamp01((input.avgRR - 0.9) / 2.3) * 100) },
    consistency: input.bestShare == null
      ? { score: null, missing: 'נמדד רק כשהרווח הכולל חיובי' }
      : { score: Math.round(clamp01(1 - (input.bestShare - 0.02) / 0.34) * 100) },
    drawdown: input.hasDays
      ? { score: Math.round(clamp01(1 - (input.drawdownPct - 0.8) / 18) * 100) }
      : { score: null, missing: 'צריך לפחות יום מסחר אחד' },
    risk: input.avgLossR == null
      ? { score: null, missing: 'צריך לפחות עסקה מפסידה אחת' }
      : { score: Math.round(clamp01(1 - (input.avgLossR - 0.9) / 0.6) * 100) },
    rules: input.adherence == null
      ? { score: null, missing: 'אף עסקה לא נשאלה על הכללים' }
      : { score: Math.round(input.adherence * 100) },
  };

  const measurableWeight = sum(EDGE_DEF.filter(d => raw[d.key].score != null).map(d => d.weight));
  const components: EdgeComponent[] = EDGE_DEF.map(d => ({
    key: d.key,
    label: d.label,
    short: d.short,
    weight: d.weight,
    effectiveWeight: raw[d.key].score == null || measurableWeight === 0 ? 0 : d.weight / measurableWeight,
    score: raw[d.key].score,
    missing: raw[d.key].missing,
  }));

  const measured = components.filter(c => c.score != null).length;
  if (!measured) return { components, score: null, band: null, measured: 0, total: components.length };

  const score = round2(sum(components.map(c => c.effectiveWeight * (c.score ?? 0))));
  return {
    components,
    score,
    band: score >= 80 ? 'strong' : score >= 65 ? 'solid' : 'developing',
    measured,
    total: components.length,
  };
}

// ── discipline ──────────────────────────────────────────────────────────────

export interface Adherence {
  /** Closed trades where the trader actually answered the question. */
  answered: number;
  followed: number;
  /** Followed over answered. Null when nothing was answered — NOT zero. */
  rate: number | null;
  /** Closed trades never asked, or logged before the field existed. */
  unanswered: number;
}

export function adherence(trades: readonly TradeEntry[]): Adherence {
  const closed = chronological(trades);
  const answered = closed.filter(t => typeof t.followedRules === 'boolean');
  const followed = answered.filter(t => t.followedRules === true).length;
  return {
    answered: answered.length,
    followed,
    rate: answered.length ? round2(followed / answered.length) : null,
    unanswered: closed.length - answered.length,
  };
}

// ── rolling series, for the sparklines ──────────────────────────────────────

/** `buckets` samples of a statistic over a trailing window.
 *
 *  A sparkline beside a headline number claims the number has a direction.
 *  With fewer trades than the floor every window is nearly the same window and
 *  the line is flat by construction — so below it this returns an empty array
 *  and the screen draws nothing, rather than a reassuring flat line. */
export function rollingSeries(
  trades: readonly TradeEntry[],
  stat: (window: TradeEntry[]) => number,
  buckets = 26,
): number[] {
  const closed = chronological(trades);
  if (closed.length < MIN_DECIDED_FOR_CLAIM) return [];
  const windowSize = Math.max(MIN_DECIDED_FOR_CLAIM, Math.floor(closed.length / buckets));
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const end = Math.round(((i + 1) / buckets) * closed.length);
    out.push(stat(closed.slice(Math.max(0, end - windowSize), end)));
  }
  return out;
}

const winRateOf = (w: TradeEntry[]) => {
  const decided = w.filter(t => t.result === 'WIN' || t.result === 'LOSS');
  return decided.length ? (decided.filter(t => t.result === 'WIN').length / decided.length) * 100 : 0;
};
const profitFactorOf = (w: TradeEntry[]) => {
  const pnls = w.map(tradePnL).filter((p): p is number => p != null);
  const gw = sum(pnls.filter(p => p > 0));
  const gl = Math.abs(sum(pnls.filter(p => p < 0)));
  return gl ? gw / gl : gw > 0 ? 3 : 0;
};
const avgRRof = (w: TradeEntry[]) => {
  const pnls = w.map(tradePnL).filter((p): p is number => p != null);
  const wins = pnls.filter(p => p > 0), losses = pnls.filter(p => p < 0);
  if (!wins.length || !losses.length) return 0;
  return (sum(wins) / wins.length) / Math.abs(sum(losses) / losses.length);
};
const expectancyOf = (w: TradeEntry[]) => {
  const pnls = w.map(tradePnL).filter((p): p is number => p != null);
  return pnls.length ? sum(pnls) / pnls.length : 0;
};

// ── one call ────────────────────────────────────────────────────────────────

export interface HeadlineStat {
  key: 'winRate' | 'avgRR' | 'profitFactor' | 'expectancy' | 'maxDrawdown';
  label: string;
  /** Null when the journal cannot answer it yet. */
  value: number | null;
  unit: 'percent' | 'ratio' | 'usd';
  spark: number[];
  tone: 'gold' | 'bull' | 'bear';
}

export interface RecentTrade {
  id: number;
  dateISO: string;
  time: string;
  symbol: string;
  direction: string;
  entry: number;
  /** Contract-weighted exit price, or null when no exit was ever logged. */
  exit: number | null;
  plannedR: number | null;
  realizedR: number | null;
  pnl: number | null;
  session: string;
  bias: string;
  /** True, false, or null for never answered — all three are rendered. */
  followedRules: boolean | null;
}

export interface PerformanceStats {
  /** Closed trades. The denominator for everything below. */
  n: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Still open — counted, never mixed into performance. */
  open: number;

  net: number;
  grossWin: number;
  grossLoss: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgRR: number | null;
  avgLossR: number | null;
  largestWin: number | null;
  returnPct: number;
  bestShare: number | null;

  headline: HeadlineStat[];
  equity: DaySeries;
  expectancy: Expectancy;
  streaks: Streaks;
  planVsReal: PlanVsExecution;
  completeness: Completeness;
  sessions: GroupStat[];
  weekdays: GroupStat[];
  bestSession: GroupStat | null;
  bestWeekday: GroupStat | null;
  adherence: Adherence;
  edge: EdgeScore;
  recent: RecentTrade[];

  /** Where this journal sits against the floors both AI stacks already use.
   *  The screen prints it rather than quietly deciding for the trader. */
  evidence: {
    decided: number;
    forClaim: number;
    forConfirmed: number;
    enoughForClaim: boolean;
    enoughForConfirmed: boolean;
  };
}

export function computeStatistics(
  allTrades: readonly TradeEntry[],
  accountStart: number,
  recentCount = 8,
): PerformanceStats {
  const closed = chronological(allTrades);
  const open = allTrades.filter(t => t.result === 'OPEN').length;

  const pnls = closed.map(tradePnL).filter((p): p is number => p != null);
  const winPnls = pnls.filter(p => p > 0);
  const lossPnls = pnls.filter(p => p < 0);
  const grossWin = round2(sum(winPnls));
  const grossLoss = round2(Math.abs(sum(lossPnls)));
  const net = round2(grossWin - grossLoss);

  const wins = closed.filter(t => t.result === 'WIN').length;
  const losses = closed.filter(t => t.result === 'LOSS').length;
  const breakeven = closed.filter(t => t.result === 'BE').length;
  const decided = wins + losses;

  const avgWin = winPnls.length ? round2(sum(winPnls) / winPnls.length) : null;
  const avgLoss = lossPnls.length ? round2(Math.abs(sum(lossPnls)) / lossPnls.length) : null;
  const avgRR = avgWin != null && avgLoss != null && avgLoss > 0 ? round2(avgWin / avgLoss) : null;

  const lossRs = closed
    .filter(t => t.result === 'LOSS')
    .map(rMultiple)
    .filter((r): r is number => r != null);
  const avgLossR = lossRs.length ? round2(Math.abs(sum(lossRs) / lossRs.length)) : null;

  const equity = daySeries(allTrades, accountStart);
  // Only meaningful once the account is actually up: a "best day share" of a
  // negative total is an arithmetic artefact, not a concentration measure.
  const bestShare = net > 0 ? round2(equity.best / net) : null;

  const winRate = decided ? round2(wins / decided) : null;
  const profitFactor = grossLoss > 0 ? round2(grossWin / grossLoss) : null;

  const sessions = bySession(allTrades);
  const weekdays = byWeekday(allTrades);
  const adh = adherence(allTrades);

  const headline: HeadlineStat[] = [
    {
      key: 'winRate', label: 'אחוז הצלחה', unit: 'percent', tone: 'gold',
      value: winRate == null ? null : round2(winRate * 100),
      spark: rollingSeries(allTrades, winRateOf),
    },
    {
      key: 'avgRR', label: 'יחס R:R ממוצע', unit: 'ratio', tone: 'gold',
      value: avgRR,
      spark: rollingSeries(allTrades, avgRRof),
    },
    {
      key: 'profitFactor', label: 'פקטור רווח', unit: 'ratio', tone: 'gold',
      value: profitFactor,
      spark: rollingSeries(allTrades, profitFactorOf),
    },
    {
      key: 'expectancy', label: 'תוחלת לעסקה', unit: 'usd', tone: 'bull',
      value: closed.length ? round2(net / closed.length) : null,
      spark: rollingSeries(allTrades, expectancyOf),
    },
    {
      key: 'maxDrawdown', label: 'ירידה מקסימלית', unit: 'percent', tone: 'bear',
      value: equity.days.length ? -equity.maxDrawdownPct : null,
      spark: equity.days.map(d => -((d.peak - d.equity) / (d.peak || 1)) * 100),
    },
  ];

  const recent: RecentTrade[] = closed.slice(-recentCount).reverse().map(t => {
    const legs = t.exits ?? [];
    const contracts = sum(legs.map(e => e.contracts));
    return {
      id: t.id,
      dateISO: t.dateISO,
      time: t.time,
      symbol: t.symbol,
      direction: t.direction,
      entry: t.entry,
      exit: contracts > 0 ? round2(sum(legs.map(e => e.price * e.contracts)) / contracts) : null,
      plannedR: plannedRR(t),
      realizedR: rMultiple(t),
      pnl: tradePnL(t),
      session: SESSION_LABEL[t.session] ?? '—',
      bias: t.bias,
      followedRules: typeof t.followedRules === 'boolean' ? t.followedRules : null,
    };
  });

  return {
    n: closed.length, wins, losses, breakeven, open,
    net, grossWin, grossLoss,
    winRate, profitFactor, avgWin, avgLoss, avgRR, avgLossR,
    largestWin: winPnls.length ? round2(Math.max(...winPnls)) : null,
    returnPct: accountStart > 0 ? round2((net / accountStart) * 100) : 0,
    bestShare,
    headline,
    equity,
    expectancy: expectancy(allTrades),
    streaks: streaks(allTrades),
    planVsReal: planVsExecution(allTrades),
    completeness: completeness(allTrades),
    sessions,
    weekdays,
    bestSession: bestGroup(sessions),
    bestWeekday: bestGroup(weekdays),
    adherence: adh,
    edge: edgeScore({
      winRate,
      avgRR,
      bestShare,
      drawdownPct: equity.maxDrawdownPct,
      avgLossR,
      adherence: adh.rate,
      hasDays: equity.days.length > 0,
    }),
    recent,
    evidence: {
      decided,
      forClaim: MIN_DECIDED_FOR_CLAIM,
      forConfirmed: MIN_DECIDED_FOR_CONFIRMED,
      enoughForClaim: decided >= MIN_DECIDED_FOR_CLAIM,
      enoughForConfirmed: decided >= MIN_DECIDED_FOR_CONFIRMED,
    },
  };
}
