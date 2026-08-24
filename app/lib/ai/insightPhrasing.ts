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
import { generateInsightJson } from './client';
import { HEBREW_MENTOR_STYLE } from './styleGuide';
import { logger } from '../logger';
import type { AiCallMeta } from './client';

/** Wraps generateInsightJson so a total provider failure (e.g. missing/
    invalid API keys) is logged with which caller hit it and resolves to
    null, instead of throwing uncaught up into the API route as an
    unexplained 500.

    Every prompt here asks the provider for JSON at the API level, not only in
    words — so the shape is enforced before the text comes back rather than
    hoped for and then dug out with a regex. Each one must therefore ask for an
    OBJECT: Groq rejects a top-level array in this mode. */
async function tryGenerate(caller: string, prompt: string, clerkId?: string | null): Promise<string | null> {
  try {
    // `caller` doubles as the purpose on the usage row — the same string that
    // identifies the failure in the log identifies the spend in the ledger.
    const meta: AiCallMeta | undefined =
      clerkId === undefined ? undefined : { clerkId, purpose: caller };
    return await generateInsightJson(prompt, meta);
  } catch (err) {
    logger.error('AI text generation failed', { caller, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The JSON shape both batch-phrasing prompts ask for, and the parser that
 *  turns it back into one string per input item, in the caller's order.
 *
 *  WHY AN INDEX AND NOT JUST AN ARRAY
 *
 *  The caller pairs each returned string with a computed item — a pattern, a
 *  confirmed strength — and the UI then prints that item's real subject label,
 *  sample size and confidence next to the model's sentence. Pairing by array
 *  position means a single dropped or reordered element prints one pattern's
 *  sentence under another pattern's header, carrying a sample size that was
 *  never behind it. That is not a vaguer insight, it is a false one, and no
 *  later layer can tell. Asking the model to echo which item it is describing
 *  makes the pairing its own claim; unmatched items come back empty and the
 *  caller drops them.
 *
 *  A model that ignores the shape and returns a bare array of strings still
 *  works positionally — that is the old behaviour, kept as the floor rather
 *  than the contract.
 *
 *  The list is wrapped in an object because these calls run in the provider's
 *  JSON mode, and Groq rejects a top-level array there. The parser accepts the
 *  bare array too, so a provider that answers with one is still understood. */
const INDEXED_ARRAY_SPEC = (count: number) =>
  `Produce exactly one JSON object with a single field "items", holding ${count} object(s) — one per numbered item above, each carrying the "i" of the item it describes:
{"items": [{"i": <item number>, "text": "<the sentence for that item>"}, ...]}`;

function tryParse(json: string | undefined): unknown {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function parseIndexedTexts(raw: string, count: number): string[] | null {
  // Two independent reads, each in its own try. A bare array of objects makes
  // the object regex match from its first "{" to its last "}" and throw — so a
  // single shared try would let the wrapped read's failure swallow the fallback
  // that was about to succeed.
  const wrapped = tryParse(raw.match(/\{[\s\S]*\}/)?.[0]);
  const items =
    Array.isArray((wrapped as { items?: unknown })?.items)
      ? (wrapped as { items: unknown[] }).items
      : tryParse(raw.match(/\[[\s\S]*\]/)?.[0]);

  const parsed: unknown = items;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const out = Array<string>(count).fill('');
  let matched = 0;
  parsed.forEach((item, pos) => {
    if (typeof item === 'string') {
      // Bare-array fallback: position is all we have.
      if (pos < count && !out[pos]) { out[pos] = item; matched += 1; }
      return;
    }
    const o = item as { i?: unknown; text?: unknown };
    const n = typeof o?.i === 'number' ? o.i : Number(o?.i);
    const text = typeof o?.text === 'string' ? o.text : '';
    if (Number.isInteger(n) && n >= 1 && n <= count && text && !out[n - 1]) {
      out[n - 1] = text;
      matched += 1;
    }
  });
  return matched > 0 ? out : null;
}

/**
 * The evidence line — computed, never generated.
 *
 * The model used to write this, and that is where the English sentences under
 * Hebrew titles came from: a schema that said «start with 'Based on'» was read
 * as an instruction about language. But the line never needed a model. It
 * restates numbers the analytics engine already produced, so writing it here
 * makes it always Hebrew, always exactly the computed values, and immune to
 * drift — while the model keeps the part that actually needs judgement.
 */
export function groupEvidence(g: GroupPerformance, baselineWinRate: number | null, he: boolean): string {
  const vs = baselineWinRate === null
    ? ''
    : he ? ` מול ${baselineWinRate.toFixed(0)}% בממוצע הכללי` : ` vs ${baselineWinRate.toFixed(0)}% overall`;

  return he
    ? `מבוסס על ${g.trades} עסקאות · ${g.winRate.toFixed(0)}% הצלחה${vs} · יחס סיכון־סיכוי ממוצע ${g.avgRR.toFixed(2)} · פרופיט פקטור ${fmtPF(g.profitFactor)}.`
    : `Based on ${g.trades} trades: ${g.winRate.toFixed(0)}% win rate${vs}, avg R/R ${g.avgRR.toFixed(2)}, profit factor ${fmtPF(g.profitFactor)}.`;
}

/**
 * The same line for a hypothesis, which rests on a cluster of slices.
 *
 * Built from the anchor — the first metric, the same one the sample size is
 * taken from — plus a count of the slices that corroborate it. The cluster is
 * keyed by pattern id (`session:nyam`), so listing the keys would print
 * internals at the trader; the count says the same thing in words they use.
 */
export function metricsEvidence(metrics: Record<string, GroupPerformance>, he: boolean): string {
  const all = Object.values(metrics);
  const anchor = all[0];
  if (!anchor) return '';

  const others = all.length - 1;
  const also = others <= 0 ? ''
    : he ? ` · ועוד ${others} ${others === 1 ? 'חתך תומך' : 'חתכים תומכים'}`
         : ` · plus ${others} corroborating slice${others === 1 ? '' : 's'}`;

  return groupEvidence(anchor, null, he).replace(/\.$/, '') + also + '.';
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
  const isHe = lang === 'he';
  const langInstruction = isHe ? HEBREW_MENTOR_STYLE : 'Respond in English.';
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
  "description": "<one or two sentences naming the hypothesis, in the style of: 'Your current edge appears to come from Long trades on MNQ during NY AM when IFVG confirmation is present.' Must cite the specific instrument/session/direction/confirmation from the metrics above>"
}

Rules:
- Every number must come directly from the metrics above. Never invent, round dramatically, or estimate.
- If status is "weakening", say so plainly in the description rather than overstating confidence.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await tryGenerate('generateHypothesisPhrasing', prompt, clerkId);
  if (raw === null) return null;

  let parsed: { description?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.description) {
    logger.warn('generateHypothesisPhrasing: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  return { description: parsed.description, evidence: metricsEvidence(input.supportingMetrics, isHe) };
}

export interface InsightPhrasingItem {
  subject: string;
  metric: GroupPerformance;
  extra?: string;
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
  const isHe = lang === 'he';
  const langInstruction = isHe ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const g = row.currentMetric;

  const prompt = `You are Onyx, an experienced trading mentor reviewing a futures day-trader's journal — talking straight, like one trader to another. You do NOT predict markets, you do NOT give buy/sell signals, and you NEVER tell the trader what to trade next. You only explain a pattern already found in the trader's own historical data.

${langInstruction}

PATTERN (already computed — this is the discovery, do not recompute it):
${JSON.stringify(row.subject)}: ${g.trades} trades, winRate ${g.winRate.toFixed(0)}% (overall winRate is ${row.baselineWinRate.toFixed(0)}%), PnL $${g.totalPnl.toFixed(0)}, avgRR ${g.avgRR.toFixed(2)}, confidence ${row.currentConfidenceLevel} (n=${row.currentSampleSize}), status ${row.status}

Produce exactly one JSON object, using ONLY the numbers given above:
{
  "title": "<one sentence naming the discovery, must include the specific number(s) it's based on>",
  "action": "<one sentence telling the trader what to pay attention to — never a buy/sell signal, never a market prediction>"
}

Rules:
- Every number in your response must come directly from the data above. Never invent, round dramatically, or estimate.
- If confidence is "low", explicitly say this is an early pattern, not a strong conclusion.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await tryGenerate('generatePatternPhrasing', prompt, clerkId);
  if (raw === null) return null;

  let parsed: { title?: string; action?: string } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.title || !parsed.action) {
    logger.warn('generatePatternPhrasing: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  return {
    title: parsed.title,
    evidence: groupEvidence(g, row.baselineWinRate, isHe),
    action: parsed.action,
  };
}
