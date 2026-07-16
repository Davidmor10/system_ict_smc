import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generatePersonalizedInsights } from '../../../lib/intelligence/service';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { requirePlanApi } from '../../../lib/withRoleCheck';
import { logger } from '../../../lib/logger';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/insights' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:insights:${userId}`);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/insights', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  // Rendered on the journal page — Pro and up, enforced at the API as well.
  const denied = await requirePlanApi('pro', '/api/ai/insights');
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const lang = body?.lang === 'en' ? 'en' : 'he';

    // Selected from the persisted trader profile / pattern memory / current
    // hypothesis (bootstrapping them on a cold start) — never a fixed
    // opportunity/warning/pattern template, and trades in the request body,
    // if any, are ignored.
    const { insights, debug } = await generatePersonalizedInsights(userId, lang);
    // Diagnostics stay server-side in the logs; the client only ever gets
    // the insights themselves.
    if (insights.length === 0) logger.info('insights empty', { userId, ...debug });
    return NextResponse.json({ insights });
  } catch (err) {
    console.error('[AI Insights]', err);
    return NextResponse.json({ insights: [] }, { status: 500 });
  }
}
