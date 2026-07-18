import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { getMacroEvents, israelToday } from '../../lib/ai/macroCalendar';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';

/** GET /api/macro — today's real macro events in Israel time, for the dashboard
    briefing. Same cached feed the coach reads; never invents an event ([] when
    the calendar can't be loaded). Pass `?scope=week` to get the full week the
    feed already carries (e.g. for a Mon-Fri calendar view); default stays
    today-only for the existing dashboard briefing callers. */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/macro GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`macro:get:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/macro GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    const supabase = isSupabaseConfigured() ? createServerSupabaseClient() : null;
    const today = israelToday();
    const all = await getMacroEvents(supabase);
    const week = new URL(req.url).searchParams.get('scope') === 'week';
    return NextResponse.json({ today, events: week ? all : all.filter(e => e.dateIsrael === today) });
  } catch (err) {
    logger.error('macro GET failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
