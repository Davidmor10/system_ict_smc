import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";

/** Single shared clients — every AI route in the app goes through these.
    Groq's constructor throws immediately on a missing key (unlike
    GoogleGenAI, which only warns) — that would break `next build`'s local
    page-data collection wherever GROQ_API_KEY isn't set (e.g. local dev,
    where only the deployed environment carries it). A placeholder keeps
    construction safe; real requests still fail gracefully into the catch
    block in generateInsightText. */
export const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "unset" });

/** Tried in order — free-tier Flash models are a phrasing task over numbers
    that are already computed, not open-ended reasoning, so any of these is
    enough. Falls through to the next model when one is overloaded (503) or
    out of quota (429), instead of failing the whole request.
    Ordered by free-tier daily quota, highest first: "-latest" aliases drift
    to whatever Google's newest model is (seen dropping to a 20-req/day cap
    when it silently repointed to gemini-3.5-flash) — kept last as a bonus
    attempt, not the primary path. */
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];

/** Cross-provider last resort — a busy day can exhaust Gemini's free quota
    across every model at once (same account, same daily cap family), which
    no amount of same-provider fallback fixes. Groq is a different vendor
    with its own free quota, so it survives a total Gemini outage. */
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

export async function generateInsightText(prompt: string): Promise<string> {
  let lastErr: unknown;

  for (const model of GEMINI_MODELS) {
    try {
      const result = await genAI.models.generateContent({ model, contents: prompt });
      if (result.text) return result.text;
    } catch (err) {
      lastErr = err;
    }
  }

  for (const model of GROQ_MODELS) {
    try {
      const result = await groq.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      const text = result.choices[0]?.message?.content;
      if (text) return text;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr ?? new Error("All AI providers failed");
}
