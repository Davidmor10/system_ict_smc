import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { logger } from "../logger";

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

/** Runs an ordered list of (provider, model) attempts, returning the first
    non-empty completion. Falls through on overload (503) / quota (429) / any
    error to the next attempt, so one model being down never fails the request
    while another is available. Throws only if every attempt fails. */
/** When `json` is set, ask the provider for a structured JSON object at the API
    level (Groq's json_object response_format, Gemini's application/json mime).
    This is what makes reasoning-leakage structurally impossible for the coach:
    the caller parses a JSON object and reads only its `final_answer` field, so
    the model's private `reasoning` field is never eligible to reach the user. */
async function runAttempts(prompt: string, attempts: Attempt[], json = false): Promise<string> {
  let lastErr: unknown;
  for (const { provider, model } of attempts) {
    try {
      if (provider === "gemini") {
        const result = await genAI.models.generateContent({
          model,
          contents: prompt,
          ...(json ? { config: { responseMimeType: "application/json" } } : {}),
        });
        if (result.text) return result.text;
        logger.warn("gemini returned no text", { model });
      } else {
        const result = await groq.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          ...(json ? { response_format: { type: "json_object" } } : {}),
        });
        const text = result.choices[0]?.message?.content;
        if (text) return text;
        logger.warn("groq returned no text", { model });
      }
    } catch (err) {
      lastErr = err;
      logger.warn(`${provider} model failed`, { model, error: err instanceof Error ? err.message : String(err) });
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

export function generateInsightText(prompt: string): Promise<string> {
  return runAttempts(prompt, INSIGHT_ATTEMPTS);
}

/** Higher-quality generation for the AI Coach — same free providers, but the
    strongest models first. */
export function generateCoachText(prompt: string): Promise<string> {
  return runAttempts(prompt, COACH_ATTEMPTS);
}

/** Coach generation constrained to a JSON object at the API level. Returns the
    raw JSON string (still parsed + validated by the caller, which is the layer
    that enforces the fail-safe when a provider ignores the constraint). */
export function generateCoachJson(prompt: string): Promise<string> {
  return runAttempts(prompt, COACH_ATTEMPTS, true);
}
