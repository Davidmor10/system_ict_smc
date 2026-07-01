import type { TradeEntry } from '../journal';
import { runFullAnalysis, type PatternCandidate, type ConfidenceLevel } from '../analytics';
import { summarizeAnalysis } from './factsBlock';
import { genAI, AI_MODEL } from './client';

export interface AiDiscovery {
  /** One sentence naming the discovery, must cite the specific number(s). */
  title: string;
  /** One sentence starting with "Based on" — the sample it's drawn from. */
  evidence: string;
  /** One sentence telling the trader what to pay attention to. Never a signal. */
  action: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

function describeCandidate(c: PatternCandidate): string {
  const g = c.metric;
  return `${g.label}: ${g.trades} trades, winRate ${g.winRate.toFixed(0)}% (overall winRate is ${c.baseline.toFixed(0)}%), ` +
    `PnL $${g.totalPnl.toFixed(0)}, avgRR ${g.avgRR.toFixed(2)}, confidence ${c.confidence.level} (n=${c.confidence.sampleSize})`;
}

/** The single strongest, already-ranked pattern becomes "today's discovery" —
    the model's only job is to phrase these exact numbers, never to add to
    them. If nothing qualifies yet, it falls back to the plain overall stats
    and is told explicitly to keep the claim modest. */
export async function generateDiscovery(trades: TradeEntry[], lang: 'he' | 'en'): Promise<AiDiscovery | null> {
  if (trades.length < 3) return null;

  const analysis = runFullAnalysis(trades);
  const top = analysis.patterns[0];

  const langInstruction = lang === 'he'
    ? 'Respond entirely in Hebrew (עברית), natural and professional — this is a serious trader, not a beginner.'
    : 'Respond in English.';

  const focusFacts = top
    ? `TOP FINDING (already computed — this is the discovery, do not pick a different one and do not recompute it):\n${describeCandidate(top)}`
    : `No combo pattern has reached the minimum sample size yet. Use the OVERALL stats below as the discovery instead, and keep the claim modest — describe the win rate itself, don't imply a comparison that isn't backed by data.`;

  const prompt = `You are Onyx, the trading intelligence layer of a futures day-trading journal. You do NOT predict markets, you do NOT give buy/sell signals, and you NEVER tell the trader what to trade next. You only explain patterns already found in the trader's own historical data.

${langInstruction}

${focusFacts}

FULL CONTEXT (reference only — every number you use must already appear somewhere in this data):
${summarizeAnalysis(analysis)}

Produce exactly one JSON object, using ONLY the numbers given above:
{
  "title": "<one sentence naming the discovery, must include the specific number(s) it's based on>",
  "evidence": "<one sentence starting with 'Based on' citing the exact sample size(s) used>",
  "action": "<one sentence telling the trader what to pay attention to — never a buy/sell signal, never a market prediction>"
}

Rules:
- Every number in your response must come directly from the data above. Never invent, round dramatically, or estimate.
- If confidence is "low", explicitly say this is an early pattern, not a strong conclusion.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const result = await genAI.models.generateContent({
    model: AI_MODEL,
    contents: prompt,
  });

  const raw = result.text ?? '{}';
  let parsed: { title?: string; evidence?: string; action?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }

  if (!parsed.title || !parsed.evidence || !parsed.action) return null;

  const confidence = top ? top.confidence : analysis.performance.confidence;

  return {
    title: parsed.title,
    evidence: parsed.evidence,
    action: parsed.action,
    confidenceLevel: confidence.level,
    sampleSize: confidence.sampleSize,
  };
}
