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

import { type InstrumentKey, isKnownInstrument, pointValue } from './instruments';
import {
  calcPnL, calcRR,
  calcMultiExitPnL, calcMultiExitRealizedR, calcWeightedExitPrice,
} from './calc/trade';
import { mergeById, active, type Syncable } from './sync/merge';
import type { ManagementEvent } from './trade/management';
import { computeBiasAlignment } from './dailyBias';

export type Bias = 'BULLISH' | 'BEARISH' | 'INDECISIVE';

// ── Core types ───────────────────────────────────────────────────────────────

export type TradeResult = 'OPEN' | 'WIN' | 'LOSS' | 'BE';
/** Instrument key — kept in sync with lib/instruments.ts, the single source of truth for specs. */
export type Symbol = InstrumentKey;
export type Direction = 'LONG' | 'SHORT';
export type Setup = 'REVERSAL' | 'CONTINUATION';
/** @deprecated superseded by ConfirmationTag/`confirmations[]` — kept only so old
    records (which always had this defaulted to a fixed placeholder) keep loading. */
export type IFVGConfirmation = 'IFVG_1M' | 'IFVG_2M' | 'IFVG_3M' | 'IFVG_5M';
export type BiasAlignment = 'ALIGNED' | 'COUNTER';

/** Built-in entry-confirmation tags. The trader isn't limited to these — the
    form lets them define their own, so `confirmations` is stored as free
    `string[]`; this union only documents the defaults every account starts with. */
export type ConfirmationTag = 'SMT' | 'IFVG' | 'CISD' | 'ORDER_BLOCK';

/** Single-select emotional state at entry — feeds emotion-vs-performance analysis. */
export type EmotionalState = 'CALM' | 'CONFIDENT' | 'STRESSED' | 'FOMO' | 'TIRED' | 'ANGRY' | 'IMPATIENT';

/** One partial (or full) exit out of a position. A trade can have zero (still
    OPEN), one, or several — real trading rarely closes a whole position at a
    single price. */
export interface TradeExit {
  price: number;
  contracts: number;
}

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
  /** Number of contracts traded. Drives gross PnL — never asked as a separate dollar amount. */
  contracts: number;
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
  /** Chart screenshots attached to this trade, as data URLs. */
  screenshots?: string[];
  /** Partial/full exits. Absent or empty = still OPEN. `result`/`tradeR`/`pnlUsd`
      are computed from this once at save time — nothing downstream re-derives
      them from `exits`, so this field is optional purely for old-record compat. */
  exits?: TradeExit[];
  /** Multi-select confirmation tags present at entry — built-in or trader-defined. */
  confirmations?: string[];
  /** Trader's emotional state right before entering. */
  emotionalState?: EmotionalState;
  /** Did this trade follow the rules the trader set for themselves?
   *
   *  Three states, and the third is the important one. `true` and `false` are
   *  the trader's own verdict — the most trustworthy signal in the journal,
   *  because it is judgement rather than inference. `undefined` means they
   *  didn't answer, and that is NOT the same as "yes": treating silence as
   *  compliance is how a rule-adherence metric becomes a flattering fiction. */
  followedRules?: boolean;
  /** What happened to the stop after entry.
   *
   *  Three answers and not two, because "moved the stop" merges the two
   *  opposite behaviours in trade management: advancing it to protect a
   *  position is discipline, widening it to avoid being stopped out is the
   *  thing that empties accounts. A boolean would count them together and any
   *  detector built on it would be measuring nothing. */
  stopMoved?: 'none' | 'advanced' | 'widened';
  /** What happened between entry and exit, each with the moment it happened.
   *
   *  The journal keeps one stop value — the one true at the last save — so a
   *  stop widened at 10:42 was indistinguishable from a stop that was always
   *  there, and everything a trader did mid-trade was invisible. These are the
   *  record; `stopMoved` above is the recollection. Both are kept, and the
   *  system never merges them into one number that hides which it is using. */
  management?: ManagementEvent[];
  /** Server-side only: whether this trade has screenshots, without carrying
   *  them. Never written by the form, and stripped by validation on the way
   *  back up — it exists so the analysis layer can stop reading the images. */
  hasScreenshot?: boolean;
  /** Epoch-ms of the last edit. Set by saveTrades when a trade's content
      changes; drives the cross-device newest-wins merge on hydration. */
  updatedAt?: number;
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

/** Best-effort mirror of a soft-delete/restore to the cloud copy — local
    storage stays the source of truth regardless of whether this succeeds. */
function syncTrashStateToCloud(id: number, method: 'DELETE' | 'PATCH'): void {
  if (typeof window === 'undefined') return;
  fetch(`/api/journal/${id}`, { method }).catch(() => {});
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
  syncTrashStateToCloud(id, 'DELETE');
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
  syncTrashStateToCloud(id, 'PATCH');
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

/** Sentinel for "no model/setup tag chosen" — shown in the UI and used to
    exclude untagged trades from confirmation analytics. Trades saved before
    the app went Hebrew-only stored the English literal "Unspecified"; treat
    it the same as empty so old journals pick up the Hebrew label too. */
export const UNSPECIFIED_MODEL = 'לא צוין';

/**
 * Repair one raw record into a complete `TradeEntry`. Back-fills fields that did
 * not exist when older trades were saved:
 *   • `dateISO` ← derived from the `id` (a `Date.now()` timestamp at creation).
 *   • `model`   ← UNSPECIFIED_MODEL.
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
    typeof r.model === 'string' && r.model.length > 0 && r.model !== 'Unspecified'
      ? (r.model as IctModel)
      : UNSPECIFIED_MODEL;
  const dateISO =
    typeof r.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)
      ? r.dateISO
      : toLocalISO(new Date(id));

  const symbol: Symbol = typeof r.symbol === 'string' && isKnownInstrument(r.symbol) ? r.symbol : 'ES';
  const contracts = Number(r.contracts);
  const contractsVal = Number.isFinite(contracts) && contracts > 0 ? contracts : 1;
  const direction: Direction = r.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const bias: Bias        = (r.bias as Bias) ?? 'INDECISIVE';

  // Backward-compat: compute derived fields if missing.
  const setupVal: Setup = (r.setup === 'REVERSAL' || r.setup === 'CONTINUATION')
    ? r.setup : 'REVERSAL';
  const confirmVal: IFVGConfirmation =
    (['IFVG_1M','IFVG_2M','IFVG_3M','IFVG_5M'] as IFVGConfirmation[]).includes(r.confirmation as IFVGConfirmation)
    ? r.confirmation as IFVGConfirmation : 'IFVG_2M';

  // One implementation, shared with the form. These had drifted into
  // opposites: this one called a trade with no declared bias COUNTER, while
  // the form called the same situation ALIGNED — so the same trade meant
  // different things depending on whether it had just been saved or just been
  // loaded. Both are now null, which is what "no direction was declared"
  // actually is.
  const alignment = computeBiasAlignment(bias, direction);

  const risk = Math.abs(entry - stop);
  const dir  = direction === 'LONG' ? 1 : -1;
  const ptVal = pointValue(symbol);

  // Exits survive normalization. They used to be dropped here — the form
  // collected them, saved them, and the very next load erased them, taking
  // the only record of where the trade ACTUALLY closed with it.
  const exits = Array.isArray(r.exits)
    ? (r.exits as unknown[])
        .map(e => {
          const x = e as Record<string, unknown>;
          return { price: Number(x?.price), contracts: Number(x?.contracts) };
        })
        .filter(e => Number.isFinite(e.price) && Number.isFinite(e.contracts) && e.contracts > 0)
    : [];
  const hasExits = exits.length > 0;

  // MEASURED, then remembered, then assumed — in that order.
  //
  // The plan-derived branch below says a win banked exactly its target and a
  // loss gave back exactly its stop. That is not what happened; it is what was
  // supposed to happen. Every dollar figure in the product inherited it, and
  // no analysis could ever detect a deviation from a plan, because the record
  // WAS the plan.
  //
  // When exits exist they are recomputed rather than trusted: a stored tradeR
  // may be a legacy plan-derived value, or stale after the trade was edited.
  const realizedR   = hasExits ? calcMultiExitRealizedR(entry, stop, exits, direction) : null;
  const realizedPnl = hasExits ? calcMultiExitPnL(entry, exits, direction, symbol)     : null;

  const plannedR = risk > 0 ? ((target - entry) * dir) / risk : 0;
  const assumedR: number =
    result === 'WIN'  ? plannedR :
    result === 'LOSS' ? -1 :
    0;
  const assumedPnl: number =
    result === 'WIN'  ? assumedR * ptVal * contractsVal :
    result === 'LOSS' ? -risk * ptVal * contractsVal :
    0;

  const tradeR = realizedR   ?? (typeof r.tradeR === 'number' ? r.tradeR : assumedR);
  const pnlUsd = realizedPnl ?? (typeof r.pnlUsd === 'number' ? r.pnlUsd : assumedPnl);

  return {
    id,
    dateISO,
    time: typeof r.time === 'string' ? r.time : '',
    symbol,
    contracts: contractsVal,
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
    biasAlignment: typeof r.biasAlignment === 'string' ? r.biasAlignment as BiasAlignment : (alignment ?? undefined),
    tradeR,
    pnlUsd,
    screenshots: Array.isArray(r.screenshots) ? r.screenshots.filter((s): s is string => typeof s === 'string') : undefined,
    // These three were being discarded on every load. The form collects them,
    // the analytics layer reads them, and nothing in between kept them alive —
    // so confirmations and emotional state were permanently null downstream,
    // which reads as "the trader never logs a confirmation" rather than as
    // "we threw it away".
    exits: hasExits ? exits : undefined,
    confirmations: Array.isArray(r.confirmations)
      ? r.confirmations.filter((c): c is string => typeof c === 'string')
      : undefined,
    emotionalState: typeof r.emotionalState === 'string'
      ? r.emotionalState as EmotionalState
      : undefined,
    followedRules: typeof r.followedRules === 'boolean' ? r.followedRules : undefined,
    stopMoved: r.stopMoved === 'none' || r.stopMoved === 'advanced' || r.stopMoved === 'widened'
      ? r.stopMoved : undefined,
    management: Array.isArray(r.management)
      ? (r.management as unknown[])
          .map(e => e as ManagementEvent)
          .filter(e => typeof e?.at === 'string'
            && (e.kind === 'stop' || e.kind === 'target' || e.kind === 'partial')
            && Number.isFinite(e.to))
      : undefined,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : undefined,
  };
}

// ── Cloud sync ───────────────────────────────────────────────────────────────
// localStorage has always been the fast, source-of-truth read path (see
// loadTrades below), but nothing ever actually pushed those trades up to
// Supabase — the /api/journal PUT/POST routes existed and worked, but no
// client code called them. Every server-side feature that reads trades via
// clerk_id (cross-device sync, the Trader Intelligence System) saw zero
// trades for any user whose data lived only in their browser. This pushes
// the local journal to the cloud whenever it changes, and opportunistically
// catches up stale/legacy local data on load — best-effort, never blocks
// or breaks the local read/write path if the network call fails.

const CLOUD_SYNC_KEY = 'onyx_last_cloud_sync';
const CLOUD_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000; // throttle only the load-time catch-up, not real writes
let cloudSyncInFlight = false;

function pushTradesToCloud(trades: TradeEntry[], opts: { throttle: boolean }): void {
  if (typeof window === 'undefined' || trades.length === 0 || cloudSyncInFlight) return;
  if (opts.throttle) {
    const last = Number(window.localStorage.getItem(CLOUD_SYNC_KEY) ?? 0);
    if (Date.now() - last < CLOUD_SYNC_MIN_INTERVAL_MS) return;
  }
  cloudSyncInFlight = true;
  fetch('/api/journal', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades }),
  })
    .then(res => { if (res.ok) window.localStorage.setItem(CLOUD_SYNC_KEY, String(Date.now())); })
    .catch(() => { /* best-effort — local storage remains the source of truth */ })
    .finally(() => { cloudSyncInFlight = false; });
}

/** Read + migrate the journal from localStorage. Safe on the server (returns []).
    Also opportunistically syncs to the cloud (throttled) so trades that were
    only ever saved locally eventually reach Supabase. */
export function loadTrades(): TradeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const trades = parsed.map(migrateTrade).filter((t): t is TradeEntry => t !== null);
    pushTradesToCloud(trades, { throttle: true });
    return trades;
  } catch {
    return [];
  }
}

/** Content signature that ignores updatedAt — so a save only bumps the stamp of
    trades whose actual content changed, not every trade on every write. */
function tradeSig(t: TradeEntry): string {
  const { updatedAt: _u, ...rest } = t;
  return JSON.stringify(rest);
}

/** Assigns updatedAt=now to trades that are new or whose content changed vs the
    currently-stored copy; unchanged trades keep their existing stamp. */
function stampChanged(trades: TradeEntry[]): TradeEntry[] {
  const prev = new Map<number, string>();
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) for (const t of arr) prev.set(t.id, tradeSig(t));
  } catch { /* ignore */ }
  const now = Date.now();
  return trades.map(t => {
    const unchanged = typeof t.updatedAt === 'number' && prev.get(t.id) === tradeSig(t);
    return unchanged ? t : { ...t, updatedAt: now };
  });
}

export function saveTrades(trades: TradeEntry[]): void {
  if (typeof window === 'undefined') return;
  const stamped = stampChanged(trades);
  try {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(stamped));
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
  pushTradesToCloud(stamped, { throttle: false });
}

/** Writes trades to localStorage WITHOUT re-stamping — used by hydration, whose
    trades already carry the authoritative updatedAt from the merge. */
function writeTradesLocal(trades: TradeEntry[]): void {
  try { window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(trades)); } catch { /* non-fatal */ }
}

/** Cross-device hydration: pull every trade from Supabase, merge with the local
    cache (newest updatedAt wins, deduped by id, cloud deletes propagate), write
    the visible result back to localStorage, and push anything the cloud was
    missing. Returns the visible trades. Never throws — falls back to the local
    cache on any failure. This is the fix for "journal empties on a new device":
    loadTrades() only ever read localStorage; nothing pulled the cloud down. */
export async function hydrateTradesFromCloud(): Promise<TradeEntry[]> {
  if (typeof window === 'undefined') return [];
  const local = loadTrades();
  let cloud: (TradeEntry & { deletedAt?: string | null })[];
  try {
    const res = await fetch('/api/journal');
    if (!res.ok) return local;
    const data = await res.json().catch(() => ({}));
    cloud = Array.isArray(data?.trades) ? data.trades : [];
  } catch {
    return local;
  }

  type S = Syncable & { trade: TradeEntry };
  const localS: S[] = local.map(t => ({ id: t.id, updatedAt: t.updatedAt ?? 0, deleted: false, trade: t }));
  const cloudS: S[] = cloud.map(t => ({
    id: t.id,
    updatedAt: t.updatedAt ?? 0,
    deleted: !!t.deletedAt,
    trade: t,
  }));

  const merged = mergeById(localS, cloudS);
  const visible = active(merged).map(m => {
    const { deletedAt: _d, ...clean } = m.trade as TradeEntry & { deletedAt?: string | null };
    return clean as TradeEntry;
  });

  writeTradesLocal(visible);
  // Seed/repair the cloud with anything only local had (best-effort).
  pushTradesToCloud(visible, { throttle: false });
  return visible;
}

// ── PnL & statistics ─────────────────────────────────────────────────────────
// Gross PnL is always derived from instrument spec × contracts (lib/instruments.ts +
// lib/calc/trade.ts) — never from a manually-entered dollar amount.

/** Realized PnL in USD, contract-size aware; null for still-open trades. */
export function tradePnL(t: TradeEntry): number | null {
  if (t.result === 'OPEN') return null;
  if (t.result === 'BE') return 0;
  const exit = t.result === 'WIN' ? t.target : t.stop;
  return calcPnL(t.entry, exit, t.direction, t.symbol, t.contracts || 1);
}

/** Planned reward-to-risk of a trade (target distance / stop distance). */
export function rMultiple(t: TradeEntry): number | null {
  return calcRR(t.entry, t.stop, t.target);
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
