import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/server';
import { logSecurityEvent } from '../../../lib/securityLog';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';

/** DELETE /api/journal/[id] — soft-delete (sets deleted_at). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal/[id] DELETE' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`journal:delete:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/journal/[id] DELETE', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('clerk_id', userId)
    .eq('id', Number(id));

  if (error) {
    logger.error('journal DELETE failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** PATCH /api/journal/[id] — restore from trash (clears deleted_at). */
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/journal/[id] PATCH' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`journal:patch:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/journal/[id] PATCH', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq('clerk_id', userId)
    .eq('id', Number(id));

  if (error) {
    logger.error('journal PATCH failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
