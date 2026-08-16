import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { getMacroEvents, israelToday } from '../../lib/ai/macroCalendar';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { requirePlanApi } from '../../lib/withRoleCheck';

/** GET /api/macro — real macro events in Israel time, for the dashboard
    briefing. Same cached feed the coach reads; never invents an event ([] when
    the calendar can't be loaded). Defaults to today only; ?scope=week returns
    the rest of the current week (the feed itself is already a weekly pull, so
    this is just a wider filter on the same cached data). */
export async function GET(req: NextRequest) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/macro');
  if (denied) return denied;

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
    const scope = req.nextUrl.searchParams.get('scope') === 'week' ? 'week' : 'today';
    const supabase = isSupabaseConfigured() ? createServerSupabaseClient() : null;
    const today = israelToday();
    const all = await getMacroEvents(supabase);
    const events = scope === 'week' ? all.filter(e => e.dateIsrael >= today) : all.filter(e => e.dateIsrael === today);
    return NextResponse.json({ today, scope, events });
  } catch (err) {
    logger.error('macro GET failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
