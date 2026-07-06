import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import { userPrefsPatchSchema } from '../../lib/validation';
import { logSecurityEvent } from '../../lib/securityLog';

export type UserPrefs = {
  chart_tf_es: string;
  chart_tf_nq: string;
  analysis_state: Record<string, unknown> | null;
  lockout_config: Record<string, unknown> | null;
  news_filters: Record<string, unknown> | null;
};

/** GET /api/preferences — returns stored preferences for the current user. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/preferences GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ prefs: null });

  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('user_preferences')
    .select('chart_tf_es, chart_tf_nq, analysis_state, lockout_config, news_filters')
    .eq('clerk_id', userId)
    .maybeSingle();

  return NextResponse.json({ prefs: data });
}

/** PUT /api/preferences — upserts a partial preferences patch for the current user. */
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/preferences PUT' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const parsed = userPrefsPatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/preferences PUT', userId });
    return NextResponse.json({ error: 'Invalid preferences payload', issues: parsed.error.issues }, { status: 400 });
  }
  const body: Partial<UserPrefs> = parsed.data;

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { clerk_id: userId, ...body, updated_at: new Date().toISOString() },
      { onConflict: 'clerk_id' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
