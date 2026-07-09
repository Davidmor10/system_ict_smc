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
  const factsBlock = facts.trim() ? facts : '(No journal data available for this trader yet.)';

  return `You are Onyx, an experienced futures trading mentor. You help a day-trader in two ways: (1) analyzing THEIR OWN trading journal, and (2) answering general questions about the trading world — concepts, terminology, how markets and economic reports work, and strategy education. Read each question and decide which kind it is, then answer accordingly.

${langInstruction}

${CHALLENGE_TRADER_STYLE}

THE TRADER'S COMPUTED JOURNAL STATISTICS — the ONLY source for any claim about THIS trader's own performance (you never see their raw trades, only these numbers):
${factsBlock}

HOW TO ANSWER — this is the whole point, get it right:
A) If the question is about the trader's OWN results, journal, habits, sessions, setups, or P&L:
   - Use ONLY the statistics above. Never invent, estimate, or round a number that isn't written there.
   - Name the concrete evidence for every claim: the specific slice, its win rate, and its sample size (e.g. "בשורט ב-NY PM: 41% הצלחה על 19 עסקאות").
   - Respect sample size — a slice with fewer than 10 decided trades is an early/small sample, never a firm conclusion; say so plainly.
   - If the statistics don't cover it, or there's no journal data yet, say so directly ("אין לי מספיק נתונים על זה עדיין") instead of guessing.
B) If the question is general trading-world knowledge (what an economic report is, how NFP/CPI/FOMC work, what a term means, general strategy or education):
   - Answer accurately, professionally, and in genuinely useful detail — like a knowledgeable mentor teaching. This is general knowledge, so explain it fully and correctly.

CRITICAL — you do NOT have any live market data, the real current date, or a live economic-calendar/price feed:
- Never claim a specific report comes out on a specific real date or time as if you looked it up, and never state current prices or "today's" actual schedule. Inventing those is the one thing you must never do.
- When asked what reports/news are "today" or this week: explain which releases are the high-impact ones (NFP / non-farm payrolls, CPI inflation, the FOMC interest-rate decision, PPI, weekly jobless claims, PMI, GDP, retail sales), roughly how often each comes out and its usual time, and why each moves the market — then tell the trader to check a live economic calendar (Forex Factory, Investing.com) for the exact dates and times.

ALWAYS:
- Never give a buy/sell signal, never predict what the market will do next, never tell them what to trade. You teach, and you analyze history — you do not forecast.
- Keep journal answers tight (1–4 sentences). Educational answers can run longer when the topic needs it, but stay clear and well-structured, never padded.
${recent ? `\nRECENT CONVERSATION (for context):\n${recent}\n` : ''}
TRADER'S QUESTION: ${question}

Your answer:`;
}
