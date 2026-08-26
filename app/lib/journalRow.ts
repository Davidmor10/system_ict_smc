// ─────────────────────────────────────────────────────────────────────────────
// The journal_trades row, and the two translations either side of it.
//
// Pure. No Supabase client, no auth, no request — just the shape the database
// stores, and how it maps to and from the TradeEntry the app works in.
//
// Extracted from the route because it is no longer only the route's business.
// The mirror reconciler reads journal rows directly in order to compare them
// against what the analysis layer holds, and a lib module importing a route
// handler to borrow a type would drag the whole request pipeline with it.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  TradeEntry, Symbol, Direction, TradeResult, Bias,
  Setup, BiasAlignment, TradeExit, EmotionalState,
} from './journal';

export type TradeRow = {
  id: number;
  clerk_id: string;
  date_iso: string;
  time_val: string;
  symbol: string;
  contracts: number | null;
  direction: string;
  entry: number;
  stop_price: number;
  target: number;
  session: string;
  bias: string;
  model: string;
  result: string;
  notes: string;
  account_id: string | null;
  setup: string | null;
  bias_alignment: string | null;
  trade_r: number | null;
  pnl_usd: number | null;
  screenshots: string[] | null;
  /** Generated column — whether `screenshots` is a non-empty array. Present so
   *  the intelligence layer can answer "did they screenshot this trade" without
   *  pulling megabytes of base64 across the wire. Optional: a database that
   *  hasn't run the migration simply doesn't return it. */
  has_screenshot?: boolean | null;
  exits: TradeExit[] | null;
  confirmations: string[] | null;
  emotional_state: string | null;
  followed_rules: boolean | null;
  stop_moved: string | null;
  stop_note: string | null;
  management: unknown[] | null;
  deleted_at: string | null;
  updated_at: string | null;
};

export function rowToTrade(row: TradeRow): TradeEntry & { deletedAt: string | null } {
  return {
    id: row.id,
    dateISO: row.date_iso,
    time: row.time_val,
    symbol: row.symbol as Symbol,
    contracts: row.contracts ?? 1,
    direction: row.direction as Direction,
    entry: row.entry,
    stop: row.stop_price,
    target: row.target,
    session: row.session,
    bias: row.bias as Bias,
    model: row.model,
    result: row.result as TradeResult,
    notes: row.notes,
    accountId: row.account_id ?? undefined,
    setup: (row.setup as Setup) ?? undefined,
    biasAlignment: (row.bias_alignment as BiasAlignment) ?? undefined,
    tradeR: row.trade_r ?? undefined,
    pnlUsd: row.pnl_usd ?? undefined,
    screenshots: row.screenshots ?? undefined,
    // Prefer the generated column; fall back to the blobs when they were
    // selected. Either way the answer is the same, and one of the two paths
    // does not cost an image library.
    hasScreenshot: row.has_screenshot ?? ((row.screenshots?.length ?? 0) > 0),
    exits: row.exits ?? undefined,
    confirmations: row.confirmations ?? undefined,
    emotionalState: (row.emotional_state as EmotionalState) ?? undefined,
    // `?? undefined` and not `|| undefined`: false is a real answer.
    followedRules: row.followed_rules ?? undefined,
    stopMoved: (row.stop_moved as TradeEntry['stopMoved']) ?? undefined,
    stopNote: row.stop_note ?? undefined,
    management: (row.management as TradeEntry['management']) ?? undefined,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : undefined,
    deletedAt: row.deleted_at,
  };
}

export function tradeToRow(clerkId: string, trade: TradeEntry): TradeRow {
  return {
    id: trade.id,
    clerk_id: clerkId,
    date_iso: trade.dateISO,
    time_val: trade.time,
    symbol: trade.symbol,
    contracts: trade.contracts ?? 1,
    direction: trade.direction,
    entry: trade.entry,
    stop_price: trade.stop,
    target: trade.target,
    session: trade.session,
    bias: trade.bias,
    model: trade.model,
    result: trade.result,
    notes: trade.notes,
    account_id: trade.accountId ?? null,
    setup: trade.setup ?? null,
    bias_alignment: trade.biasAlignment ?? null,
    trade_r: trade.tradeR ?? null,
    pnl_usd: trade.pnlUsd ?? null,
    screenshots: trade.screenshots ?? null,
    exits: trade.exits ?? null,
    confirmations: trade.confirmations ?? null,
    emotional_state: trade.emotionalState ?? null,
    followed_rules: typeof trade.followedRules === 'boolean' ? trade.followedRules : null,
    stop_moved: trade.stopMoved ?? null,
    stop_note: trade.stopNote ?? null,
    management: trade.management ?? null,
    deleted_at: null,
    updated_at: trade.updatedAt ? new Date(trade.updatedAt).toISOString() : new Date().toISOString(),
  };
}
