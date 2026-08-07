// ─────────────────────────────────────────────────────────────────────────────
// Token counting for the coach pipeline.
//
// Why not use @anthropic-ai/sdk's count_tokens API?
//   It's exact, but every call is a round-trip to Anthropic. For a hot path
//   that enforces a 500-token cap (checked on every profile save), that's a
//   latency + cost tax we don't need.
//
// What we do instead:
//   A conservative character-based estimator that OVERCOUNTS on purpose.
//   Under-counting could push us past the cap and blow up a Claude call.
//   Over-counting only makes us keep the profile slightly leaner than needed.
//
// Calibration:
//   Claude's tokenizer is close to GPT-4's (~1 token per 3.5 chars for English,
//   ~1 per 2 chars for Hebrew). We use the more conservative Hebrew ratio for
//   any run of Hebrew characters, and English ratio elsewhere. Numbers,
//   whitespace, JSON braces all get counted with the tighter ratio (JSON is
//   token-dense — braces/colons/commas each cost 1 token).
// ─────────────────────────────────────────────────────────────────────────────

const HEBREW_RE = /[֐-׿]/;

/** Estimate token count for arbitrary text. Conservative — errs on high side.
    Never returns less than 1 for a non-empty string. */
export function countTokens(text: string): number {
  if (!text) return 0;

  let hebrewChars = 0;
  let jsonPunct = 0;
  let otherChars = 0;

  for (const ch of text) {
    if (HEBREW_RE.test(ch))                                              hebrewChars += 1;
    else if (ch === '{' || ch === '}' || ch === '[' || ch === ']'
          || ch === ':' || ch === ',' || ch === '"')                     jsonPunct += 1;
    else                                                                 otherChars += 1;
  }

  // Hebrew: ~2 chars per token (heavy tokens due to diacritics/vowels).
  // JSON punctuation: ~1 char per token (each brace/colon is its own token).
  // Everything else: ~3.5 chars per token (English + numbers + whitespace).
  const est = Math.ceil(hebrewChars / 2) + jsonPunct + Math.ceil(otherChars / 3.5);
  return Math.max(1, est);
}

/** Estimate token count for a JSON-serializable value. Serializes once, counts
    the string. Handles undefined/null cleanly (returns 0). */
export function countJsonTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return countTokens(JSON.stringify(value));
}

// ── Cap enforcement ─────────────────────────────────────────────────────────

export const PROFILE_TOKEN_CAP  = 500;   // matches DB CHECK constraint
export const PROFILE_TOKEN_WARN = 400;

export type CapCheck =
  | { ok: true;  tokens: number; level: 'safe' | 'warn' }
  | { ok: false; tokens: number; level: 'over'; cap: number };

/** Measures the combined token count of the profile blobs Claude will read
    (statistical + behavioral + narrative_summary). Returns 'safe' below warn,
    'warn' between warn and cap, and 'over' at or above the hard cap — the
    caller must then truncate before saving. Pure — no I/O. */
export function checkProfileCap(parts: {
  statistical: unknown;
  behavioral:  unknown;
  narrative_summary: string;
}): CapCheck {
  const tokens =
    countJsonTokens(parts.statistical) +
    countJsonTokens(parts.behavioral)  +
    countTokens(parts.narrative_summary);

  if (tokens >= PROFILE_TOKEN_CAP) return { ok: false, tokens, level: 'over', cap: PROFILE_TOKEN_CAP };
  if (tokens >= PROFILE_TOKEN_WARN) return { ok: true,  tokens, level: 'warn' };
  return { ok: true, tokens, level: 'safe' };
}

/** Thrown when the caller tries to persist a profile that exceeds the cap.
    The pipeline should catch this, log, and keep the old profile — never
    silently truncate at the DB layer. */
export class ProfileOverCapError extends Error {
  constructor(public readonly tokens: number, public readonly cap: number) {
    super(`Profile too large: ${tokens} tokens (cap ${cap})`);
    this.name = 'ProfileOverCapError';
  }
}

/** Assert-style: throws ProfileOverCapError if over. Use immediately before
    writing to Supabase (double check — the DB CHECK constraint would also
    reject, but by then the state may be inconsistent elsewhere). */
export function assertProfileWithinCap(parts: {
  statistical: unknown;
  behavioral:  unknown;
  narrative_summary: string;
}): number {
  const c = checkProfileCap(parts);
  if (!c.ok) throw new ProfileOverCapError(c.tokens, c.cap);
  return c.tokens;
}
