// ─────────────────────────────────────────────────────────────────────────────
// Chat Coach — a conversational trading mentor. It does two things: analyzes the
// trader's OWN journal (grounded STRICTLY in already-computed statistics — the
// model is handed a numbers-only facts block and forbidden from citing anything
// not in it), and answers general trading-world questions from its own knowledge
// (concepts, reports, terminology) while never inventing live market data. Same
// "facts first, AI only phrases" discipline as every other AI surface in the app.
//
// Each answered turn is persisted to a coach_chats row so the trader keeps a
// list of past chats ("אחרונים") that syncs across devices via Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { getRecentTrades, getTraderProfile, getHypothesis } from '../intelligence/repository';
import { runFullAnalysis, type FullAnalysis } from '../analytics';
import { summarizeKnownFacts } from './factsBlock';
import { generateCoachText } from './client';
import { buildFactsContext, buildChatPrompt, type ChatTurn } from './chatPrompt';
import { createCoachChat, getCoachChat, saveCoachChatMessages, deriveChatTitle } from './coachChats';
import { getMacroEvents, buildMacroBlock, computeMacroOverlap, israelToday } from './macroCalendar';
import { extractResponse } from './coachOutput';
import { logger } from '../logger';

export type { ChatTurn } from './chatPrompt';

/** Below this there's nothing to honestly analyze in the journal, so the coach
    skips the facts block for personal questions. It can still answer general
    trading-world questions — those don't need any journal data. */
const MIN_CLOSED_TRADES = 3;

export type ChatUnavailableReason = 'ai_unavailable';

export interface ChatResult {
  answer: string | null;
  /** Present only when answer is null — lets the UI show the right message
      instead of a generic error. */
  reason?: ChatUnavailableReason;
  /** The chat this turn was saved to (created on the first turn of a new chat).
      Absent when Supabase isn't configured (chat still answers, just unsaved). */
  chatId?: string;
  /** The chat's title — so a brand-new chat can be added to the "אחרונים" list
      without a second round-trip. */
  title?: string;
  /** How many closed trades the journal facts were grounded in (transparency). */
  sampleSize?: number;
}

/** Answers a single trader question and (best-effort) persists the turn to a
    chat. Journal questions are grounded only in the trader's computed facts;
    general trading-world questions are answered from the model's own knowledge.
    Returns `{ answer: null, reason: 'ai_unavailable' }` (never throws) only when
    the AI provider itself is unreachable. */
export async function answerCoachQuestion(
  userId: string,
  question: string,
  lang: 'he' | 'en',
  chatId: string | null = null,
  /** Client-supplied history, used only as a fallback when Supabase isn't
      configured (so multi-turn context still works without persistence). */
  fallbackHistory: ChatTurn[] = [],
): Promise<ChatResult> {
  const supabase = isSupabaseConfigured() ? createServerSupabaseClient() : null;

  // Real macro calendar (Israel time) — runs regardless of journal data, and
  // in parallel with everything else. Never throws; [] on any failure.
  const macroPromise = getMacroEvents(supabase);

  // Journal facts — best effort. Missing or too-few trades no longer blocks the
  // coach; the prompt is told to admit it has no journal data for personal
  // questions, and general questions don't need it at all.
  let facts = '';
  let closedCount = 0;
  let analysis: FullAnalysis | null = null;
  if (supabase) {
    const trades = await getRecentTrades(supabase, userId);
    closedCount = trades.filter(t => t.result !== 'OPEN').length;
    if (closedCount >= MIN_CLOSED_TRADES) {
      analysis = runFullAnalysis(trades);
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
      facts = buildFactsContext(analysis, knownFactsBlock, hypothesisLine);
    }
  }

  // Macro block + personal overlap (today's high-impact events vs the trader's
  // weakest session). Israel time throughout.
  const today = israelToday();
  const macroEvents = await macroPromise;
  const macroBlock = buildMacroBlock(macroEvents, today);
  const overlapHint = analysis ? computeMacroOverlap(macroEvents, analysis, today) : '';

  // History: the server-stored chat is the source of truth. Fall back to what
  // the client sent only when Supabase isn't configured.
  let existing: ChatTurn[] = fallbackHistory;
  let resolvedChatId: string | null = chatId;
  let title: string | undefined;
  if (supabase && chatId) {
    const chat = await getCoachChat(supabase, userId, chatId);
    if (chat) { existing = chat.messages; title = chat.title; }
    else resolvedChatId = null; // stale/foreign id — start a fresh chat instead
  }

  const prompt = buildChatPrompt(facts, existing, question, lang, macroBlock, overlapHint);

  let answer: string;
  try {
    answer = extractResponse(await generateCoachText(prompt));
  } catch (err) {
    logger.error('chat coach generation failed', { error: err instanceof Error ? err.message : String(err) });
    return { answer: null, reason: 'ai_unavailable', chatId: resolvedChatId ?? undefined };
  }

  // Persist the turn — best effort, never fail the answer over a write.
  if (supabase) {
    try {
      if (!resolvedChatId) {
        resolvedChatId = await createCoachChat(supabase, userId, question);
        title = deriveChatTitle(question);
      }
      if (resolvedChatId) {
        const updated: ChatTurn[] = [
          ...existing,
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ];
        await saveCoachChatMessages(supabase, userId, resolvedChatId, updated);
      }
    } catch (err) {
      logger.warn('coach chat persist failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { answer, chatId: resolvedChatId ?? undefined, title, sampleSize: closedCount };
}
