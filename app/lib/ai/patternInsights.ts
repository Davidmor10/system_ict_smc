import type { TradeEntry } from '../journal';
import { runFullAnalysis, type PatternCandidate, type ConfidenceLevel } from '../analytics';
import { SESS } from '../sessions';
import { fmtPF } from './factsBlock';
import { generateInsightText } from './client';
import { HEBREW_MENTOR_STYLE } from './styleGuide';

export interface PatternInsight {
  /** Short dimension label (e.g. "MNQ · ניו יורק AM") — computed, never AI-generated. */
  subject: string;
  title: string;
  evidence: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

const MAX_PATTERNS = 5;
const SESSION_HE: Record<string, string> = Object.fromEntries(SESS.map(s => [s.key, s.he]));
const DIRECTION_HE: Record<string, string> = { LONG: 'לונג', SHORT: 'שורט' };

/** Builds the subject label straight from the candidate's structured
    `subject` record (instrument/session/direction/hour/confirmation) rather
    than the engine's pre-baked `metric.label`, which still carries English
    session/direction names from before the app went Hebrew-only. */
function subjectLabel(c: PatternCandidate): string {
  const s = c.subject;
  const parts: string[] = [];
  if (s.instrument) parts.push(String(s.instrument));
  if (s.confirmation) parts.push(String(s.confirmation));
  if (s.session) parts.push(SESSION_HE[String(s.session)] ?? String(s.session));
  if (s.direction) parts.push(DIRECTION_HE[String(s.direction)] ?? String(s.direction));
  if (s.hour !== undefined) parts.push(`${String(s.hour).padStart(2, '0')}:00`);
  return parts.join(' · ');
}

function describeCandidate(c: PatternCandidate): string {
  const g = c.metric;
  return `${subjectLabel(c)}: ${g.trades} trades, winRate ${g.winRate.toFixed(0)}% (overall ${c.baseline.toFixed(0)}%), ` +
    `PnL $${g.totalPnl.toFixed(0)}, avgRR ${g.avgRR.toFixed(2)}, PF ${fmtPF(g.profitFactor)}, confidence ${c.confidence.level} (n=${c.confidence.sampleSize})`;
}

/** Phrases the top-ranked pattern candidates already discovered by the
    analytics engine (`discoverPatterns`) into one sentence + evidence each.
    Confidence and sample size always come from the computed candidate, never
    from the model's output — the AI is only allowed to describe numbers that
    already exist. */
export async function generatePatternInsights(trades: TradeEntry[], lang: 'he' | 'en'): Promise<PatternInsight[]> {
  if (trades.length < 3) return [];

  const analysis = runFullAnalysis(trades);
  const candidates = analysis.patterns.filter(c => c.confidence.sampleSize >= 3).slice(0, MAX_PATTERNS);
  if (candidates.length === 0) return [];

  const isHe = lang === 'he';
  const langInstruction = isHe ? HEBREW_MENTOR_STYLE : 'Respond in English.';

  const list = candidates.map((c, i) => `${i + 1}. ${describeCandidate(c)}`).join('\n');

  const prompt = `You are Onyx, an experienced trading mentor reviewing a futures day-trader's journal — talking straight, like one trader to another. You do NOT predict markets and you NEVER give buy/sell signals — you only explain recurring patterns already found in the trader's own historical data.

${langInstruction}

Below are pre-ranked statistical patterns already discovered in this trader's data (already computed — cite only these numbers, never recompute or invent new ones):
${list}

For EACH pattern above, produce one JSON object, in the same order:
{
  "title": "<one sentence naming the pattern, citing its specific numbers>",
  "evidence": "<one sentence starting with 'Based on' citing the exact sample size and stats used>"
}

Return a JSON array of exactly ${candidates.length} objects.

Rules:
- Every number must come directly from the data given above. Never invent, round dramatically, or estimate.
- If confidence is "low", explicitly say this is an early/emerging pattern, not a strong conclusion.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await generateInsightText(prompt);
  let parsed: Array<{ title?: string; evidence?: string }> = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
  } catch {
    parsed = [];
  }

  return candidates
    .map((c, i) => ({
      subject: subjectLabel(c),
      title: parsed[i]?.title ?? '',
      evidence: parsed[i]?.evidence ?? '',
      confidenceLevel: c.confidence.level,
      sampleSize: c.confidence.sampleSize,
    }))
    .filter(p => p.title && p.evidence);
}
