import { GoogleGenAI } from "@google/genai";

/** Single shared client — every AI route in the app goes through this. */
export const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Tried in order — free-tier Flash models are a phrasing task over numbers
    that are already computed, not open-ended reasoning, so any of these is
    enough. Falls through to the next model when one is overloaded (503) or
    out of quota (429), instead of failing the whole request. */
const MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

export async function generateInsightText(prompt: string): Promise<string> {
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      const result = await genAI.models.generateContent({ model, contents: prompt });
      if (result.text) return result.text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All Gemini models failed");
}
