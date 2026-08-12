import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { tradeEntrySchema, tradesArraySchema } from '../../lib/validation';
import { logSecurityEvent } from '../../lib/securityLog';
import { checkRateLimit } from '../../lib/rateLimit';
import { logger } from '../../lib/logger';
import { mirrorTrades } from '../../lib/coach-pipeline/mirror/journalToIntelligence';

// Returns null (and never throws) on a malformed body — lets callers turn it
// into a clean 400 instead of an unhandled exception bubbling out of the route.
async function parseJsonBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
import type {
  TradeEntry, Symbol, Direction, TradeResult, Bias,
  Setup, IFVGConfirmation, BiasAlignment, TradeExit, EmotionalState,
} from '../../lib/journal';

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
  confirmation: string | null;
  bias_alignment: string | null;
  trade_r: number | null;
  pnl_usd: number | null;
  screenshots: string[] | null;
  exits: TradeExit[] | null;
  confirmations: string[] | null;
  emotional_state: string | null;
  followed_rules: boolean | null;
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
    confirmation: (row.confirmation as IFVGConfirmation) ?? undefined,
    biasAlignment: (row.bias_alignment as BiasAlignment) ?? undefined,
    tradeR: row.trade_r ?? undefined,
    pnlUsd: row.pnl_usd ?? undefined,
    screenshots: row.screenshots ?? undefined,
    exits: row.exits ?? undefined,
    confirmations: row.confirmations ?? undefined,
    emotionalState: (row.emotional_state as EmotionalState) ?? undefined,
    // `?? undefined` and not `|| undefined`: false is a real answer.
    followedRules: row.followed_rules ?? undefined,
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
    confirmation: trade.confirmation ?? null,
    bias_alignment: trade.biasAlignment ?? null,
    trade_r: trade.tradeR ?? null,
    pnl_usd: trade.pnlUsd ?? null,
    screenshots: trade.screenshots ?? null,
    exits: trade.exits ?? null,
    confirmations: trade.confirmations ?? null,
    emotional_state: trade.emotionalState ?? null,
    followed_rules: typeof trade.followedRules === 'boolean' ? trade.followedRules : null,
    deleted_at: null,
    updated_at: trade.updatedAt ? new Date(trade.updatedAt).toISOString() : new Date().toISOString(),
  };
}

/** GET /api/journal — returns all trades (active + trash) for the current user. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`journal:get:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/journal GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ trades: [] });

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('journal_trades')
    .select('*')
    .eq('clerk_id', userId)
    .order('id', { ascending: false });

  if (error) {
    logger.error('journal GET failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ trades: (data ?? []).map(rowToTrade) });
}

/** POST /api/journal — upsert a single trade. Body: TradeEntry (JSON). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`journal:post:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/journal POST', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const body = await parseJsonBody(req);
  if (body === null) {
    logSecurityEvent('validation_failed', { route: '/api/journal POST', userId, reason: 'invalid_json' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = tradeEntrySchema.safeParse(body);
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/journal POST', userId });
    return NextResponse.json({ error: 'Invalid trade payload', issues: parsed.error.issues }, { status: 400 });
  }
  const trade: TradeEntry = parsed.data;

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .upsert(tradeToRow(userId, trade), { onConflict: 'clerk_id,id' });

  if (error) {
    logger.error('journal POST failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Mirror into the intelligence pipeline. Awaited (not void) — on Vercel
  // serverless a fire-and-forget promise is torn down when the response
  // returns, so the write silently never happens. mirrorTrades swallows its
  // own errors, so awaiting can't fail the request; it just costs ~50ms.
  await mirrorTrades(userId, [trade]);

  return NextResponse.json({ ok: true });
}

/** PUT /api/journal — bulk upsert (used for initial localStorage → cloud migration). */
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal PUT' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`journal:put:${userId}`, 10, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/journal PUT', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const body = await parseJsonBody(req);
  if (body === null) {
    logSecurityEvent('validation_failed', { route: '/api/journal PUT', userId, reason: 'invalid_json' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawTrades = Array.isArray((body as { trades?: unknown })?.trades) ? (body as { trades: unknown[] }).trades : [];
  if (rawTrades.length === 0) return NextResponse.json({ ok: true });

  const parsed = tradesArraySchema.safeParse(rawTrades);
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/journal PUT', userId });
    return NextResponse.json({ error: 'Invalid trades payload', issues: parsed.error.issues }, { status: 400 });
  }
  const trades: TradeEntry[] = parsed.data;

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .upsert(trades.map(t => tradeToRow(userId, t)), { onConflict: 'clerk_id,id' });

  if (error) {
    logger.error('journal PUT failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Bulk-mirror. Awaited for the same serverless reason as the POST path.
  // A user with 200 stored trades ships ~200 rows in one upsert = ~100ms.
  await mirrorTrades(userId, trades);

  return NextResponse.json({ ok: true });
}
