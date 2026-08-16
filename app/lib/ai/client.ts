import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { logger } from "../logger";
import { logUsage } from "../coach-pipeline/db/usage";

/** Single shared clients — every AI route in the app goes through these.
    Groq's constructor throws immediately on a missing key (unlike
    GoogleGenAI, which only warns) — that would break `next build`'s local
    page-data collection wherever GROQ_API_KEY isn't set (e.g. local dev,
    where only the deployed environment carries it). A placeholder keeps
    construction safe; real requests still fail gracefully into the catch
    block below. */
export const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "unset" });

type Provider = "gemini" | "groq";
interface Attempt { provider: Provider; model: string }

/** Who the call was for, and what it was for.
 *
 *  Optional only so a caller that genuinely has no user (a script, a test) can
 *  omit it. Everything reached from a request should pass it: ai_usage_log's
 *  header says every AI call gets a row, always, and until now that was true
 *  of exactly one of the two AI stacks in this app. The other five surfaces —
 *  insights, weekly report, strengths, pattern insights, the coach chat — ran
 *  on the free tiers and reported nothing, so call volume and how close a
 *  daily quota was to being exhausted were invisible until something stopped
 *  working. Free is not the same as unmeasured. */
export interface AiCallMeta {
  clerkId: string | null;
  purpose: string;
}

/** Free-tier models. The row is written for the token counts and the failure
 *  record, not for the money — but the field has to say something, and 0 is
 *  what it actually costs. */
const FREE_TIER_COST_USD = 0;

interface Usage { tokensIn: number; tokensOut: number }

function geminiUsage(result: unknown): Usage {
  const u = (result as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })?.usageMetadata;
  return { tokensIn: u?.promptTokenCount ?? 0, tokensOut: u?.candidatesTokenCount ?? 0 };
}
function groqUsage(result: unknown): Usage {
  const u = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  return { tokensIn: u?.prompt_tokens ?? 0, tokensOut: u?.completion_tokens ?? 0 };
}

/** Never throws and never blocks: a logging failure must not take down the
 *  call it was accounting for. */
async function record(
  meta: AiCallMeta | undefined,
  provider: Provider,
  model: string,
  usage: Usage,
  latencyMs: number,
  ok: boolean,
  errorKind?: string,
): Promise<void> {
  if (!meta) return;
  try {
    await logUsage({
      clerkId: meta.clerkId,
      // ai_usage_log's provider column is free text; the coach pipeline only
      // ever writes two values, and this stack adds the third.
      provider: (provider === "gemini" ? "google" : "groq") as "google",
      model,
      purpose: meta.purpose,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsdEst: FREE_TIER_COST_USD,
      latencyMs,
      ok,
      errorKind,
    });
  } catch {
    /* accounted for above */
  }
}

/** Runs an ordered list of (provider, model) attempts, returning the first
    non-empty completion. Falls through on overload (503) / quota (429) / any
    error to the next attempt, so one model being down never fails the request
    while another is available. Throws only if every attempt fails. */
/** When `json` is set, ask the provider for a structured JSON object at the API
    level (Groq's json_object response_format, Gemini's application/json mime).
    This is what makes reasoning-leakage structurally impossible for the coach:
    the caller parses a JSON object and reads only its `final_answer` field, so
    the model's private `reasoning` field is never eligible to reach the user. */
async function runAttempts(prompt: string, attempts: Attempt[], json = false, meta?: AiCallMeta): Promise<string> {
  let lastErr: unknown;
  for (const { provider, model } of attempts) {
    const started = Date.now();
    try {
      if (provider === "gemini") {
        const result = await genAI.models.generateContent({
          model,
          contents: prompt,
          ...(json ? { config: { responseMimeType: "application/json" } } : {}),
        });
        if (result.text) {
          await record(meta, provider, model, geminiUsage(result), Date.now() - started, true);
          return result.text;
        }
        logger.warn("gemini returned no text", { model });
        await record(meta, provider, model, geminiUsage(result), Date.now() - started, false, "empty_text");
      } else {
        const result = await groq.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          ...(json ? { response_format: { type: "json_object" } } : {}),
        });
        const text = result.choices[0]?.message?.content;
        if (text) {
          await record(meta, provider, model, groqUsage(result), Date.now() - started, true);
          return text;
        }
        logger.warn("groq returned no text", { model });
        await record(meta, provider, model, groqUsage(result), Date.now() - started, false, "empty_text");
      }
    } catch (err) {
      lastErr = err;
      logger.warn(`${provider} model failed`, { model, error: err instanceof Error ? err.message : String(err) });
      // Failed attempts are logged too, and they are the rows that matter
      // most here: a fallback chain that quietly slides down to the weakest
      // model every afternoon looks identical to a healthy one from the
      // outside. The failures are how an exhausted daily quota becomes
      // visible before it becomes an outage.
      await record(meta, provider, model, { tokensIn: 0, tokensOut: 0 }, Date.now() - started, false,
        err instanceof Error ? err.message.slice(0, 80) : "error");
    }
  }
  logger.error("all AI providers failed", { error: lastErr instanceof Error ? lastErr.message : String(lastErr) });
  throw lastErr ?? new Error("All AI providers failed");
}

// ── Insight phrasing (dashboard/weekly/pattern) ──────────────────────────────
// A phrasing task over already-computed numbers, not open-ended reasoning — so
// the cheapest free-tier models are enough. Ordered by free-tier daily quota,
// highest first, to avoid exhausting a lower-quota model; Groq is the
// cross-provider last resort (different vendor, own quota) when a busy day
// exhausts Gemini's daily cap across every model at once.
const INSIGHT_ATTEMPTS: Attempt[] = [
  { provider: "gemini", model: "gemini-2.5-flash-lite" },
  { provider: "gemini", model: "gemini-2.5-flash" },
  { provider: "gemini", model: "gemini-flash-latest" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "groq", model: "llama-3.1-8b-instant" },
];

// ── Coach chat (quality-first) ───────────────────────────────────────────────
// The coach is the conversational surface where answer quality matters most, so
// it LEADS with the strongest free models — Groq's 70B and Gemini Flash — and
// only falls back to the lighter flash-lite / 8B when those are rate-limited.
// Same providers, same $0 free tiers as INSIGHT_ATTEMPTS — just a better order.
const COACH_ATTEMPTS: Attempt[] = [
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "gemini", model: "gemini-2.5-flash" },
  { provider: "gemini", model: "gemini-flash-latest" },
  { provider: "gemini", model: "gemini-2.5-flash-lite" },
  { provider: "groq", model: "llama-3.1-8b-instant" },
];

/** Insight generation constrained to a JSON object at the API level.
 *
 *  Every phrasing surface already asks for JSON in words and digs the object
 *  back out with a regex. That works, and when it fails the caller returns null
 *  rather than something wrong — but "null" here means a section quietly did
 *  not appear on the trader's screen, which nobody finds out about. Asking the
 *  provider to enforce the shape removes most of that failure class.
 *
 *  IMPORTANT — the object is not decoration. Groq's json_object mode rejects a
 *  response whose top level is an array, so every prompt reaching this function
 *  must ask for an object, wrapping any list in a named field. Gemini would
 *  accept a bare array; matching the stricter provider is what keeps one
 *  fallback chain instead of two. */
export function generateInsightJson(prompt: string, meta?: AiCallMeta): Promise<string> {
  return runAttempts(prompt, INSIGHT_ATTEMPTS, true, meta);
}

/** Higher-quality generation for the AI Coach — same free providers, but the
    strongest models first. */
export function generateCoachText(prompt: string, meta?: AiCallMeta): Promise<string> {
  return runAttempts(prompt, COACH_ATTEMPTS, false, meta);
}

/** Coach generation constrained to a JSON object at the API level. Returns the
    raw JSON string (still parsed + validated by the caller, which is the layer
    that enforces the fail-safe when a provider ignores the constraint). */
export function generateCoachJson(prompt: string, meta?: AiCallMeta): Promise<string> {
  return runAttempts(prompt, COACH_ATTEMPTS, true, meta);
}
