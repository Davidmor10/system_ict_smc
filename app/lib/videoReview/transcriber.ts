// Speech transcription for a trade-review video.
// Gemini's video-with-audio input handles this natively — same file URI as
// the vision analyzer, different prompt. Transcript is EVIDENCE, not
// conclusions: nothing here interprets what the trader meant.

import { genAI } from '../ai/client';
import { logger } from '../logger';
import { TRANSCRIPT_PROMPT } from './prompts';
import type { Transcript } from './types';

export async function transcribeVideo(fileUri: string, mimeType: string): Promise<Transcript> {
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
            { text: TRANSCRIPT_PROMPT },
          ] },
        ],
        config: { responseMimeType: 'application/json' },
      });
      const text = result.text;
      if (!text) { logger.warn('transcriber: empty response', { model }); continue; }
      const parsed = safeParseTranscript(text);
      if (parsed) return parsed;
      logger.warn('transcriber: JSON did not match schema', { model });
    } catch (err) {
      lastErr = err;
      logger.warn('transcriber model failed', { model, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw lastErr ?? new Error('transcriber: all attempts failed');
}

function safeParseTranscript(raw: string): Transcript | null {
  const slice = extractJsonObject(raw);
  if (!slice) return null;
  let obj: unknown;
  try { obj = JSON.parse(slice); } catch { return null; }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  return {
    full: typeof o.full === 'string' ? o.full : '',
    segments: Array.isArray(o.segments) ? o.segments as Transcript['segments'] : [],
    language: typeof o.language === 'string' ? o.language : 'unknown',
  };
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
