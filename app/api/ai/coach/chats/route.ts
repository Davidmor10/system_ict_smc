import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../../lib/supabase/server';
import { listCoachChats } from '../../../../lib/ai/coachChats';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../lib/securityLog';
import { logger } from '../../../../lib/logger';

/** GET /api/ai/coach/chats — the "אחרונים" list (summaries, newest first). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/coach/chats GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:chats:list:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/coach/chats GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ chats: [] });

  try {
    const supabase = createServerSupabaseClient();
    const chats = await listCoachChats(supabase, userId);
    return NextResponse.json({ chats });
  } catch (err) {
    logger.error('coach chats list failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
