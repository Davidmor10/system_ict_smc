import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { userPrefsPatchSchema } from '../../lib/validation';
import { logSecurityEvent } from '../../lib/securityLog';
import { checkRateLimit } from '../../lib/rateLimit';
import { logger } from '../../lib/logger';
import { requirePlanApi } from '../../lib/withRoleCheck';

export type UserPrefs = {
  chart_tf_es: string;
  chart_tf_nq: string;
  analysis_state: Record<string, unknown> | null;
  lockout_config: Record<string, unknown> | null;
  news_filters: Record<string, unknown> | null;
};

/** GET /api/preferences — returns stored preferences for the current user. */
export async function GET() {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/preferences');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/preferences GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`preferences:get:${userId}`, 60, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/preferences GET', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ prefs: null });

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('chart_tf_es, chart_tf_nq, analysis_state, lockout_config, news_filters')
    .eq('clerk_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('preferences GET failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ prefs: data });
}

/** PUT /api/preferences — upserts a partial preferences patch for the current user. */
export async function PUT(req: Request) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/preferences');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/preferences PUT' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`preferences:put:${userId}`, 30, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/preferences PUT', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logSecurityEvent('validation_failed', { route: '/api/preferences PUT', userId, reason: 'invalid_json' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = userPrefsPatchSchema.safeParse(body);
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/preferences PUT', userId });
    return NextResponse.json({ error: 'Invalid preferences payload', issues: parsed.error.issues }, { status: 400 });
  }
  const patch: Partial<UserPrefs> = parsed.data;

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { clerk_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'clerk_id' },
    );

  if (error) {
    logger.error('preferences PUT failed', { userId, error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
