import { GoogleGenAI } from "@google/genai";

/** Single shared client — every AI route in the app goes through this. */
export const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Free-tier Gemini model — every insight here is a phrasing task over numbers
    that are already computed, not open-ended reasoning, so Flash is enough. */
export const AI_MODEL = "gemini-2.0-flash";
