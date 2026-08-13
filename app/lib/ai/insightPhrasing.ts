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
import { logger } from '../logger';
import type { AiCallMeta } from './client';

/** Wraps generateInsightText so a total provider failure (e.g. missing/
    invalid API keys) is logged with which caller hit it and resolves to
    null, instead of throwing uncaught up into the API route as an
    unexplained 500. */
async function tryGenerate(caller: string, prompt: string, clerkId?: string | null): Promise<string | null> {
  try {
    // `caller` doubles as the purpose on the usage row — the same string that
    // identifies the failure in the log identifies the spend in the ledger.
    const meta: AiCallMeta | undefined =
      clerkId === undefined ? undefined : { clerkId, purpose: caller };
    return await generateInsightText(prompt, meta);
  } catch (err) {
    logger.error('AI text generation failed', { caller, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

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
export async function generateHypothesisPhrasing(input: HypothesisPhrasingInput, lang: 'he' | 'en', clerkId?: string | null): Promise<HypothesisPhrasing | null> {
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

  const raw = await tryGenerate('generateHypothesisPhrasing', prompt, clerkId);
  if (raw === null) return null;

  let parsed: { description?: string; evidence?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.description || !parsed.evidence) {
    logger.warn('generateHypothesisPhrasing: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  return { description: parsed.description, evidence: parsed.evidence };
}

export interface InsightPhrasingItem {
  subject: string;
  metric: GroupPerformance;
  extra?: string;
}

/** Phrases a small batch of already-selected items (a hypothesis, recurring
    patterns, a real risk pattern) into short, specific insights — one LLM
    call for the whole batch instead of one per item. No forced category
    names (no "opportunity"/"warning"/"pattern" schema): each insight is just
    text, grounded only in the numbers given, in the same order as `items`. */
export async function generateInsightsPhrasing(items: InsightPhrasingItem[], lang: 'he' | 'en', clerkId?: string | null): Promise<string[] | null> {
  if (items.length === 0) return [];
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const list = items
    .map((it, i) => `${i + 1}. ${it.subject} — ${fmtMetric(it.subject, it.metric)}${it.extra ? ` (${it.extra})` : ''}`)
    .join('\n');

  const prompt = `You are Onyx, an experienced trading mentor reviewing a trader's own journal data. Write ${items.length} short, specific, personalized insight(s) for this trader — each grounded only in the exact numbers given below. Do not slot these into generic categories like "opportunity" or "warning" — just say what the data actually shows, in whatever way fits that specific data. You do NOT predict markets and NEVER give buy/sell signals.

${langInstruction}

ITEMS (already computed — cite only these numbers, keep the same order):
${list}

Produce exactly one JSON array of ${items.length} string(s), one per item above, in order, each 1-2 sentences:
["<insight for item 1>", "<insight for item 2>", ...]

Rules:
- Every number must come directly from the data above. Never invent, round dramatically, or estimate.
- Make each insight feel specific to this exact data, not a generic sentence that could apply to any trader.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await tryGenerate('generateInsightsPhrasing', prompt, clerkId);
  if (raw === null) return null;

  let parsed: unknown[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    logger.warn('generateInsightsPhrasing: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  return parsed.map(p => (typeof p === 'string' ? p : ''));
}

export interface StrengthPhrasingItem {
  /** Already Hebrew (or English, per lang) — built deterministically before
      this call, so the model never has to translate a field identifier. */
  subjectLabel: string;
  metric: GroupPerformance;
  baseline: number;
  trend: 'up' | 'flat' | 'down';
}

/** Phrases a batch of already-confirmed recurring strengths (each one already
    verified by pattern_memory to outperform the trader's own baseline) for the
    "מה באמת עובד לך" section — one LLM call for the whole batch. Distinct from
    generateInsightsPhrasing: every item here is a genuine, above-baseline edge,
    so the prompt leans on trend (strengthening/stable/weakening) rather than a
    fresh discovery framing. */
export async function generateWorkingStrengthsPhrasing(items: StrengthPhrasingItem[], lang: 'he' | 'en', clerkId?: string | null): Promise<string[] | null> {
  if (items.length === 0) return [];
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const trendWord = (t: StrengthPhrasingItem['trend']) =>
    t === 'up' ? 'strengthening — recent performance is improving'
    : t === 'down' ? 'weakening — recent performance has declined'
    : 'stable — holding steady over the sample';
  const list = items
    .map((it, i) => `${i + 1}. "${it.subjectLabel}" — ${fmtMetric(it.subjectLabel, it.metric)}, overall baseline winRate ${it.baseline.toFixed(0)}%, recent trend: ${trendWord(it.trend)}`)
    .join('\n');

  const prompt = `You are Onyx, an experienced trading mentor reviewing a futures day-trader's own journal. Below are ${items.length} genuine recurring strengths already confirmed in this trader's data — each one already verified to outperform their overall baseline win rate. Write one short, evidence-based sentence per strength explaining why it holds up and what its recent trend means. You do NOT predict markets and NEVER give buy/sell signals.

${langInstruction}
Write in natural, conversational language with no unnecessary jargon. Do NOT mix in English words beyond the trader's own ICT-style tags already embedded in the subject label (e.g. SMT, IFVG, CISD, Order Block, instrument tickers) — keep those exactly as given, never translate or alter them, but every other word must be in the target language.

STRENGTHS (already computed — cite only these numbers, keep the same order):
${list}

Produce exactly one JSON array of ${items.length} string(s), one per strength above, in order, each ONE short sentence (max ~25 words):
["<explanation for strength 1>", ...]

Rules:
- Every number must come directly from the data above. Never invent, round dramatically, or estimate.
- If the trend is "weakening", say so plainly — mention that recent performance has declined and it's worth checking what changed. Never soften this into vague reassurance.
- If the trend is "strengthening", say the pattern has been getting stronger recently.
- If the trend is "stable", emphasize consistency/reliability across the sample rather than describing a change.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await tryGenerate('generateWorkingStrengthsPhrasing', prompt, clerkId);
  if (raw === null) return null;

  let parsed: unknown[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    logger.warn('generateWorkingStrengthsPhrasing: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  return parsed.map(p => (typeof p === 'string' ? p : ''));
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
export async function generatePatternPhrasing(row: PatternMemoryRow, lang: 'he' | 'en', clerkId?: string | null): Promise<PatternPhrasing | null> {
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

  const raw = await tryGenerate('generatePatternPhrasing', prompt, clerkId);
  if (raw === null) return null;

  let parsed: { title?: string; evidence?: string; action?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.title || !parsed.evidence || !parsed.action) {
    logger.warn('generatePatternPhrasing: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  return { title: parsed.title, evidence: parsed.evidence, action: parsed.action };
}
