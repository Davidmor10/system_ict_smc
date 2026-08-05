// GET /api/ai/weekly-report/history — returns the trader's saved weekly
// reports from the database, newest first. Replaces the ai-analytics page's
// old localStorage-only "past reports" strip (which stored one-sentence
// snippets and evaporated when the browser was cleared).

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../../lib/supabase/server';
import { getRecentWeeklyReports } from '../../../../lib/intelligence/repository';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../lib/securityLog';
import { logger } from '../../../../lib/logger';
import { requirePlanApi } from '../../../../lib/withRoleCheck';

export const runtime = 'nodejs';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/weekly-report/history' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:weekly-report:history:${userId}`);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const denied = await requirePlanApi('deluxe', '/api/ai/weekly-report/history');
  if (denied) return denied;

  if (!isSupabaseConfigured()) return NextResponse.json({ reports: [] });

  try {
    const supabase = createServerSupabaseClient();
    const reports = await getRecentWeeklyReports(supabase, userId, 24);
    // Trim the response — the client only needs what it can render. The full
    // facts blob is heavy and only used server-side for re-analysis.
    const light = reports.map(r => ({
      isoWeek: r.isoWeek,
      weekStartDate: r.weekStartDate,
      tradeCount: r.tradeCount,
      confidenceLevel: r.confidenceLevel,
      paragraphs: r.narrative?.paragraphs ?? [],
      hypothesisSnapshot: r.primaryHypothesisSnapshot,
    }));
    return NextResponse.json({ reports: light });
  } catch (err) {
    logger.error('weekly-report history failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ reports: [] });
  }
}
