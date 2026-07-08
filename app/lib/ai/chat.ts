// ─────────────────────────────────────────────────────────────────────────────
// Chat Coach — a conversational analyst grounded STRICTLY in the trader's own
// already-computed statistics. It is the shared substrate the other agents
// reuse. Precision is the whole point: the model is handed a numbers-only facts
// block and is forbidden from citing anything not in it, from treating a tiny
// sample as a conclusion, or from predicting the market. Same "facts first, AI
// only phrases" discipline as every other AI surface in the app.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { getRecentTrades, getTraderProfile, getHypothesis } from '../intelligence/repository';
import { runFullAnalysis } from '../analytics';
import { summarizeKnownFacts } from './factsBlock';
import { generateInsightText } from './client';
import { buildFactsContext, buildChatPrompt, type ChatTurn } from './chatPrompt';
import { logger } from '../logger';

export type { ChatTurn } from './chatPrompt';

/** Same floor every AI surface in the app uses — below this there's nothing
    to honestly analyze, so the coach says so rather than guessing. */
const MIN_CLOSED_TRADES = 3;

export type ChatUnavailableReason = 'not_configured' | 'insufficient_data' | 'ai_unavailable';

export interface ChatResult {
  answer: string | null;
  /** Present only when answer is null — lets the UI show the right message
      instead of a generic error. */
  reason?: ChatUnavailableReason;
  /** How many closed trades the answer was grounded in (transparency). */
  sampleSize?: number;
}

/** Answers a single trader question, grounded only in their computed journal
    facts. Returns `{ answer: null, reason }` (never throws) when the coach
    can't honestly answer — not configured, too few trades, or the AI provider
    is down — so the route/UI can show the right message. */
export async function answerJournalQuestion(
  userId: string,
  question: string,
  lang: 'he' | 'en',
  history: ChatTurn[] = [],
): Promise<ChatResult> {
  if (!isSupabaseConfigured()) return { answer: null, reason: 'not_configured' };

  const supabase = createServerSupabaseClient();
  const trades = await getRecentTrades(supabase, userId);
  const closedCount = trades.filter(t => t.result !== 'OPEN').length;
  if (closedCount < MIN_CLOSED_TRADES) return { answer: null, reason: 'insufficient_data', sampleSize: closedCount };

  const analysis = runFullAnalysis(trades);
  const [profileRecord, hypothesis] = await Promise.all([
    getTraderProfile(supabase, userId),
    getHypothesis(supabase, userId),
  ]);

  const knownFactsBlock = profileRecord && profileRecord.knownFacts.length > 0
    ? summarizeKnownFacts(profileRecord.knownFacts)
    : '';
  const hypothesisLine = hypothesis?.description
    ? `CURRENT EDGE HYPOTHESIS: ${hypothesis.description} (status ${hypothesis.status}, confidence ${hypothesis.confidenceScore}/100).`
    : '';

  const facts = buildFactsContext(analysis, knownFactsBlock, hypothesisLine);
  const prompt = buildChatPrompt(facts, history, question, lang);

  try {
    const answer = await generateInsightText(prompt);
    return { answer: answer.trim(), sampleSize: closedCount };
  } catch (err) {
    logger.error('chat coach generation failed', { error: err instanceof Error ? err.message : String(err) });
    return { answer: null, reason: 'ai_unavailable', sampleSize: closedCount };
  }
}
