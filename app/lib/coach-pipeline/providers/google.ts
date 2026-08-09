// ─────────────────────────────────────────────────────────────────────────────
// Google Generative AI provider wrapper for the coach pipeline.
// Two surfaces: embeddings (text-embedding-004) and Gemini text generation
// (gemini-2.5-flash) used as the fallback path for daily-insight generation.
//
// Uses the shared `genAI` client from app/lib/ai/client.ts (already carries the
// GEMINI_API_KEY setup + safe defaults), so we don't fork the SDK setup.
// ─────────────────────────────────────────────────────────────────────────────

import { genAI } from '../../ai/client';
import { logger } from '../../logger';

// NOT text-embedding-004 — that model has been retired, which is why every
// retrieval came back `embed_failed` and the coach never once saw the
// trader's own notebook.
//
// gemini-embedding-001 is natively 3072-dimensional and Matryoshka-trained,
// so a 768-slice is a first-class representation rather than a truncation.
// 768 is not a preference here: notebook_chunks.embedding is vector(768) and
// the HNSW index is built for it, so any other width fails on insert.
export const EMBEDDING_MODEL       = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS  = 768;
export const EMBEDDING_BATCH_MAX   = 100;        // Google's per-call cap for batchEmbedContents

/** Distinguishes retryable transient failures (429/5xx) from permanent ones
 *  (400 = malformed input). Our retry loop only retries on `retryable`. */
export interface EmbeddingError extends Error {
  retryable: boolean;
  status?:   number;
}

function classifyError(err: unknown): EmbeddingError {
  const msg    = err instanceof Error ? err.message : String(err);
  const status =
    (err as { status?: number })?.status ??
    (typeof msg === 'string' && /\b(429|5\d{2})\b/.exec(msg)?.[0] ? Number(/\b(429|5\d{2})\b/.exec(msg)![0]) : undefined);

  const retryable = status === 429 || (status !== undefined && status >= 500 && status < 600);
  const e = new Error(msg) as EmbeddingError;
  e.retryable = retryable;
  if (status) e.status = status;
  return e;
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

/** Result of an embedding call — one vector per input, in the same order. */
export interface EmbeddingResult {
  vectors:    number[][];         // each is EMBEDDING_DIMENSIONS long
  latencyMs:  number;
}

/** Embed up to EMBEDDING_BATCH_MAX texts in a single call. Retries up to 3
 *  times on transient errors with exponential backoff (1s → 4s → 16s).
 *  Throws EmbeddingError on final failure (retryable=false → immediate throw).
 *  `taskType` follows Google's convention: RETRIEVAL_DOCUMENT for storing,
 *  RETRIEVAL_QUERY for the search-side embedding we'll add later. */
export async function embedBatch(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], latencyMs: 0 };
  if (texts.length > EMBEDDING_BATCH_MAX) {
    throw new Error(`embedBatch: max ${EMBEDDING_BATCH_MAX} texts per call, got ${texts.length}`);
  }

  const started = Date.now();
  const delays  = [1000, 4000, 16000];   // wait BEFORE the retry, not after

  for (let attempt = 0; attempt < delays.length + 1; attempt += 1) {
    try {
      const res = await genAI.models.embedContent({
        model:    EMBEDDING_MODEL,
        contents: texts,
        // outputDimensionality is required, not optional: the default is 3072
        // and the column is vector(768), so omitting it fails on every insert.
        config:   { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
      });

      // The SDK returns { embeddings: [{ values: number[] }, ...] } — normalize.
      const embeds = (res as { embeddings?: Array<{ values?: number[] }> }).embeddings ?? [];
      if (embeds.length !== texts.length) {
        throw new Error(`embedBatch: expected ${texts.length} vectors, got ${embeds.length}`);
      }
      const vectors = embeds.map((e, i) => {
        const v = e.values;
        if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`embedBatch: bad vector at index ${i} (len ${v?.length ?? 'null'})`);
        }
        return v;
      });

      return { vectors, latencyMs: Date.now() - started };
    } catch (raw) {
      const err = classifyError(raw);
      const done = attempt === delays.length || !err.retryable;
      if (done) {
        logger.error('embedBatch failed', {
          attempt, status: err.status, retryable: err.retryable, error: err.message,
        });
        throw err;
      }
      logger.warn('embedBatch retrying', {
        attempt, status: err.status, error: err.message, waitMs: delays[attempt],
      });
      await sleep(delays[attempt]);
    }
  }
  throw new Error('embedBatch: unreachable');
}

/** Convenience: embed an arbitrary-sized list of texts by splitting into
 *  batches of EMBEDDING_BATCH_MAX. Preserves order. Returns aggregated
 *  latency and the flat list of vectors. */
export async function embedAll(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
): Promise<EmbeddingResult> {
  const started = Date.now();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_MAX) {
    const slice = texts.slice(i, i + EMBEDDING_BATCH_MAX);
    const res   = await embedBatch(slice, taskType);
    vectors.push(...res.vectors);
  }
  return { vectors, latencyMs: Date.now() - started };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini text generation — the fallback path for daily-insight when Claude is
// over-budget, rate-limited, or down. Same return shape as callClaudeInsight
// so the orchestrator picks either provider through one union type.
// ─────────────────────────────────────────────────────────────────────────────

export const GEMINI_INSIGHT_MODEL       = 'gemini-2.5-flash';
export const GEMINI_INSIGHT_MAX_TOKENS  = 700;
export const GEMINI_INSIGHT_TEMPERATURE = 0.3;
export const GEMINI_INSIGHT_TIMEOUT_MS  = 15_000;

// Gemini 2.5 Flash is a thinking model, and maxOutputTokens budgets thinking
// AND visible text together. Left at the default it spent ~390 of a 400-token
// budget reasoning and returned 13 tokens of Hebrew cut off mid-word — an
// insight that reads as broken software to the trader. Thinking is off: this
// is one short paragraph grounded in data blocks, not a reasoning problem.
const GEMINI_THINKING_BUDGET = 0;

// Gemini 2.5 Flash pricing (Aug 2026) — USD per token, up to 128k context.
const GEMINI_COST_INPUT_PER_TOKEN  = 0.075 / 1_000_000;
const GEMINI_COST_OUTPUT_PER_TOKEN = 0.30  / 1_000_000;

export type GeminiCallOutcome =
  | {
      ok:         true;
      text:       string;
      tokensIn:   number;
      tokensOut:  number;
      costUsd:    number;
      latencyMs:  number;
    }
  | {
      ok:         false;
      errorKind:  'rate_limit' | 'timeout' | 'api_error' | 'other';
      message:    string;
      status?:    number;
      latencyMs:  number;
    };

function classifyGemini(err: unknown, latencyMs: number): GeminiCallOutcome {
  const msg    = err instanceof Error ? err.message : String(err);
  const status =
    (err as { status?: number })?.status ??
    (typeof msg === 'string' && /\b(429|5\d{2})\b/.exec(msg)?.[0] ? Number(/\b(429|5\d{2})\b/.exec(msg)![0]) : undefined);
  if (err instanceof Error && (err.name === 'AbortError' || /aborted|timeout/i.test(msg))) {
    return { ok: false, errorKind: 'timeout', message: msg, latencyMs };
  }
  if (status === 429)               return { ok: false, errorKind: 'rate_limit', message: msg, status, latencyMs };
  if (status && status >= 500)      return { ok: false, errorKind: 'api_error',  message: msg, status, latencyMs };
  return { ok: false, errorKind: 'other', message: msg, status, latencyMs };
}

/** Call Gemini with the daily-insight prompt. The system prompt is concatenated
 *  to the user message with a separator — Gemini's chat API accepts a
 *  `systemInstruction` but for a single-turn call this simpler shape works
 *  and matches our token counting model. Timeout enforced via an
 *  AbortController since the SDK doesn't take a per-call timeout. */
export async function callGeminiInsight(
  systemPrompt: string,
  userMessage: string,
): Promise<GeminiCallOutcome> {
  const started    = Date.now();
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), GEMINI_INSIGHT_TIMEOUT_MS);
  try {
    const res = await genAI.models.generateContent({
      model: GEMINI_INSIGHT_MODEL,
      contents: `${systemPrompt}\n\n═══ USER MESSAGE ═══\n${userMessage}`,
      config: {
        temperature:     GEMINI_INSIGHT_TEMPERATURE,
        maxOutputTokens: GEMINI_INSIGHT_MAX_TOKENS,
        thinkingConfig:  { thinkingBudget: GEMINI_THINKING_BUDGET },
        abortSignal:     controller.signal,
      },
    });

    const raw = typeof res.text === 'string' ? res.text : '';
    if (!raw.trim()) {
      return {
        ok: false, errorKind: 'other',
        message: 'gemini returned empty text',
        latencyMs: Date.now() - started,
      };
    }

    // Belt and braces: even with thinking off, a long answer can still hit the
    // ceiling. Never persist a sentence that stops mid-word — cut back to the
    // last completed sentence instead, and fail outright if nothing usable
    // survives. A missing insight is recoverable; a broken-looking one isn't.
    const finish = (res as { candidates?: Array<{ finishReason?: string }> })
      .candidates?.[0]?.finishReason;
    let text = raw;
    if (finish === 'MAX_TOKENS') {
      const cut = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf('!'), raw.lastIndexOf('?'));
      text = cut > 0 ? raw.slice(0, cut + 1) : '';
      logger.warn('gemini hit maxOutputTokens', {
        rawLength: raw.length, keptLength: text.length,
      });
      if (text.trim().length < 80) {
        return {
          ok: false, errorKind: 'other',
          message: `gemini truncated at maxOutputTokens with nothing usable (${raw.length} chars)`,
          latencyMs: Date.now() - started,
        };
      }
    }

    // usageMetadata is optional in the SDK's typings; guard both fields.
    const usage = (res as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    const tokensIn  = usage?.promptTokenCount     ?? 0;
    const tokensOut = usage?.candidatesTokenCount ?? 0;
    const costUsd   = tokensIn * GEMINI_COST_INPUT_PER_TOKEN + tokensOut * GEMINI_COST_OUTPUT_PER_TOKEN;

    return { ok: true, text, tokensIn, tokensOut, costUsd, latencyMs: Date.now() - started };
  } catch (err) {
    const out = classifyGemini(err, Date.now() - started);
    logger.warn('callGeminiInsight failed', {
      kind: out.ok ? 'ok' : out.errorKind,
      status: out.ok ? undefined : out.status,
      msg: out.ok ? undefined : out.message.slice(0, 200),
    });
    return out;
  } finally {
    clearTimeout(timer);
  }
}
