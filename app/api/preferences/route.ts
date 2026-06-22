import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';

export type UserPrefs = {
  chart_tf_es: string;
  chart_tf_nq: string;
  analysis_state: Record<string, unknown> | null;
  lockout_config: Record<string, unknown> | null;
};

/** GET /api/preferences — returns stored preferences for the current user. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ prefs: null });

  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('user_preferences')
    .select('chart_tf_es, chart_tf_nq, analysis_state, lockout_config')
    .eq('clerk_id', userId)
    .maybeSingle();

  return NextResponse.json({ prefs: data });
}

/** PUT /api/preferences — upserts a partial preferences patch for the current user. */
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const body: Partial<UserPrefs> = await req.json();
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
