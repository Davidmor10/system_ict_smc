import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyReport } from '../../../lib/ai/weeklyReport';
import type { TradeEntry } from '../../../lib/journal';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';

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

  try {
    const { trades, lang = 'he' } = await req.json();

    if (!Array.isArray(trades)) {
      return NextResponse.json({ report: null });
    }

    const report = await generateWeeklyReport(trades as TradeEntry[], lang === 'en' ? 'en' : 'he');
    return NextResponse.json({ report });
  } catch (err) {
    console.error('[AI Weekly Report]', err);
    return NextResponse.json({ report: null }, { status: 500 });
  }
}
