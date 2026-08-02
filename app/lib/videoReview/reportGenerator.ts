// Report generator — the multi-source cross-reference engine.
// Takes: vision analysis + transcript + full trader context.
// Returns: the 9-section decision-analysis report.
//
// This is where "video summarizer" ends and "decision analyzer" begins:
// the LLM here is instructed to weigh evidence, flag contradictions, and
// refuse to assert without ≥2 sources for high-confidence claims.

import { genAI } from '../ai/client';
import { logger } from '../logger';
import { buildReportPrompt } from './prompts';
import type { TradeReviewReport, VisionAnalysis, Transcript, TraderContext, ReviewClaim, EvidencePointer, Confidence } from './types';

export async function generateReport(
  vision: VisionAnalysis,
  transcript: Transcript,
  ctx: TraderContext,
): Promise<TradeReviewReport> {
  const prompt = buildReportPrompt(vision, transcript, ctx);

  // Try in order: Gemini Pro (best reasoning), then flash, then flash-lite.
  // The report is the highest-stakes call in the pipeline — quality matters
  // more than latency.
  const attempts = [
    { model: 'gemini-2.5-flash' },
    { model: 'gemini-flash-latest' },
    { model: 'gemini-2.5-flash-lite' },
  ];

  let lastErr: unknown;
  for (const { model } of attempts) {
    try {
      const result = await genAI.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const text = result.text;
      if (!text) { logger.warn('report generator: empty response', { model }); continue; }
      const parsed = safeParseReport(text);
      if (parsed) return validateAndSanitize(parsed);
      logger.warn('report generator: JSON did not match schema', { model });
    } catch (err) {
      lastErr = err;
      logger.warn('report generator model failed', { model, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw lastErr ?? new Error('report generator: all attempts failed');
}

/** Enforce the discipline the prompt asks for. If a claim came back without
    evidence, we drop it — because that's the whole promise of this system.
    Exported for unit tests. */
export function validateAndSanitize(r: TradeReviewReport): TradeReviewReport {
  const cleanClaim = (c: ReviewClaim): ReviewClaim | null => {
    if (!c || typeof c.claim !== 'string' || !c.claim.trim()) return null;
    const evidence = Array.isArray(c.evidence) ? c.evidence.filter(isValidEvidence) : [];
    if (evidence.length === 0) return null;
    const confidence = normalizeConfidence(c.confidence);
    // Downgrade high→medium if only one source (per our own contract).
    const sources = new Set(evidence.map(e => e.source));
    const finalConf: Confidence = confidence === 'high' && sources.size < 2 ? 'medium' : confidence;
    return { ...c, evidence, confidence: finalConf };
  };
  const cleanArr = (arr: ReviewClaim[] | undefined): ReviewClaim[] =>
    Array.isArray(arr) ? arr.map(cleanClaim).filter((c): c is ReviewClaim => c !== null) : [];

  const verdict = r.decisionVerdict ?? { verdict: 'unclear', reasoning: '', confidence: 'low' as Confidence, evidence: [] };
  return {
    whatHappened:      cleanArr(r.whatHappened),
    decisionVerdict: {
      verdict:    ['correct','partially-correct','incorrect','unclear'].includes(verdict.verdict) ? verdict.verdict : 'unclear',
      reasoning:  typeof verdict.reasoning === 'string' ? verdict.reasoning : '',
      confidence: normalizeConfidence(verdict.confidence),
      evidence:   Array.isArray(verdict.evidence) ? verdict.evidence.filter(isValidEvidence) : [],
    },
    mistakes:          cleanArr(r.mistakes),
    goodDecisions:     cleanArr(r.goodDecisions),
    rulesBroken:       cleanArr(r.rulesBroken),
    recurringPatterns: cleanArr(r.recurringPatterns),
    overallConfidence: normalizeConfidence(r.overallConfidence),
    alternativeReadings: Array.isArray(r.alternativeReadings) ? r.alternativeReadings.filter(s => typeof s === 'string' && s.trim()) : [],
    oneThingToImprove: r.oneThingToImprove && typeof r.oneThingToImprove.habit === 'string'
      ? {
          habit: r.oneThingToImprove.habit,
          whyThisOne: r.oneThingToImprove.whyThisOne ?? '',
          howToPractice: r.oneThingToImprove.howToPractice ?? '',
          evidence: Array.isArray(r.oneThingToImprove.evidence) ? r.oneThingToImprove.evidence.filter(isValidEvidence) : [],
        }
      : { habit: '', whyThisOne: '', howToPractice: '', evidence: [] },
  };
}

function isValidEvidence(e: EvidencePointer | unknown): e is EvidencePointer {
  if (!e || typeof e !== 'object') return false;
  const ee = e as Record<string, unknown>;
  const validSources = ['video-frame','transcript','trade-record','rule','setup','stats','pattern-memory'];
  return validSources.includes(ee.source as string) && typeof ee.label === 'string';
}

function normalizeConfidence(c: unknown): Confidence {
  return c === 'high' || c === 'medium' || c === 'low' ? c : 'low';
}

function safeParseReport(raw: string): TradeReviewReport | null {
  const slice = extractJsonObject(raw);
  if (!slice) return null;
  try { return JSON.parse(slice) as TradeReviewReport; } catch { return null; }
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fence = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(raw);
  if (fence) return fence[1];
  const first = raw.indexOf('{');
  const last  = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return null;
}
