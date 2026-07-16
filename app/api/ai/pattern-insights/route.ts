import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generatePatternInsights } from '../../../lib/ai/patternInsights';
import type { TradeEntry } from '../../../lib/journal';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/pattern-insights' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:pattern-insights:${userId}`);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/pattern-insights', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  // AI-analytics surface — Deluxe only, enforced at the API as well.
  const denied = await requirePlanApi('deluxe', '/api/ai/pattern-insights');
  if (denied) return denied;

  try {
    const { trades, lang = 'he' } = await req.json();

    if (!Array.isArray(trades)) {
      return NextResponse.json({ insights: [] });
    }

    const insights = await generatePatternInsights(trades as TradeEntry[], lang === 'en' ? 'en' : 'he');
    return NextResponse.json({ insights });
  } catch (err) {
    console.error('[AI Pattern Insights]', err);
    return NextResponse.json({ insights: [] }, { status: 500 });
  }
}
