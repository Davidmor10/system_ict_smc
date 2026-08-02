// Vision analysis of a trade-review video.
// Uses Gemini's native video understanding (samples ~1 fps automatically) so
// we don't need ffmpeg / manual frame extraction. The prompt forces the model
// to read ONLY the chart — cross-referencing with speech / trade data lives
// in the report generator.

import { genAI } from '../ai/client';
import { logger } from '../logger';
import { VISION_PROMPT } from './prompts';
import type { VisionAnalysis } from './types';

/** Analyze the chart in a trade-review video. Takes a Gemini File API URI
    (already uploaded + ACTIVE) and returns a structured VisionAnalysis. */
export async function analyzeVideoChart(fileUri: string, mimeType: string): Promise<VisionAnalysis> {
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
        contents: [
          { role: 'user', parts: [
            { fileData: { fileUri, mimeType } },
            { text: VISION_PROMPT },
          ] },
        ],
        config: { responseMimeType: 'application/json' },
      });
      const text = result.text;
      if (!text) { logger.warn('vision analyzer: empty response', { model }); continue; }
      const parsed = safeParseVision(text);
      if (parsed) return parsed;
      logger.warn('vision analyzer: JSON did not match schema', { model });
    } catch (err) {
      lastErr = err;
      logger.warn('vision analyzer model failed', { model, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw lastErr ?? new Error('vision analyzer: all attempts failed');
}

/** Defensive JSON parse — if the model returns a fenced/wrapped payload, still recover.
    Returns null if we can't produce a valid VisionAnalysis. */
function safeParseVision(raw: string): VisionAnalysis | null {
  const jsonSlice = extractJsonObject(raw);
  if (!jsonSlice) return null;
  let obj: unknown;
  try { obj = JSON.parse(jsonSlice); } catch { return null; }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;

  // Minimal validation — the pipeline downstream tolerates missing arrays,
  // but a completely wrong shape would poison the report.
  const ms = (o.marketStructure ?? {}) as Record<string, unknown>;
  const liq = (o.liquidity ?? {}) as Record<string, unknown>;
  const imb = (o.imbalances ?? {}) as Record<string, unknown>;

  return {
    timeframe: typeof o.timeframe === 'string' ? o.timeframe : undefined,
    marketStructure: {
      bosDetected: Array.isArray(ms.bosDetected) ? ms.bosDetected as VisionAnalysis['marketStructure']['bosDetected'] : [],
      chochDetected: Array.isArray(ms.chochDetected) ? ms.chochDetected as VisionAnalysis['marketStructure']['chochDetected'] : [],
    },
    liquidity: {
      sweeps: Array.isArray(liq.sweeps) ? liq.sweeps as VisionAnalysis['liquidity']['sweeps'] : [],
      pools:  Array.isArray(liq.pools)  ? liq.pools  as VisionAnalysis['liquidity']['pools']  : [],
    },
    imbalances: {
      fvgs: Array.isArray(imb.fvgs) ? imb.fvgs as VisionAnalysis['imbalances']['fvgs'] : [],
    },
    entry:  o.entry  === null || (typeof o.entry === 'object' && o.entry)   ? (o.entry as VisionAnalysis['entry'])   : null,
    stop:   o.stop   === null || (typeof o.stop === 'object' && o.stop)     ? (o.stop as VisionAnalysis['stop'])     : null,
    target: o.target === null || (typeof o.target === 'object' && o.target) ? (o.target as VisionAnalysis['target']) : null,
    pointingMoments: Array.isArray(o.pointingMoments) ? o.pointingMoments as VisionAnalysis['pointingMoments'] : [],
    notes: typeof o.notes === 'string' ? o.notes : '',
  };
}

/** Some providers wrap JSON in ```json fences or add prose. Isolate the {…}. */
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
