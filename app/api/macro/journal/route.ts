import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/server';
import { getMacroJournalEvents, israelToday } from '../../../lib/ai/macroCalendar';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

/** GET /api/macro/journal — three-week window (last + this + next) of macro
    events for the reports journal page. Same cached feed the coach reads,
    keyed separately so the two never fight over the same cache row. */
export async function GET() {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/macro/journal');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/macro/journal GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`macro-journal:get:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/macro/journal GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    const supabase = isSupabaseConfigured() ? createServerSupabaseClient() : null;
    const today = israelToday();
    const events = await getMacroJournalEvents(supabase);
    return NextResponse.json({ today, events });
  } catch (err) {
    logger.error('macro journal GET failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
