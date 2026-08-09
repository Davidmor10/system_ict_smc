// ─────────────────────────────────────────────────────────────────────────────
// Anthropic (Claude) provider wrapper.
//
// Called only from generateDailyInsight. Not a general-purpose SDK — every
// setting the coach pipeline needs (model, max_tokens, thinking, timeout,
// system-prompt handling, structured return) is baked in.
//
// Never throws. Every outcome (ok / rate_limit / timeout / api_error / other)
// comes back as a discriminated union the orchestrator switches on. This is
// the same pattern used for embedEntry — exceptions are for programmer errors,
// not for expected AI-provider transience.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../logger';

// Pinned so a Claude family upgrade doesn't silently ship. Bump deliberately.
//
// NOT claude-3-5-sonnet-20241022 — that snapshot was retired 2025-10-28 and
// now 404s. A 404 classifies as `other`, so the orchestrator would silently
// rescue every single call to Gemini: the pipeline would "work" while never
// once reaching Claude, and paying a wasted round-trip to find out.
export const CLAUDE_MODEL      = 'claude-sonnet-5';
export const CLAUDE_MAX_TOKENS = 500;

// 15s was too tight. The first live call took 28.8s wall-clock for a 384-token
// Hebrew answer — one attempt timed out and the SDK silently retried, so we
// paid double the latency to get the same result. Budget for the real thing:
// a full-length response takes ~25s, and one retry beyond that is all the
// nightly drain window can absorb.
export const CLAUDE_TIMEOUT_MS = 30_000;
export const CLAUDE_MAX_RETRIES = 1;

// Sonnet 5 pricing — USD per token. (Intro rate is lower through 2026-08-31;
// we bill the standard rate so the ledger never under-reports.)
const COST_INPUT_PER_TOKEN  = 3  / 1_000_000;
const COST_OUTPUT_PER_TOKEN = 15 / 1_000_000;

/** Lazy client — construction is safe even when the key is missing (SDK
 *  doesn't throw at build time), so a local `next build` without secrets
 *  still succeeds. The real request path will surface the missing-key error
 *  as `other` and the orchestrator will fall back to Gemini. */
let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({
    apiKey:     process.env.ANTHROPIC_API_KEY ?? 'unset',
    // Default is 2. Retries are invisible from the outside — they show up
    // only as tripled latency and a timeout that doesn't mean what it says.
    maxRetries: CLAUDE_MAX_RETRIES,
  });
  return cached;
}

export type ClaudeCallOutcome =
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

function classify(err: unknown, latencyMs: number): ClaudeCallOutcome {
  const msg    = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status
              ?? (err as { response?: { status?: number } })?.response?.status;

  // AbortError from our own timeout wrapper.
  if (err instanceof Error && (err.name === 'AbortError' || /aborted|timeout/i.test(msg))) {
    return { ok: false, errorKind: 'timeout', message: msg, latencyMs };
  }
  if (status === 429) return { ok: false, errorKind: 'rate_limit', message: msg, status, latencyMs };
  if (status && status >= 500) return { ok: false, errorKind: 'api_error', message: msg, status, latencyMs };
  return { ok: false, errorKind: 'other', message: msg, status, latencyMs };
}

/** Call Claude with the daily-insight system prompt + user message. The SDK
 *  itself supports a `timeout` option — we pass CLAUDE_TIMEOUT_MS, no
 *  external AbortController needed. */
export async function callClaudeInsight(
  systemPrompt: string,
  userMessage: string,
): Promise<ClaudeCallOutcome> {
  const started = Date.now();
  try {
    const res = await client().messages.create(
      {
        model:      CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        // No `temperature`. Sonnet 5 rejects non-default sampling parameters
        // with a 400 — tone is steered by the system prompt instead.
        //
        // Thinking is explicitly OFF. When omitted, Sonnet 5 thinks
        // adaptively, and max_tokens budgets thinking + visible text
        // TOGETHER — a 300-400 token Hebrew insight would truncate
        // mid-sentence behind a reasoning block nobody reads.
        thinking:   { type: 'disabled' },
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      },
      { timeout: CLAUDE_TIMEOUT_MS },
    );

    // Content is an array of blocks; concatenate every text block. Non-text
    // blocks (unlikely for a plain response) are skipped.
    const text = res.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('');

    const tokensIn  = res.usage.input_tokens;
    const tokensOut = res.usage.output_tokens;
    const costUsd   = tokensIn * COST_INPUT_PER_TOKEN + tokensOut * COST_OUTPUT_PER_TOKEN;

    return { ok: true, text, tokensIn, tokensOut, costUsd, latencyMs: Date.now() - started };
  } catch (err) {
    const out = classify(err, Date.now() - started);
    logger.warn('callClaudeInsight failed', {
      kind: out.ok ? 'ok' : out.errorKind,
      status: out.ok ? undefined : out.status,
      msg: out.ok ? undefined : out.message.slice(0, 200),
    });
    return out;
  }
}
