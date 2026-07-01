import { NextRequest, NextResponse } from 'next/server';
import type { TradeEntry } from '../../../lib/journal';
import { runFullAnalysis } from '../../../lib/analytics';
import { fmtPF } from '../../../lib/ai/factsBlock';
import { genAI, AI_MODEL } from '../../../lib/ai/client';

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

    // Precomputed by the analytics engine — the prompt below only ever cites
    // numbers that come from here, never math done ad hoc against raw trades.
    const analysis = runFullAnalysis(trades as TradeEntry[]);
    const { performance: perf, direction } = analysis;
    const winRate = Math.round(perf.winRate);
    const avgR = perf.avgRR;
    const totalPnl = perf.totalPnl;

    const sessionStats = analysis.sessions
      .map(g => `${g.label}: ${g.wins}W/${g.losses}L (${g.winRate.toFixed(0)}%)`)
      .join(', ');
    const instrumentStats = analysis.instruments
      .map(g => `${g.key}: ${g.wins}W/${g.losses}L (${g.winRate.toFixed(0)}%), PF ${fmtPF(g.profitFactor)}`)
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

    const totalWins = direction.long.wins + direction.short.wins;
    const totalLosses = direction.long.losses + direction.short.losses;
    const totalBE = perf.closedTrades - totalWins - totalLosses;

    const prompt = `You are an elite ICT trading coach with deep expertise in institutional order flow, liquidity concepts, and trader psychology. You are analyzing a trader's journal data.

${langInstruction}

TRADER STATISTICS (${closed.length} closed trades):
- Win/Loss/BE: ${totalWins}W / ${totalLosses}L / ${totalBE}BE
- Win rate: ${winRate}%
- Avg RR: ${avgR.toFixed(2)}R
- Net P&L: $${totalPnl.toFixed(0)}
- Profit factor: ${fmtPF(perf.profitFactor)}
- Max consecutive losses: ${maxConsecLoss}
- Recent 5 results: ${recentResults}

SESSION PERFORMANCE: ${sessionStats || 'insufficient data'}
INSTRUMENT PERFORMANCE: ${instrumentStats || 'insufficient data'}
MODEL/SETUP PERFORMANCE: ${modelStats || 'insufficient data'}
DIRECTION BIAS: LONG: ${direction.long.wins}W/${direction.long.losses}L (${direction.long.winRate.toFixed(0)}%) | SHORT: ${direction.short.wins}W/${direction.short.losses}L (${direction.short.winRate.toFixed(0)}%)
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
- Be specific, not generic. Reference their actual numbers. Use ICT/SMC terminology where it fits naturally (FVG, Order Block, Liquidity Sweep, BSL/SSL, SMT, etc.) — this trader knows the vocabulary.
- Each insight should be ONE well-formed block: 1-2 sentences normally, but if there are multiple distinct points worth making (e.g. two separate risk patterns), use bullet points starting with "• " on separate lines within the same text field instead of cramming everything into one run-on sentence. Never split one idea into several weak fragments.
- No fluff. No "I noticed that...". Start directly with the insight.
- JSON only, no extra text.`;

    const result = await genAI.models.generateContent({
      model: AI_MODEL,
      contents: prompt,
    });

    const raw = result.text ?? '[]';
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
