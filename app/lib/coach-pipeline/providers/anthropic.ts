// ─────────────────────────────────────────────────────────────────────────────
// Anthropic (Claude) provider wrapper.
//
// Called only from generateDailyInsight. Not a general-purpose SDK — every
// setting the coach pipeline needs (model, max_tokens, temperature, timeout,
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
export const CLAUDE_MODEL      = 'claude-3-5-sonnet-20241022';
export const CLAUDE_MAX_TOKENS = 500;
export const CLAUDE_TEMPERATURE = 0.5;
export const CLAUDE_TIMEOUT_MS = 15_000;

// Sonnet 3.5 pricing (Aug 2026) — USD per token.
const COST_INPUT_PER_TOKEN  = 3  / 1_000_000;
const COST_OUTPUT_PER_TOKEN = 15 / 1_000_000;

/** Lazy client — construction is safe even when the key is missing (SDK
 *  doesn't throw at build time), so a local `next build` without secrets
 *  still succeeds. The real request path will surface the missing-key error
 *  as `other` and the orchestrator will fall back to Gemini. */
let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? 'unset' });
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
        model:       CLAUDE_MODEL,
        max_tokens:  CLAUDE_MAX_TOKENS,
        temperature: CLAUDE_TEMPERATURE,
        system:      systemPrompt,
        messages:    [{ role: 'user', content: userMessage }],
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
