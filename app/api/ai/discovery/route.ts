import { NextRequest, NextResponse } from 'next/server';
import { generateDiscovery } from '../../../lib/ai/discovery';
import type { TradeEntry } from '../../../lib/journal';

export async function POST(req: NextRequest) {
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
