import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateDashboardPrimaryInsight } from '../../../lib/intelligence/service';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/discovery' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:discovery:${userId}`);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/discovery', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const lang = body?.lang === 'en' ? 'en' : 'he';

    // The server now derives its own answer from the persisted trader
    // profile / pattern memory (bootstrapping them on a cold start) instead
    // of trusting whatever trades the client happens to have loaded —
    // trades in the request body, if any, are ignored.
    const discovery = await generateDashboardPrimaryInsight(userId, lang);
    return NextResponse.json({ discovery });
  } catch (err) {
    console.error('[AI Discovery]', err);
    return NextResponse.json({ discovery: null }, { status: 500 });
  }
}
