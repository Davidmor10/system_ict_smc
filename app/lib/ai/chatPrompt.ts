// Pure prompt construction for the Chat Coach — no Supabase, no LLM, no I/O, so
// it can be unit-tested in isolation. chat.ts wires these to the real data.

import type { FullAnalysis } from '../analytics';
import { summarizeAnalysis } from './factsBlock';
import { HEBREW_MENTOR_STYLE, CHALLENGE_TRADER_STYLE } from './styleGuide';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Only the last few turns are fed back as context — enough for follow-ups
    without letting the history balloon the prompt. */
export const HISTORY_TURNS = 6;

/** Builds the numbers-only context the model is allowed to cite. Everything
    here is already computed by the analytics/intelligence engine — the chat
    never recomputes a statistic or invents one. `hypothesisLine`/`knownFacts`
    are appended only when present, so an early-history trader's prompt stays
    honest about how little is established. */
export function buildFactsContext(analysis: FullAnalysis, knownFactsBlock: string, hypothesisLine: string): string {
  const parts = [summarizeAnalysis(analysis)];
  if (hypothesisLine) parts.push(`\n${hypothesisLine}`);
  if (knownFactsBlock) parts.push(`\nESTABLISHED FACTS ABOUT THIS TRADER:\n${knownFactsBlock}`);
  return parts.join('\n');
}

export function buildChatPrompt(facts: string, history: ChatTurn[], question: string, lang: 'he' | 'en'): string {
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const recent = history
    .slice(-HISTORY_TURNS)
    .map(t => `${t.role === 'user' ? 'TRADER' : 'YOU'}: ${t.content}`)
    .join('\n');

  return `You are Onyx, an experienced trading mentor answering a futures day-trader's questions about THEIR OWN journal. You have the complete, already-computed statistics of their journal below. You never see the raw trades — only these numbers — so you literally cannot cite a number that isn't here.

${langInstruction}

${CHALLENGE_TRADER_STYLE}

TRADER'S COMPUTED JOURNAL STATISTICS (the only facts you may use):
${facts}

HARD RULES — precision matters more than sounding helpful:
- Answer ONLY from the statistics above. Never invent, estimate, or round a number that isn't written there.
- For any claim you make, name the concrete evidence: the specific slice, its win rate, and its sample size (e.g. "בשורט ב-NY PM: 41% הצלחה על 19 עסקאות").
- Respect sample size. A slice with fewer than 10 decided trades is NOT a conclusion — say plainly it's still an early/small sample. Never present a small sample as a firm finding.
- If the trader asks about something the statistics above simply don't cover (a slice with no data, or a topic the numbers can't answer), say so directly — "אין לי מספיק נתונים על זה עדיין" — instead of guessing or making something up.
- Never predict the market, never say what will happen next, never give a buy/sell signal or tell them what to trade. You explain THEIR history, not the future.
- Keep it to 1–4 short sentences unless the question genuinely needs more. Talk like a mentor, not a report.
${recent ? `\nRECENT CONVERSATION (for context):\n${recent}\n` : ''}
TRADER'S QUESTION: ${question}

Your answer:`;
}
