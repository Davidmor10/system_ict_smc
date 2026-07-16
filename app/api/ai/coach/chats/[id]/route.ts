import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../../../lib/supabase/server';
import { getCoachChat, deleteCoachChat } from '../../../../../lib/ai/coachChats';
import { checkRateLimit } from '../../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../../lib/securityLog';
import { logger } from '../../../../../lib/logger';
import { requirePlanApi } from '../../../../../lib/withRoleCheck';

/** GET /api/ai/coach/chats/[id] — a single chat with its full message list. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/coach/chats/[id] GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:chats:get:${userId}`, 90, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/coach/chats/[id] GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  const denied = await requirePlanApi('deluxe', '/api/ai/coach/chats/[id] GET');
  if (denied) return denied;

  if (!isSupabaseConfigured()) return NextResponse.json({ chat: null });

  const { id } = await params;
  try {
    const supabase = createServerSupabaseClient();
    const chat = await getCoachChat(supabase, userId, id);
    return NextResponse.json({ chat });
  } catch (err) {
    logger.error('coach chat get failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/ai/coach/chats/[id] — permanently removes one chat. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/coach/chats/[id] DELETE' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:chats:delete:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/coach/chats/[id] DELETE', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  const denied = await requirePlanApi('deluxe', '/api/ai/coach/chats/[id] DELETE');
  if (denied) return denied;

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const { id } = await params;
  try {
    const supabase = createServerSupabaseClient();
    await deleteCoachChat(supabase, userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('coach chat delete failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
