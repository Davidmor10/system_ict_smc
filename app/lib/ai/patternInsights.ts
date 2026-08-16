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
export async function generatePatternInsights(trades: TradeEntry[], lang: 'he' | 'en', clerkId?: string | null): Promise<PatternInsight[]> {
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

For EACH pattern above, produce one JSON object:
{
  "i": <the number of the pattern above this object describes>,
  "title": "<one sentence naming the pattern, citing its specific numbers>",
  "evidence": "<one sentence starting with 'Based on' citing the exact sample size and stats used>"
}

Return a JSON array of exactly ${candidates.length} objects, each carrying the "i" of the pattern it describes.

Rules:
- Every number must come directly from the data given above. Never invent, round dramatically, or estimate.
- If confidence is "low", explicitly say this is an early/emerging pattern, not a strong conclusion.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await generateInsightText(prompt, clerkId === undefined ? undefined : { clerkId, purpose: 'pattern_insights' });
  let parsed: Array<{ i?: unknown; title?: string; evidence?: string }> = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) parsed = [];

  // Match on the echoed "i", not on array position.
  //
  // Everything the trader reads as fact here — the subject label, the
  // confidence tier, the sample size — is computed; only the sentence is the
  // model's. Pairing the two by position means one dropped or reordered object
  // silently prints MNQ's sentence under the ES header, with a real sample size
  // attached to it. That is not a worse insight, it is a false one, and nothing
  // downstream could detect it. An echoed index is cheap and makes the pairing
  // the model's own claim rather than our assumption; anything that doesn't
  // match a pattern we actually sent is dropped.
  const byIndex = new Map<number, { title?: string; evidence?: string }>();
  for (const item of parsed) {
    const n = typeof item?.i === 'number' ? item.i : Number(item?.i);
    if (Number.isInteger(n) && n >= 1 && n <= candidates.length && !byIndex.has(n)) {
      byIndex.set(n, item);
    }
  }

  return candidates
    .map((c, i) => {
      const phrased = byIndex.get(i + 1);
      return {
        subject: subjectLabel(c),
        title: phrased?.title ?? '',
        evidence: phrased?.evidence ?? '',
        confidenceLevel: c.confidence.level,
        sampleSize: c.confidence.sampleSize,
      };
    })
    .filter(p => p.title && p.evidence);
}
