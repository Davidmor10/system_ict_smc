import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyDeepAnalysis } from '../../../lib/intelligence/service';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/weekly-report' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:weekly-report:${userId}`);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/weekly-report', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  // AI-analytics surface — Deluxe only, enforced at the API as well.
  const denied = await requirePlanApi('deluxe', '/api/ai/weekly-report');
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const lang = body?.lang === 'en' ? 'en' : 'he';

    // Fetches its own trades server-side (via clerk_id) and persists a deep
    // narrative report to weekly_ai_reports — trades in the request body,
    // if any, are ignored.
    const report = await generateWeeklyDeepAnalysis(userId, lang);
    return NextResponse.json({ report });
  } catch (err) {
    console.error('[AI Weekly Report]', err);
    return NextResponse.json({ report: null }, { status: 500 });
  }
}
