import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import type {
  TradeEntry, Symbol, Direction, TradeResult, Bias,
  Setup, IFVGConfirmation, BiasAlignment,
} from '../../lib/journal';

type TradeRow = {
  id: number;
  clerk_id: string;
  date_iso: string;
  time_val: string;
  symbol: string;
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
  confirmation: string | null;
  bias_alignment: string | null;
  trade_r: number | null;
  pnl_usd: number | null;
  deleted_at: string | null;
};

export function rowToTrade(row: TradeRow): TradeEntry & { deletedAt: string | null } {
  return {
    id: row.id,
    dateISO: row.date_iso,
    time: row.time_val,
    symbol: row.symbol as Symbol,
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
    confirmation: (row.confirmation as IFVGConfirmation) ?? undefined,
    biasAlignment: (row.bias_alignment as BiasAlignment) ?? undefined,
    tradeR: row.trade_r ?? undefined,
    pnlUsd: row.pnl_usd ?? undefined,
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
    confirmation: trade.confirmation ?? null,
    bias_alignment: trade.biasAlignment ?? null,
    trade_r: trade.tradeR ?? null,
    pnl_usd: trade.pnlUsd ?? null,
    deleted_at: null,
  };
}

/** GET /api/journal — returns all trades (active + trash) for the current user. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ trades: [] });

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('journal_trades')
    .select('*')
    .eq('clerk_id', userId)
    .order('id', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: (data ?? []).map(rowToTrade) });
}

/** POST /api/journal — upsert a single trade. Body: TradeEntry (JSON). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const trade: TradeEntry = await req.json();
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .upsert(tradeToRow(userId, trade), { onConflict: 'clerk_id,id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** PUT /api/journal — bulk upsert (used for initial localStorage → cloud migration). */
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const { trades }: { trades: TradeEntry[] } = await req.json();
  if (!Array.isArray(trades) || trades.length === 0) return NextResponse.json({ ok: true });

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .upsert(trades.map(t => tradeToRow(userId, t)), { onConflict: 'clerk_id,id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
