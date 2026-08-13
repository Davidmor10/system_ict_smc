import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generatePatternInsights } from '../../../lib/ai/patternInsights';
import type { TradeEntry } from '../../../lib/journal';
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
    logSecurityEvent('auth_failed', { route: '/api/ai/pattern-insights' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:pattern-insights:${userId}`);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/pattern-insights', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  // AI-analytics surface — Deluxe only, enforced at the API as well.
  // Rendered on /dashboard/ai-analytics, which is now Pro+ (was Deluxe).
  const denied = await requirePlanApi('pro', '/api/ai/pattern-insights');
  if (denied) return denied;

  try {
    const { trades, lang = 'he' } = await req.json();

    if (!Array.isArray(trades)) {
      return NextResponse.json({ insights: [] });
    }

    const insights = await generatePatternInsights(trades as TradeEntry[], lang === 'en' ? 'en' : 'he', userId);
    return NextResponse.json({ insights });
  } catch (err) {
    console.error('[AI Pattern Insights]', err);
    return NextResponse.json({ insights: [] }, { status: 500 });
  }
}
