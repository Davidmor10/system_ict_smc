import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyDeepAnalysis } from '../../../lib/intelligence/service';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { requirePlanApi } from '../../../lib/withRoleCheck';

// Vercel's default function timeout is 10 seconds. This route reads the
// trader's whole history, re-runs the intelligence refresh, and then waits on a
// model — comfortably past 10s on a real account, which surfaces as a 504 the
// client cannot distinguish from a broken feature. 60 is the Hobby ceiling.
export const maxDuration = 60;


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

  // AI-analytics surface — Pro+ (the whole /dashboard/ai-analytics page is
  // now Pro-tier), enforced at the API as well.
  const denied = await requirePlanApi('pro', '/api/ai/weekly-report');
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
