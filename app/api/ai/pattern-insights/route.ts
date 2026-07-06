import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { generatePatternInsights } from '../../../lib/ai/patternInsights';
import type { TradeEntry } from '../../../lib/journal';
import { checkRateLimit } from '../../../lib/rateLimit';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkRateLimit(`ai:pattern-insights:${userId}`);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });

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
