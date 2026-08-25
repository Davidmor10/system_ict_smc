import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generatePatternInsights } from '../../../lib/ai/patternInsights';
import { getRecentTrades } from '../../../lib/intelligence/repository';
import { loadMacroContext } from '../../../lib/analytics';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/server';
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
    const body = await req.json().catch(() => ({}));
    const lang = body?.lang === 'en' ? 'en' : 'he';

    // Trades are read here, from this account's rows — the request body is
    // ignored, exactly as the other five AI routes already do.
    //
    // It used to analyse whatever the browser posted. Nothing leaked (it is the
    // trader's own journal either way), but every number in the answer was
    // computed from a client-side copy rather than from the record itself, so a
    // stale tab or a half-synced edit produced a confidently-stated pattern the
    // database never supported. The pattern and its sample size have to come
    // from the same place the journal page's own totals come from.
    if (!isSupabaseConfigured()) return NextResponse.json({ insights: [] });
    const supabase = createServerSupabaseClient();
    const trades = await getRecentTrades(supabase, userId);

    // The macro calendar the app has been caching daily since it went live.
    // Folded in here so the event/quiet comparison runs on the real diary
    // rather than on a date rule; days the cache never covered are excluded
    // from that comparison instead of being counted as quiet. Empty context on
    // any failure, which switches the comparison off rather than guessing.
    const macro = await loadMacroContext(supabase);

    const insights = await generatePatternInsights(trades, lang, userId, macro);
    return NextResponse.json({ insights });
  } catch (err) {
    console.error('[AI Pattern Insights]', err);
    return NextResponse.json({ insights: [] }, { status: 500 });
  }
}
