import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { trades } = await req.json();

    if (!Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ insight: null });
    }

    const recent = trades.slice(0, 30);
    const closed = recent.filter((t: { result: string }) => t.result !== 'OPEN');
    const wins   = closed.filter((t: { result: string }) => t.result === 'WIN').length;
    const losses = closed.filter((t: { result: string }) => t.result === 'LOSS').length;
    const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;

    const totalPnl = closed.reduce((sum: number, t: { pnlUsd?: number }) => sum + (t.pnlUsd ?? 0), 0);
    const avgR = closed.length > 0
      ? (closed.reduce((s: number, t: { tradeR?: number }) => s + (t.tradeR ?? 0), 0) / closed.length).toFixed(2)
      : '0';

    const summary = recent.map((t: {
      symbol: string; direction: string; result: string;
      model?: string; session?: string; tradeR?: number; pnlUsd?: number; notes?: string;
    }) =>
      `${t.symbol} ${t.direction} | ${t.result} | ${t.model ?? '—'} | ${t.session ?? '—'} | R=${t.tradeR?.toFixed(2) ?? '—'} | $${t.pnlUsd?.toFixed(0) ?? '—'}${t.notes ? ` | Notes: ${t.notes.slice(0, 80)}` : ''}`
    ).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are a trading coach reviewing a trader's recent journal. Be direct, specific, and actionable. Max 3 sentences. No fluff.

Stats (last ${closed.length} closed trades): Win rate ${winRate}%, Avg R ${avgR}, Net P&L $${totalPnl.toFixed(0)}.

Trades:
${summary}

Give one key insight about their edge or discipline pattern, and one specific action they should take tomorrow.`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : null;
    return NextResponse.json({ insight: text });
  } catch (err) {
    console.error('[AI Insights]', err);
    return NextResponse.json({ insight: null }, { status: 500 });
  }
}
