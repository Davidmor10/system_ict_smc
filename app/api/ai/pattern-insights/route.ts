import { NextRequest, NextResponse } from 'next/server';
import { generatePatternInsights } from '../../../lib/ai/patternInsights';
import type { TradeEntry } from '../../../lib/journal';

export async function POST(req: NextRequest) {
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
