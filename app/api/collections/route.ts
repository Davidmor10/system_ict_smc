import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { syncNotebook, type SyncNotebookResult } from '../../lib/coach-pipeline/pipelines/syncNotebook';
import type { ClientNotebookEntry } from '../../lib/coach-pipeline/mirror/notebookToIntelligence';
import { requirePlanApi } from '../../lib/withRoleCheck';
import { ownerMismatch } from '../../lib/sync/ownerHeader';

// Must match ENTRIES_KIND in app/lib/notebook/store.ts. Not imported from
// there: that module is client-side and pulls in the whole notebook store.
const NOTEBOOK_ENTRIES_KIND = 'notebook_entries_v1';

// Generic per-user KV sync for the client's localStorage collections (setups,
// rules, violations, daily plan, reminders, preferences, lockout). Every query
// is scoped by clerk_id — the service-role client bypasses RLS by design, so
// this scoping IS the access control. Errors never surface Supabase internals.

const KIND_RE = /^[a-z0-9_:.\-]{1,64}$/;

// A collection value is either a list or an object blob. Capped so one user
// can't push an unbounded jsonb row.
const dataSchema = z.union([z.array(z.unknown()).max(5000), z.record(z.string(), z.unknown())]);
const putSchema = z.object({
  kind: z.string().regex(KIND_RE),
  data: dataSchema,
});
const MAX_BYTES = 1_500_000; // ~1.5 MB per collection

/** GET /api/collections            → { collections: { [kind]: data } } (all for the user)
    GET /api/collections?kind=setups → { collections: { setups: data } } */
export async function GET(req: Request) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/collections');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/collections GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A tab whose session changed underneath it would otherwise read or write
  // the wrong account's rows with every check passing. See lib/sync/ownerHeader.
  if (ownerMismatch(req.headers, userId)) {
    logSecurityEvent('owner_mismatch', { route: '/api/collections GET', userId });
    return NextResponse.json({ error: 'Session changed — reload the page' }, { status: 409 });
  }

  const limited = checkRateLimit(`collections:get:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/collections GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ collections: {} });

  const kind = new URL(req.url).searchParams.get('kind');
  if (kind && !KIND_RE.test(kind)) {
    logSecurityEvent('validation_failed', { route: '/api/collections GET', userId });
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseClient();
    let query = supabase.from('user_collections').select('kind, data').eq('clerk_id', userId);
    if (kind) query = query.eq('kind', kind);
    const { data, error } = await query;
    if (error) throw error;
    const collections: Record<string, unknown> = {};
    for (const row of data ?? []) collections[row.kind as string] = row.data;
    return NextResponse.json({ collections });
  } catch (err) {
    logger.error('collections GET failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PUT /api/collections — full-replace one collection. Body: { kind, data }. */
export async function PUT(req: Request) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/collections');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/collections PUT' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A tab whose session changed underneath it would otherwise read or write
  // the wrong account's rows with every check passing. See lib/sync/ownerHeader.
  if (ownerMismatch(req.headers, userId)) {
    logSecurityEvent('owner_mismatch', { route: '/api/collections PUT', userId });
    return NextResponse.json({ error: 'Session changed — reload the page' }, { status: 409 });
  }

  const limited = checkRateLimit(`collections:put:${userId}`, 120, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/collections PUT', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logSecurityEvent('validation_failed', { route: '/api/collections PUT', userId, reason: 'invalid_json' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/collections PUT', userId });
    return NextResponse.json({ error: 'Invalid collection payload' }, { status: 400 });
  }
  if (JSON.stringify(parsed.data.data).length > MAX_BYTES) {
    logSecurityEvent('validation_failed', { route: '/api/collections PUT', userId, reason: 'too_large' });
    return NextResponse.json({ error: 'Collection too large' }, { status: 413 });
  }

  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from('user_collections')
      .upsert(
        { clerk_id: userId, kind: parsed.data.kind, data: parsed.data.data, updated_at: new Date().toISOString() },
        { onConflict: 'clerk_id,kind' },
      );
    if (error) throw error;

    // The notebook is the coach's only window into what the trader actually
    // wrote. It syncs through this generic KV endpoint as one blob, while the
    // pipeline reads a real notebook_entries table — so without this hop the
    // RAG index has no source and every retrieval comes back empty.
    //
    // Awaited, not fire-and-forget: on serverless the function can be frozen
    // the moment the response is returned, which is exactly how the trades
    // mirror silently wrote nothing for a day.
    let notebook: SyncNotebookResult | undefined;
    if (parsed.data.kind === NOTEBOOK_ENTRIES_KIND && Array.isArray(parsed.data.data)) {
      notebook = await syncNotebook(userId, parsed.data.data as ClientNotebookEntry[]);
    }

    return NextResponse.json({ ok: true, ...(notebook ? { notebook } : {}) });
  } catch (err) {
    logger.error('collections PUT failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
