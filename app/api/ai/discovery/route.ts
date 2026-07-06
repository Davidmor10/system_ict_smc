import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateDiscovery } from '../../../lib/ai/discovery';
import type { TradeEntry } from '../../../lib/journal';
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
    const { trades, lang = 'he' } = await req.json();

    if (!Array.isArray(trades)) {
      return NextResponse.json({ discovery: null });
    }

    const discovery = await generateDiscovery(trades as TradeEntry[], lang === 'en' ? 'en' : 'he');
    return NextResponse.json({ discovery });
  } catch (err) {
    console.error('[AI Discovery]', err);
    return NextResponse.json({ discovery: null }, { status: 500 });
  }
}
