import type { TradeEntry } from '../journal';
import { runFullAnalysis, type PatternCandidate, type ConfidenceLevel } from '../analytics';
import { SESS } from '../sessions';
import { fmtPF } from './factsBlock';
import { generateInsightJson } from './client';
import { HEBREW_MENTOR_STYLE } from './styleGuide';
import { logger } from '../logger';

function tryParse(json: string | undefined): unknown {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export interface PatternInsight {
  /** Short dimension label (e.g. "MNQ · ניו יורק AM") — computed, never AI-generated. */
  subject: string;
  title: string;
  evidence: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
  /** Win-rate gap against the trader's own baseline, in points. Positive is a
   *  slice that outperforms. Carried so the page can show which way a pattern
   *  points without the reader parsing the sentence for it. */
  delta: number;
  /** Cleared the significance test after correction for the number of slices
   *  compared. A pattern that did not is real raw material and worth showing —
   *  it is simply not yet an edge, and the page has to say which is which. */
  significant: boolean;
}

/** How many patterns reach the page.
 *
 *  This was 5, which quietly made the section a highlight reel: the sort puts
 *  significant patterns first, so five slots meant a trader with six real
 *  findings never saw the sixth, and nobody could tell from the screen that
 *  anything had been held back.
 *
 *  Now every SIGNIFICANT pattern goes through regardless of the cap, and the
 *  cap only limits how many of the not-yet-significant ones ride along behind
 *  them. One model call either way — the cost is prompt tokens, not requests. */
const MAX_PATTERNS = 12;
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

/** True when a sentence is written in Latin script rather than Hebrew. Counts
 *  letters only: tickers, tags and digits are expected inside Hebrew prose and
 *  must not tip the verdict on their own. */
export function isMostlyLatin(text: string): boolean {
  const hebrew = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  // Below a dozen Latin letters there is no English sentence — only tickers,
  // tags and units ("MNQ", "NY AM", "+1.31R"), all of which belong in Hebrew
  // prose and must not be mistaken for it.
  if (latin < 12) return false;
  return latin > hebrew;
}

/**
 * The evidence line — computed, never generated.
 *
 * This used to be the model's job, and it was the source of the English
 * sentences that kept appearing under Hebrew titles. It never needed a model:
 * it is a restatement of numbers the analytics engine already produced, and
 * asking a language model to retype them bought nothing while risking the
 * language, the rounding, and the occasional invented figure. Written here it
 * is always Hebrew, always exactly the computed values, and cannot drift.
 */
function evidenceLine(c: PatternCandidate, he: boolean): string {
  const g = c.metric;
  if (!he) {
    return `Based on ${g.trades} trades: ${g.winRate.toFixed(0)}% win rate vs ${c.baseline.toFixed(0)}% overall, ` +
      `avg R/R ${g.avgRR.toFixed(2)}, profit factor ${fmtPF(g.profitFactor)}.`;
  }
  const parts = [
    `מבוסס על ${g.trades} עסקאות`,
    `${g.winRate.toFixed(0)}% הצלחה מול ${c.baseline.toFixed(0)}% בממוצע הכללי`,
    `יחס סיכון־סיכוי ממוצע ${g.avgRR.toFixed(2)}`,
    `פרופיט פקטור ${fmtPF(g.profitFactor)}`,
  ];
  return `${parts.join(' · ')}.`;
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
  const eligible = analysis.patterns.filter(c => c.confidence.sampleSize >= 3);
  const significant = eligible.filter(c => c.significant);
  const emerging = eligible.filter(c => !c.significant);
  // Everything that passed the test, then as many of the rest as the cap allows.
  const candidates = [...significant, ...emerging].slice(0, Math.max(MAX_PATTERNS, significant.length));
  if (candidates.length === 0) return [];

  const isHe = lang === 'he';
  const langInstruction = isHe ? HEBREW_MENTOR_STYLE : 'Respond in English.';

  const list = candidates.map((c, i) => `${i + 1}. ${describeCandidate(c)}`).join('\n');

  const prompt = `You are Onyx, an experienced trading mentor reviewing a futures day-trader's journal — talking straight, like one trader to another. You do NOT predict markets and you NEVER give buy/sell signals — you only explain recurring patterns already found in the trader's own historical data.

${langInstruction}

Below are pre-ranked statistical patterns already discovered in this trader's data (already computed — cite only these numbers, never recompute or invent new ones):
${list}

Return exactly one JSON object with a single field "items", holding ${candidates.length} object(s) — one per pattern above, each carrying the "i" of the pattern it describes:
{"items": [
  {
    "i": <the number of the pattern above this object describes>,
    "title": "<one sentence naming the pattern, citing its specific numbers>"
  }
]}

Rules:
- Every number must come directly from the data given above. Never invent, round dramatically, or estimate.
- If confidence is "low", explicitly say this is an early/emerging pattern, not a strong conclusion.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  let raw: string;
  try {
    raw = await generateInsightJson(prompt, clerkId === undefined ? undefined : { clerkId, purpose: 'pattern_insights' });
  } catch (err) {
    logger.error('generatePatternInsights: AI generation failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }

  // Wrapped object first (what the prompt asks for, and the only shape Groq's
  // JSON mode will return), bare array second. Separate parses: a bare array of
  // objects makes the object regex match something invalid, and a shared try
  // would let that failure swallow the fallback.
  const wrapped = tryParse(raw.match(/\{[\s\S]*\}/)?.[0]);
  const items =
    Array.isArray((wrapped as { items?: unknown })?.items)
      ? (wrapped as { items: unknown[] }).items
      : tryParse(raw.match(/\[[\s\S]*\]/)?.[0]);
  const parsed = (Array.isArray(items) ? items : []) as Array<{ i?: unknown; title?: string }>;

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
  const byIndex = new Map<number, { title?: string }>();
  for (const item of parsed) {
    const n = typeof item?.i === 'number' ? item.i : Number(item?.i);
    if (Number.isInteger(n) && n >= 1 && n <= candidates.length && !byIndex.has(n)) {
      byIndex.set(n, item);
    }
  }

  return candidates
    .map((c, i) => ({
      subject: subjectLabel(c),
      title: byIndex.get(i + 1)?.title ?? '',
      evidence: evidenceLine(c, isHe),
      confidenceLevel: c.confidence.level,
      sampleSize: c.confidence.sampleSize,
      delta: c.delta,
      significant: c.significant,
    }))
    // A title that came back in Latin is dropped rather than printed. One card
    // fewer is a smaller failure than an English card on a Hebrew page, and
    // unlike the evidence line there is nothing to rebuild it from — the title
    // is the interpretation, which is the part only the model can write.
    .filter(p => p.title && !(isHe && isMostlyLatin(p.title)));
}
