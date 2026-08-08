// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY diagnostic endpoint. Reads the current user's journal_trades,
// runs the mirror mapping, and attempts a direct upsert to
// intelligence_trades — returning the RAW Supabase error object if the write
// fails. This is how we surface the silent failure that logger.warn is
// swallowing on the /api/journal PUT path.
//
// Owner-gated (davidmor030908@gmail.com / davidmor030909@gmail.com only) so
// leaving it deployed doesn't expose other users' rows. Remove this file
// after the bug is fixed.
// ─────────────────────────────────────────────────────────────────────────────

import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { tradeEntryToIntelligenceRow } from '../../../lib/coach-pipeline/mirror/journalToIntelligence';
import { rowToTrade } from '../../journal/route';

const OWNER_EMAILS = ['davidmor030908@gmail.com', 'davidmor030909@gmail.com'];

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user  = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email || !OWNER_EMAILS.includes(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServerSupabaseClient();

  // 1. Read this user's legacy trades.
  const { data: legacyRows, error: readErr } = await supabase
    .from('journal_trades')
    .select('*')
    .eq('clerk_id', userId)
    .limit(3);
  if (readErr) {
    return NextResponse.json({ stage: 'read_legacy', error: readErr.message }, { status: 500 });
  }
  if (!legacyRows || legacyRows.length === 0) {
    return NextResponse.json({ stage: 'read_legacy', note: 'no rows' });
  }

  // 2. Map to intelligence_trades rows (same code path as the mirror).
  const trades = legacyRows.map(rowToTrade);
  const mirrorRows = trades.map(t => tradeEntryToIntelligenceRow(userId, t));

  // 3. Try the upsert directly — capture the raw Supabase error.
  const { error: upsertErr, data: upsertData } = await supabase
    .from('intelligence_trades')
    .upsert(mirrorRows, { onConflict: 'id' })
    .select('id');

  return NextResponse.json({
    userId,
    legacyCount: legacyRows.length,
    firstLegacyRow: legacyRows[0],           // to spot bad source data
    firstMirrorRow: mirrorRows[0],           // to spot bad mapping
    upsertError: upsertErr ? {
      message: upsertErr.message,
      code:    (upsertErr as { code?: string }).code,
      details: (upsertErr as { details?: string }).details,
      hint:    (upsertErr as { hint?: string }).hint,
    } : null,
    upsertReturned: upsertData?.length ?? 0,
  });
}
