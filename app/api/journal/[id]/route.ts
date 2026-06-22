import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/server';

/** DELETE /api/journal/[id] — soft-delete (sets deleted_at). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .update({ deleted_at: new Date().toISOString() })
    .eq('clerk_id', userId)
    .eq('id', Number(id));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** PATCH /api/journal/[id] — restore from trash (clears deleted_at). */
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from('journal_trades')
    .update({ deleted_at: null })
    .eq('clerk_id', userId)
    .eq('id', Number(id));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
