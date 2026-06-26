// ─────────────────────────────────────────────────────────────────────────────
// Journal Data Layer — single source of truth for logged trades.
//
// Every premium analytics feature (Daily Loss Lockout, Model Performance, Edge
// Analytics, Prop Firm Mode) reads from this module so they can never disagree
// about the trade set, the PnL math, or the win-rate definition.
//
// The on-disk format is forward-compatible: older records (logged before `model`
// and `dateISO` existed) are repaired on load by `migrateTrade`, so adding new
// analytics never requires the user to re-enter history.
// ─────────────────────────────────────────────────────────────────────────────

export type Bias = 'BULLISH' | 'BEARISH' | 'INDECISIVE';

// ── Core types ───────────────────────────────────────────────────────────────

export type TradeResult = 'OPEN' | 'WIN' | 'LOSS' | 'BE';
export type Symbol = 'ES' | 'NQ';
export type Direction = 'LONG' | 'SHORT';
export type Setup = 'REVERSAL' | 'CONTINUATION';
export type IFVGConfirmation = 'IFVG_1M' | 'IFVG_2M' | 'IFVG_3M' | 'IFVG_5M';
export type BiasAlignment = 'ALIGNED' | 'COUNTER';

/** Free-text setup/model tag the trader assigns to a trade (their own naming). */
export type IctModel = string;

/** A single journaled trade. Optional fields were added after launch. */
export interface TradeEntry {
  id: number;
  /** Local calendar day the trade was logged, `YYYY-MM-DD`. Drives daily stats. */
  dateISO: string;
  /** Wall-clock entry time, `HH:mm`. */
  time: string;
  symbol: Symbol;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  session: string;
  bias: Bias;
  /** ICT setup model — enables per-model performance analytics. */
  model: IctModel;
  result: TradeResult;
  notes: string;
  /** Prop-firm account this trade belongs to (Prop Firm Mode). */
  accountId?: string;
  /** Setup type: reversal (liquidity sweep + flip) or continuation (gap entry). */
  setup?: Setup;
  /** IFVG timeframe used for confirmation (1M / 2M / 3M / 5M). */
  confirmation?: IFVGConfirmation;
  /** Whether direction aligns with the day's bias. Auto-computed on submit. */
  biasAlignment?: BiasAlignment;
  /** Realized R multiple: WIN=planned R, LOSS=−1, BE=0, OPEN=0. */
  tradeR?: number;
  /** Realized PnL in USD for 1 standard contract. */
  pnlUsd?: number;
}

// ── Trash / Soft-delete ──────────────────────────────────────────────────────

export interface DeletedTradeEntry {
  trade: TradeEntry;
  deletedAt: string;
}

const TRASH_KEY = 'onyx_journal_trash';

export function loadTrash(): DeletedTradeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRASH_KEY);
    if (!raw) return [];
    const items: DeletedTradeEntry[] = JSON.parse(raw);
    return items;
  } catch {
    return [];
  }
}

export function saveTrash(items: DeletedTradeEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRASH_KEY, JSON.stringify(items));
  } catch { /* non-fatal */ }
}

export function softDelete(trades: TradeEntry[], id: number): {
  updatedTrades: TradeEntry[];
  updatedTrash: DeletedTradeEntry[];
} {
  const trade = trades.find(t => t.id === id);
  if (!trade) return { updatedTrades: trades, updatedTrash: loadTrash() };
  const updatedTrades = trades.filter(t => t.id !== id);
  const updatedTrash = [{ trade, deletedAt: new Date().toISOString() }, ...loadTrash()];
  saveTrades(updatedTrades);
  saveTrash(updatedTrash);
  return { updatedTrades, updatedTrash };
}

export function restoreTrade(trades: TradeEntry[], trash: DeletedTradeEntry[], id: number): {
  updatedTrades: TradeEntry[];
  updatedTrash: DeletedTradeEntry[];
} {
  const item = trash.find(i => i.trade.id === id);
  if (!item) return { updatedTrades: trades, updatedTrash: trash };
  const updatedTrades = [item.trade, ...trades].sort((a, b) => b.id - a.id);
  const updatedTrash = trash.filter(i => i.trade.id !== id);
  saveTrades(updatedTrades);
  saveTrash(updatedTrash);
  return { updatedTrades, updatedTrash };
}

export function emptyTrash(): void {
  saveTrash([]);
}

/** @deprecated Trash entries no longer expire — kept for API compatibility. */
export function daysUntilExpiry(_deletedAt: string): number {
  return Infinity;
}

// ── Persistence ──────────────────────────────────────────────────────────────

export const JOURNAL_KEY = 'fractal_engine_journal';

/** Local calendar day as `YYYY-MM-DD`, matching the user's wall clock. */
export function todayISO(): string {
  return toLocalISO(new Date());
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const VALID_RESULTS: TradeResult[] = ['OPEN', 'WIN', 'LOSS', 'BE'];

/**
 * Repair one raw record into a complete `TradeEntry`. Back-fills fields that did
 * not exist when older trades were saved:
 *   • `dateISO` ← derived from the `id` (a `Date.now()` timestamp at creation).
 *   • `model`   ← 'Unspecified'.
 * Returns `null` for a record too malformed to use (so one bad row can't poison
 * the whole journal).
 */
export function migrateTrade(raw: unknown): TradeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'number' ? r.id : Date.now();
  const entry = Number(r.entry);
  const stop = Number(r.stop);
  const target = Number(r.target);
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return null;

  const result = VALID_RESULTS.includes(r.result as TradeResult) ? (r.result as TradeResult) : 'OPEN';
  const model =
    typeof r.model === 'string' && r.model.length > 0 ? (r.model as IctModel) : 'Unspecified';
  const dateISO =
    typeof r.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)
      ? r.dateISO
      : toLocalISO(new Date(id));

  const symbol: Symbol    = r.symbol === 'NQ' ? 'NQ' : 'ES';
  const direction: Direction = r.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const bias: Bias        = (r.bias as Bias) ?? 'INDECISIVE';

  // Backward-compat: compute derived fields if missing.
  const setupVal: Setup = (r.setup === 'REVERSAL' || r.setup === 'CONTINUATION')
    ? r.setup : 'REVERSAL';
  const confirmVal: IFVGConfirmation =
    (['IFVG_1M','IFVG_2M','IFVG_3M','IFVG_5M'] as IFVGConfirmation[]).includes(r.confirmation as IFVGConfirmation)
    ? r.confirmation as IFVGConfirmation : 'IFVG_2M';

  const isBullBias = bias === 'BULLISH';
  const isBearBias = bias === 'BEARISH';
  const alignment: BiasAlignment =
    (isBullBias && direction === 'LONG') || (isBearBias && direction === 'SHORT')
      ? 'ALIGNED' : 'COUNTER';

  const risk = Math.abs(entry - stop);
  const dir  = direction === 'LONG' ? 1 : -1;
  const ptVal = symbol === 'NQ' ? 20 : 50;
  const plannedR = risk > 0 ? ((target - entry) * dir) / risk : 0;
  const tradeR: number =
    result === 'WIN'  ? plannedR :
    result === 'LOSS' ? -1 :
    0;
  const pnlUsd: number =
    result === 'WIN'  ? tradeR * ptVal :
    result === 'LOSS' ? -risk * ptVal :
    0;

  return {
    id,
    dateISO,
    time: typeof r.time === 'string' ? r.time : '',
    symbol,
    direction,
    entry,
    stop,
    target,
    session: typeof r.session === 'string' ? r.session : 'NONE',
    bias,
    model,
    result,
    notes: typeof r.notes === 'string' ? r.notes : '',
    accountId: typeof r.accountId === 'string' ? r.accountId : undefined,
    setup: setupVal,
    confirmation: confirmVal,
    biasAlignment: typeof r.biasAlignment === 'string' ? r.biasAlignment as BiasAlignment : alignment,
    tradeR: typeof r.tradeR === 'number' ? r.tradeR : tradeR,
    pnlUsd: typeof r.pnlUsd === 'number' ? r.pnlUsd : pnlUsd,
  };
}

/** Read + migrate the journal from localStorage. Safe on the server (returns []). */
export function loadTrades(): TradeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrateTrade).filter((t): t is TradeEntry => t !== null);
  } catch {
    return [];
  }
}

export function saveTrades(trades: TradeEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(trades));
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

// ── PnL & statistics ─────────────────────────────────────────────────────────

/** CME standard point values per 1 standard contract. */
export const PT_VALUE: Record<Symbol, number> = { ES: 50, NQ: 20 };

/** Realized PnL in USD for one standard contract; null for still-open trades. */
export function tradePnL(t: TradeEntry): number | null {
  if (t.result === 'OPEN') return null;
  if (t.result === 'BE') return 0;
  const dir = t.direction === 'LONG' ? 1 : -1;
  const exit = t.result === 'WIN' ? t.target : t.stop;
  return (exit - t.entry) * dir * PT_VALUE[t.symbol];
}

/** Planned reward-to-risk of a trade (target distance / stop distance). */
export function rMultiple(t: TradeEntry): number | null {
  const risk = Math.abs(t.entry - t.stop);
  if (risk === 0) return null;
  const dir = t.direction === 'LONG' ? 1 : -1;
  const reward = (t.target - t.entry) * dir;
  return reward / risk;
}

export interface TradeStats {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPnL: number;
  avgR: number;
}

/** Aggregate realized performance across a set of trades. */
export function computeStats(trades: TradeEntry[]): TradeStats {
  const closed = trades.filter((t) => t.result !== 'OPEN');
  const wins = closed.filter((t) => t.result === 'WIN').length;
  const losses = closed.filter((t) => t.result === 'LOSS').length;
  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : 0;

  const pnls = closed.map(tradePnL).filter((n): n is number => n !== null);
  const grossWin = pnls.filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((n) => n < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const totalPnL = pnls.reduce((a, b) => a + b, 0);

  const rs = closed.map(rMultiple).filter((n): n is number => n !== null);
  const avgR = rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;

  return { count: trades.length, wins, losses, winRate, profitFactor, totalPnL, avgR };
}

// ── Stats helpers for StatsView ─────────────────────────────────────────────

export interface GroupStats {
  winRate: number;
  tradeCount: number;
  totalPnl: number;
  avgR: number;
  wins: number;
  losses: number;
}

export function statsByGroup(trades: TradeEntry[]): GroupStats {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins   = closed.filter(t => t.result === 'WIN').length;
  const losses = closed.filter(t => t.result === 'LOSS').length;
  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : 0;
  const totalPnl = closed.reduce((sum, t) => sum + (tradePnL(t) ?? 0), 0);
  const rs = closed
    .map(t => { const r = Math.abs(t.entry - t.stop); const dir = t.direction === 'LONG' ? 1 : -1; return r > 0 ? ((t.target - t.entry) * dir) / r : null; })
    .filter((r): r is number => r !== null);
  const avgR = rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  return { winRate, tradeCount: trades.length, totalPnl, avgR, wins, losses };
}

export function groupByKey<K extends string>(
  trades: TradeEntry[],
  keyOf: (t: TradeEntry) => K,
): Map<K, GroupStats> {
  const buckets = new Map<K, TradeEntry[]>();
  for (const t of trades) {
    const k = keyOf(t);
    const b = buckets.get(k);
    if (b) b.push(t); else buckets.set(k, [t]);
  }
  const result = new Map<K, GroupStats>();
  for (const [k, ts] of buckets) result.set(k, statsByGroup(ts));
  return result;
}

export interface RBucket { bucket: string; count: number; isWin: boolean }

export function rDistribution(trades: TradeEntry[]): RBucket[] {
  const BUCKETS: { label: string; min: number; max: number; isWin: boolean }[] = [
    { label: '<-1R',   min: -Infinity, max: -1,    isWin: false },
    { label: '-1R',    min: -1,        max: 0,     isWin: false },
    { label: '0–0.5R', min: 0,         max: 0.5,   isWin: false },
    { label: '0.5–1R', min: 0.5,       max: 1,     isWin: true  },
    { label: '1–2R',   min: 1,         max: 2,     isWin: true  },
    { label: '2–3R',   min: 2,         max: 3,     isWin: true  },
    { label: '>3R',    min: 3,         max: Infinity, isWin: true },
  ];
  const counts = new Map<string, number>(BUCKETS.map(b => [b.label, 0]));
  for (const t of trades) {
    if (t.result === 'OPEN') continue;
    const r = typeof t.tradeR === 'number' ? t.tradeR : (t.result === 'LOSS' ? -1 : 0);
    const bucket = BUCKETS.find(b => r >= b.min && r < b.max);
    if (bucket) counts.set(bucket.label, (counts.get(bucket.label) ?? 0) + 1);
  }
  return BUCKETS.map(b => ({ bucket: b.label, count: counts.get(b.label) ?? 0, isWin: b.isWin }));
}

export function statsByHour(trades: TradeEntry[]): Map<number, GroupStats> {
  return groupByKey(trades, t => {
    const h = parseInt(t.time.slice(0, 2), 10);
    return String(Number.isFinite(h) ? h : 0) as string;
  }) as unknown as Map<number, GroupStats>;
}

/** Group trades by an arbitrary key, e.g. session, model, or day of week. */
export function groupBy<K extends string>(
  trades: TradeEntry[],
  keyOf: (t: TradeEntry) => K,
): Map<K, TradeEntry[]> {
  const map = new Map<K, TradeEntry[]>();
  for (const t of trades) {
    const k = keyOf(t);
    const bucket = map.get(k);
    if (bucket) bucket.push(t);
    else map.set(k, [t]);
  }
  return map;
}

// ── Daily Loss Limit Lockout ─────────────────────────────────────────────────
// Discipline guard: once the day's damage hits a user-set ceiling, the journal
// locks to break the revenge-trading loop. Two independent triggers — a loss
// COUNT and an absolute dollar drawdown — either of which fires the lockout.

export interface LockoutConfig {
  enabled: boolean;
  /** Lock after this many losing trades today (0 = disabled). */
  maxLosses: number;
  /** Lock after today's realized PnL falls to −this many USD (0 = disabled). */
  maxDailyLossUsd: number;
}

export const LOCKOUT_KEY = 'fractal_engine_lockout';

export const DEFAULT_LOCKOUT: LockoutConfig = {
  enabled: true,
  maxLosses: 3,
  maxDailyLossUsd: 0,
};

export function loadLockoutConfig(): LockoutConfig {
  if (typeof window === 'undefined') return DEFAULT_LOCKOUT;
  try {
    const raw = window.localStorage.getItem(LOCKOUT_KEY);
    if (!raw) return DEFAULT_LOCKOUT;
    const s = JSON.parse(raw) as Partial<LockoutConfig>;
    return {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_LOCKOUT.enabled,
      maxLosses: Number.isFinite(s.maxLosses) ? Number(s.maxLosses) : DEFAULT_LOCKOUT.maxLosses,
      maxDailyLossUsd: Number.isFinite(s.maxDailyLossUsd)
        ? Number(s.maxDailyLossUsd)
        : DEFAULT_LOCKOUT.maxDailyLossUsd,
    };
  } catch {
    return DEFAULT_LOCKOUT;
  }
}

export function saveLockoutConfig(config: LockoutConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCKOUT_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export type LockoutReason = 'losses' | 'dailyLoss';

export interface LockoutState {
  locked: boolean;
  reasons: LockoutReason[];
  lossesToday: number;
  pnlToday: number;
}

/**
 * Evaluate the lockout against *today's* closed trades. Pure: pass the trade set
 * and config, get back whether trading should be halted and why.
 */
export function evaluateLockout(
  trades: TradeEntry[],
  config: LockoutConfig,
  day: string = todayISO(),
): LockoutState {
  const todays = trades.filter((t) => t.dateISO === day);
  const lossesToday = todays.filter((t) => t.result === 'LOSS').length;
  const pnlToday = todays
    .map(tradePnL)
    .filter((n): n is number => n !== null)
    .reduce((a, b) => a + b, 0);

  const reasons: LockoutReason[] = [];
  if (config.enabled) {
    if (config.maxLosses > 0 && lossesToday >= config.maxLosses) reasons.push('losses');
    if (config.maxDailyLossUsd > 0 && pnlToday <= -config.maxDailyLossUsd) reasons.push('dailyLoss');
  }

  return { locked: reasons.length > 0, reasons, lossesToday, pnlToday };
}
