import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyReport } from '../../../lib/ai/weeklyReport';
import type { TradeEntry } from '../../../lib/journal';

export async function POST(req: NextRequest) {
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
