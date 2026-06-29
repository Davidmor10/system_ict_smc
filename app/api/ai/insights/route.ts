import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export interface AiInsight {
  type: 'opportunity' | 'warning' | 'pattern';
  tag_he: string;
  tag_en: string;
  text: string;
}

export async function POST(req: NextRequest) {
  try {
    const { trades, lang = 'he' } = await req.json();

    if (!Array.isArray(trades) || trades.length < 3) {
      return NextResponse.json({ insights: [] });
    }

    const closed = trades.filter((t: { result: string }) => t.result !== 'OPEN');
    const wins   = closed.filter((t: { result: string }) => t.result === 'WIN').length;
    const losses = closed.filter((t: { result: string }) => t.result === 'LOSS').length;
    const bes    = closed.filter((t: { result: string }) => t.result === 'BE').length;
    const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;
    const avgR = closed.length > 0
      ? (closed.reduce((s: number, t: { tradeR?: number }) => s + (t.tradeR ?? 0), 0) / closed.length)
      : 0;
    const totalPnl = closed.reduce((sum: number, t: { pnlUsd?: number }) => sum + (t.pnlUsd ?? 0), 0);

    // Session breakdown
    const bySession: Record<string, { w: number; l: number }> = {};
    for (const t of closed as Array<{ session?: string; result: string }>) {
      const sess = t.session ?? 'unknown';
      if (!bySession[sess]) bySession[sess] = { w: 0, l: 0 };
      if (t.result === 'WIN') bySession[sess].w++;
      if (t.result === 'LOSS') bySession[sess].l++;
    }
    const sessionStats = Object.entries(bySession)
      .map(([s, { w, l }]) => `${s}: ${w}W/${l}L (${w + l > 0 ? Math.round(w / (w + l) * 100) : 0}%)`)
      .join(', ');

    // Model breakdown
    const byModel: Record<string, { w: number; l: number }> = {};
    for (const t of closed as Array<{ model?: string; result: string }>) {
      const m = t.model ?? 'unknown';
      if (!byModel[m]) byModel[m] = { w: 0, l: 0 };
      if (t.result === 'WIN') byModel[m].w++;
      if (t.result === 'LOSS') byModel[m].l++;
    }
    const modelStats = Object.entries(byModel)
      .map(([m, { w, l }]) => `${m}: ${w}W/${l}L`)
      .join(', ');

    // Direction breakdown
    const byDir: Record<string, { w: number; l: number }> = {};
    for (const t of closed as Array<{ direction?: string; result: string }>) {
      const d = t.direction ?? 'unknown';
      if (!byDir[d]) byDir[d] = { w: 0, l: 0 };
      if (t.result === 'WIN') byDir[d].w++;
      if (t.result === 'LOSS') byDir[d].l++;
    }

    // Consecutive losses check
    let maxConsecLoss = 0, cur = 0;
    for (const t of (closed as Array<{ result: string }>).slice().reverse()) {
      if (t.result === 'LOSS') { cur++; maxConsecLoss = Math.max(maxConsecLoss, cur); }
      else cur = 0;
    }
    const recentResults = (closed as Array<{ result: string }>).slice(-5).map(t => t.result).join(', ');

    // Notes sample
    const noteSamples = (closed as Array<{ notes?: string; result: string }>)
      .filter(t => t.notes && t.notes.length > 5)
      .slice(-8)
      .map(t => `[${t.result}] ${t.notes!.slice(0, 100)}`)
      .join('\n');

    const isHe = lang === 'he';
    const langInstruction = isHe
      ? 'Respond entirely in Hebrew (עברית). Use natural, professional Hebrew for a serious trader.'
      : 'Respond in English.';

    const prompt = `You are an elite ICT trading coach with deep expertise in institutional order flow, liquidity concepts, and trader psychology. You are analyzing a trader's journal data.

${langInstruction}

TRADER STATISTICS (${closed.length} closed trades):
- Win/Loss/BE: ${wins}W / ${losses}L / ${bes}BE
- Win rate: ${winRate}%
- Avg R: ${avgR.toFixed(2)}R
- Net P&L: $${totalPnl.toFixed(0)}
- Max consecutive losses: ${maxConsecLoss}
- Recent 5 results: ${recentResults}

SESSION PERFORMANCE: ${sessionStats || 'insufficient data'}
MODEL/SETUP PERFORMANCE: ${modelStats || 'insufficient data'}
DIRECTION BIAS: LONG: ${byDir['LONG'] ? `${byDir['LONG'].w}W/${byDir['LONG'].l}L` : '0W/0L'} | SHORT: ${byDir['SHORT'] ? `${byDir['SHORT'].w}W/${byDir['SHORT'].l}L` : '0W/0L'}
${noteSamples ? `TRADER NOTES (recent):\n${noteSamples}` : ''}

Provide EXACTLY 3 insights in this JSON format:
[
  {
    "type": "opportunity",
    "text": "<one specific, actionable opportunity based on their strongest edge — session, model, or setup>"
  },
  {
    "type": "warning",
    "text": "<one specific warning about a real risk pattern you see — consecutive losses, session weakness, direction bias, or discipline issue from notes>"
  },
  {
    "type": "pattern",
    "text": "<one specific behavioral or performance pattern you identified — could be positive or negative>"
  }
]

Rules:
- Be specific, not generic. Reference their actual numbers.
- Each insight: 1-2 sentences max.
- No fluff. No "I noticed that...". Start directly with the insight.
- JSON only, no extra text.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '[]';
    let parsed: Array<{ type: string; text: string }> = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      parsed = match ? JSON.parse(match[0]) : [];
    } catch {
      parsed = [];
    }

    const TAG_MAP = {
      opportunity: { he: 'הזדמנות', en: 'OPPORTUNITY' },
      warning:     { he: 'אזהרה',   en: 'WARNING' },
      pattern:     { he: 'תבנית',   en: 'PATTERN' },
    } as const;

    const insights: AiInsight[] = parsed.slice(0, 3).map((item) => {
      const t = (item.type in TAG_MAP ? item.type : 'pattern') as keyof typeof TAG_MAP;
      return {
        type: t,
        tag_he: TAG_MAP[t].he,
        tag_en: TAG_MAP[t].en,
        text: item.text ?? '',
      };
    });

    return NextResponse.json({ insights });
  } catch (err) {
    console.error('[AI Insights]', err);
    return NextResponse.json({ insights: [] }, { status: 500 });
  }
}
