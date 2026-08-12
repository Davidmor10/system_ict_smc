import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateWorkingStrengths } from '../../../lib/intelligence/service';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { requirePlanApi } from '../../../lib/withRoleCheck';

// Vercel's default function timeout is 10 seconds. This route reads the
// trader's whole history, re-runs the intelligence refresh, and then waits on a
// model — comfortably past 10s on a real account, which surfaces as a 504 the
// client cannot distinguish from a broken feature. 60 is the Hobby ceiling.
export const maxDuration = 60;


/** POST /api/ai/strengths — "מה באמת עובד לך", the AI-analytics page's
    flagship section. Fetches its own trades/pattern history server-side (via
    clerk_id); trades in the request body, if any, are ignored. */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/strengths' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:strengths:${userId}`);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/strengths', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  // AI-analytics surface — Pro+, enforced at the API as well.
  const denied = await requirePlanApi('pro', '/api/ai/strengths');
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const lang = body?.lang === 'en' ? 'en' : 'he';
    const strengths = await generateWorkingStrengths(userId, lang);
    return NextResponse.json({ strengths });
  } catch (err) {
    console.error('[AI Strengths]', err);
    return NextResponse.json({ strengths: [] }, { status: 500 });
  }
}
