// ─────────────────────────────────────────────────────────────────────────────
// Google Generative AI provider wrapper for the coach pipeline.
// Currently exposes just embeddings — Gemini text generation lives here later.
//
// Uses the shared `genAI` client from app/lib/ai/client.ts (already carries the
// GEMINI_API_KEY setup + safe defaults), so we don't fork the SDK setup.
// ─────────────────────────────────────────────────────────────────────────────

import { genAI } from '../../ai/client';
import { logger } from '../../logger';

export const EMBEDDING_MODEL       = 'text-embedding-004';
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
        config:   { taskType },
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
