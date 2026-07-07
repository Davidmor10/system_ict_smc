// ─────────────────────────────────────────────────────────────────────────────
// Small "phrase this single already-selected thing" prompts — distinct from
// weeklyNarrative.ts's full weekly letter. Both functions here take numbers
// that are already computed (a hypothesis or a pattern_memory row) and only
// ask the model to put them into plain Hebrew; neither computes a statistic
// or picks which thing to phrase — that's dashboardInsight.ts/hypothesis.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupPerformance } from '../analytics';
import type { HypothesisStatus, PatternMemoryRow } from '../intelligence/types';
import { fmtPF } from './factsBlock';
import { generateInsightText } from './client';
import { HEBREW_MENTOR_STYLE } from './styleGuide';

function fmtMetric(label: string, g: GroupPerformance): string {
  return `${label}: ${g.trades} trades, winRate ${g.winRate.toFixed(0)}%, avgRR ${g.avgRR.toFixed(2)}, PF ${fmtPF(g.profitFactor)}, PnL $${g.totalPnl.toFixed(0)}`;
}

export interface HypothesisPhrasingInput {
  status: HypothesisStatus;
  confidenceScore: number;
  supportingMetrics: Record<string, GroupPerformance>;
}

export interface HypothesisPhrasing {
  description: string;
  evidence: string;
}

/** Phrases the Hypothesis Engine's current synthesized edge (built from a
    cluster of corroborating pattern_memory rows) into one or two sentences —
    e.g. "Long MNQ during NY AM when IFVG confirmation is present." Only
    called when the hypothesis's identity actually changed (a fresh anchor
    pattern) — a continuing hypothesis reuses its cached phrasing instead. */
export async function generateHypothesisPhrasing(input: HypothesisPhrasingInput, lang: 'he' | 'en'): Promise<HypothesisPhrasing | null> {
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const metricsList = Object.entries(input.supportingMetrics)
    .map(([id, g]) => `${id} — ${fmtMetric(id, g)}`)
    .join('\n');

  const prompt = `You are Onyx, an experienced trading mentor. You are naming the trader's current strongest edge hypothesis — a synthesized belief about where their edge comes from, built ONLY from the pre-computed metrics below (already discovered by the analytics engine, not by you). You do NOT predict markets and NEVER give buy/sell signals.

${langInstruction}

SUPPORTING METRICS (already computed — cite only these numbers):
${metricsList}

STATUS: ${input.status}
CONFIDENCE SCORE: ${input.confidenceScore}/100

Produce exactly one JSON object:
{
  "description": "<one or two sentences naming the hypothesis, in the style of: 'Your current edge appears to come from Long trades on MNQ during NY AM when IFVG confirmation is present.' Must cite the specific instrument/session/direction/confirmation from the metrics above>",
  "evidence": "<one sentence starting with 'Based on' citing the exact sample size(s) and win rate(s) used>"
}

Rules:
- Every number must come directly from the metrics above. Never invent, round dramatically, or estimate.
- If status is "weakening", say so plainly in the description rather than overstating confidence.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await generateInsightText(prompt);
  let parsed: { description?: string; evidence?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.description || !parsed.evidence) return null;
  return { description: parsed.description, evidence: parsed.evidence };
}

export interface PatternPhrasing {
  title: string;
  evidence: string;
  action: string;
}

/** Dashboard fallback phrasing for a single pattern_memory row, used when no
    hypothesis has cleared the bar yet. Same voice and output shape
    (title/evidence/action) as the dashboard's AiDiscovery, but phrases an
    already-selected pattern_memory row instead of re-running analysis over
    raw trades. */
export async function generatePatternPhrasing(row: PatternMemoryRow, lang: 'he' | 'en'): Promise<PatternPhrasing | null> {
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const g = row.currentMetric;

  const prompt = `You are Onyx, an experienced trading mentor reviewing a futures day-trader's journal — talking straight, like one trader to another. You do NOT predict markets, you do NOT give buy/sell signals, and you NEVER tell the trader what to trade next. You only explain a pattern already found in the trader's own historical data.

${langInstruction}

PATTERN (already computed — this is the discovery, do not recompute it):
${JSON.stringify(row.subject)}: ${g.trades} trades, winRate ${g.winRate.toFixed(0)}% (overall winRate is ${row.baselineWinRate.toFixed(0)}%), PnL $${g.totalPnl.toFixed(0)}, avgRR ${g.avgRR.toFixed(2)}, confidence ${row.currentConfidenceLevel} (n=${row.currentSampleSize}), status ${row.status}

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

  const raw = await generateInsightText(prompt);
  let parsed: { title?: string; evidence?: string; action?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.title || !parsed.evidence || !parsed.action) return null;
  return { title: parsed.title, evidence: parsed.evidence, action: parsed.action };
}
