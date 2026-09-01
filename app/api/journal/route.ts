import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { deletedIdsSchema, tradeEntrySchema, tradesArraySchema } from '../../lib/validation';
import { logSecurityEvent } from '../../lib/securityLog';
import { checkRateLimit } from '../../lib/rateLimit';
import { logger } from '../../lib/logger';
import { mirrorTradeDeleted, mirrorTrades } from '../../lib/coach-pipeline/mirror/journalToIntelligence';
import { requirePlanApi } from '../../lib/withRoleCheck';
import { ownerMismatch } from '../../lib/sync/ownerHeader';
import { rowToTrade, tradeToRow, type TradeRow } from '../../lib/journalRow';
import type { TradeEntry } from '../../lib/journal';

// Re-exported so existing importers keep reaching these through the route.
export { rowToTrade, tradeToRow };
export type { TradeRow };

// Returns null (and never throws) on a malformed body — lets callers turn it
// into a clean 400 instead of an unhandled exception bubbling out of the route.
async function parseJsonBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
/** Columns added by `supabase-migration-stop-note.sql`. PostgREST rejects the
 *  ENTIRE upsert when one column in the payload is missing from the schema
 *  cache, so a database that has not run the migration yet would fail every
 *  trade save — not just these two fields. Same posture as `has_screenshot`
 *  on the read side: the app works before and after the migration, and the
 *  only thing a stale database loses is the two new fields. */
const PATCH_COLUMNS = ['stop_move_tag', 'stop_note'] as const;

function isMissingPatchColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST204' || PATCH_COLUMNS.some(column => message.includes(column));
}

/** A null `bias` rejected by a database that has not run
 *  `supabase-migration-bias-nullable.sql` yet.
 *
 *  23502 is Postgres's not-null violation. Checked alongside the column name
 *  because PostgREST does not always forward the SQLSTATE. */
function isBiasNotNull(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23502' && (error.message ?? '').includes('bias');
}

/** Upsert that survives a database still missing the patch columns. Tries the
 *  full row first — the normal path, one round trip — and only on a
 *  missing-column error retries without them. */
export async function upsertTrades(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  rows: TradeRow[],
): Promise<{ error: { message: string } | null }> {
  const attempt = await supabase.from('journal_trades').upsert(rows, { onConflict: 'clerk_id,id' });

  // A blank direction is stored as null so that "not answered" is a state the
  // journal can hold. On a database still carrying `bias not null default
  // 'INDECISIVE'` that write is rejected, so it falls back to the old value
  // rather than failing the save. The trade is what matters; the distinction
  // between blank and "no view" is what the migration buys back.
  if (isBiasNotNull(attempt.error)) {
    logger.warn('journal upsert retried with a default bias — run supabase-migration-bias-nullable.sql', {
      error: attempt.error?.message,
    });
    const filled = rows.map(row => (row.bias == null ? { ...row, bias: 'INDECISIVE' } : row));
    return supabase.from('journal_trades').upsert(filled, { onConflict: 'clerk_id,id' });
  }

  if (!isMissingPatchColumn(attempt.error)) return attempt;

  logger.warn('journal upsert retried without the stop-note columns — run supabase-migration-stop-note.sql', {
    error: attempt.error?.message,
  });
  const trimmed = rows.map(row => {
    const copy: Record<string, unknown> = { ...row };
    for (const column of PATCH_COLUMNS) delete copy[column];
    return copy;
  });
  return supabase.from('journal_trades').upsert(trimmed, { onConflict: 'clerk_id,id' });
}

/** Marks ids deleted for this user, and mirrors each into intelligence_trades
 *  so the analysis layer stops counting them.
 *
 *  This is a repair path, not the primary one: DELETE /api/journal/[id] runs
 *  when the trader empties a trade into the trash. That call is best-effort
 *  from the browser — one request, no retry — so a dropped connection, a tab
 *  closed mid-flight or a delete performed while signed out left the row live
 *  in the cloud forever. The journal itself looked right, because it reads
 *  localStorage; every server-side reader did not, and the AI panels went on
 *  describing trades the trader had deleted.
 *
 *  Scoped by clerk_id like every other write here, so the ids are a claim
 *  about the caller's own journal and nothing else. Idempotent. */
async function tombstoneTrades(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clerkId: string,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('journal_trades')
    .update({ deleted_at: now, updated_at: now })
    .eq('clerk_id', clerkId)
    .in('id', ids)
    .is('deleted_at', null);

  if (error) {
    logger.error('journal tombstone repair failed', { clerkId, count: ids.length, error: error.message });
    return;
  }
  await Promise.all(ids.map(id => mirrorTradeDeleted(clerkId, id, true)));
}

/** GET /api/journal — returns all trades (active + trash) for the current user. */
export async function GET(req?: Request) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/journal');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A tab whose session changed underneath it would otherwise read the wrong
  // account's trades and cache them as its own. See lib/sync/ownerHeader.
  if (req && ownerMismatch(req.headers, userId)) {
    logSecurityEvent('owner_mismatch', { route: '/api/journal GET', userId });
    return NextResponse.json({ error: 'Session changed — reload the page' }, { status: 409 });
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
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/journal');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A tab whose session changed underneath it would otherwise read or write
  // the wrong account's rows with every check passing. See lib/sync/ownerHeader.
  if (ownerMismatch(req.headers, userId)) {
    logSecurityEvent('owner_mismatch', { route: '/api/journal POST', userId });
    return NextResponse.json({ error: 'Session changed — reload the page' }, { status: 409 });
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
  const { error } = await upsertTrades(supabase, [tradeToRow(userId, trade)]);

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
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/journal');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal PUT' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A tab whose session changed underneath it would otherwise read or write
  // the wrong account's rows with every check passing. See lib/sync/ownerHeader.
  if (ownerMismatch(req.headers, userId)) {
    logSecurityEvent('owner_mismatch', { route: '/api/journal PUT', userId });
    return NextResponse.json({ error: 'Session changed — reload the page' }, { status: 409 });
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
  const rawDeleted = Array.isArray((body as { deletedIds?: unknown })?.deletedIds) ? (body as { deletedIds: unknown[] }).deletedIds : [];
  if (rawTrades.length === 0 && rawDeleted.length === 0) return NextResponse.json({ ok: true });

  const parsed = tradesArraySchema.safeParse(rawTrades);
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/journal PUT', userId });
    return NextResponse.json({ error: 'Invalid trades payload', issues: parsed.error.issues }, { status: 400 });
  }
  const trades: TradeEntry[] = parsed.data;

  const supabase = createServerSupabaseClient();

  // Tombstones first. A trade the client deleted must not be re-upserted as
  // live by the same request, and repairing the delete before the push means
  // an id that appears in both lists ends up deleted, not resurrected.
  if (rawDeleted.length > 0) {
    const parsedDeleted = deletedIdsSchema.safeParse(rawDeleted);
    if (!parsedDeleted.success) {
      logSecurityEvent('validation_failed', { route: '/api/journal PUT', userId, reason: 'deleted_ids' });
      return NextResponse.json({ error: 'Invalid deletedIds payload' }, { status: 400 });
    }
    await tombstoneTrades(supabase, userId, parsedDeleted.data);
  }

  const live = trades.filter(t => !rawDeleted.includes(t.id));
  const { error } = live.length > 0
    ? await upsertTrades(supabase, live.map(t => tradeToRow(userId, t)))
    : { error: null };

  if (error) {
    logger.error('journal PUT failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Bulk-mirror. Awaited for the same serverless reason as the POST path.
  // A user with 200 stored trades ships ~200 rows in one upsert = ~100ms.
  await mirrorTrades(userId, live);

  return NextResponse.json({ ok: true });
}
