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
import { checkProse, hasHardViolation, buildCorrection } from '../coach-pipeline/quality/insightCheck';
import { getRecentTrades, getTraderProfile, getHypothesis } from '../intelligence/repository';
import { runFullAnalysis, loadMacroContext, type FullAnalysis } from '../analytics';
import { summarizeKnownFacts } from './factsBlock';
import { generateCoachJson } from './client';
import { buildFactsContext, buildChatPrompt, type ChatTurn } from './chatPrompt';
import { createCoachChat, getCoachChat, saveCoachChatMessages, deriveChatTitle } from './coachChats';
import { getMacroEvents, buildMacroBlock, computeMacroOverlap, israelToday } from './macroCalendar';
import { parseCoachJson } from './coachOutput';
import { logCoachFallback } from './coachFallbackLog';
import { retrieveKnowledge, renderKnowledge } from './kb';
import { classifyQuestion } from './router';
import { traderProfileBlock } from '../settings/server';
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

  // What the trader wrote about themselves. Started in parallel: it is a single
  // indexed row and must never be the reason an answer is slow.
  const profilePromise = traderProfileBlock(userId).catch(() => '');

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
      // The macro context comes from the cached calendar, exactly as the
      // pattern-insights route loads it — without it the chat's own copy of
      // the analysis is missing the event/quiet comparison while the AI
      // analytics page has it, and the two surfaces answer the same question
      // differently.
      const [profileRecord, hypothesis, macroCtx] = await Promise.all([
        getTraderProfile(supabase, userId),
        getHypothesis(supabase, userId),
        loadMacroContext(supabase),
      ]);
      analysis = runFullAnalysis(trades, macroCtx);
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

  // Pre-flight router — deterministically classify the question so the prompt
  // injects ONLY the rule blocks it needs (fights Lost-in-the-Middle).
  const categories = classifyQuestion(question);

  // Layer 1 — retrieve book-depth knowledge for the concepts this question
  // touches (injected only when relevant; never the whole KB).
  const knowledgeBlock = renderKnowledge(retrieveKnowledge(question));
  const prompt = buildChatPrompt(
    facts, existing, question, lang, macroBlock, overlapHint, knowledgeBlock, categories,
    await profilePromise,
  );

  // Structured-output pipeline. The model must return {reasoning, final_answer};
  // we read ONLY final_answer, so its private reasoning can never reach the user
  // by construction. If the output doesn't parse into that shape, we NEVER show
  // the raw text — we re-ask once with a corrective nudge, and if it still fails
  // we return the fixed "unavailable" message. Every fallback is logged so the
  // real production rate is visible, not discovered by hand.
  const CORRECTIVE = '\n\nYour previous reply could not be parsed. Respond again with ONLY a valid JSON object of the exact shape {"reasoning": "...", "final_answer": "..."} and nothing else.';
  let answer: string | null;
  try {
    const meta = { clerkId: userId, purpose: 'coach_chat' };
    answer = parseCoachJson(await generateCoachJson(prompt, meta));
    if (!answer) {
      await logCoachFallback(supabase, userId, 'retry', question);
      answer = parseCoachJson(await generateCoachJson(prompt + CORRECTIVE, { ...meta, purpose: 'coach_chat_retry' }));
    }
  } catch (err) {
    logger.error('chat coach generation failed', { error: err instanceof Error ? err.message : String(err) });
    return { answer: null, reason: 'ai_unavailable', chatId: resolvedChatId ?? undefined };
  }
  if (!answer) {
    // Contract still violated after the retry — fail safe. The user sees the
    // fixed error, never a scrap of raw model output.
    await logCoachFallback(supabase, userId, 'failed', question);
    return { answer: null, reason: 'ai_unavailable', chatId: resolvedChatId ?? undefined };
  }

  // The answer parsed. Whether it is an answer this product is allowed to give
  // is a separate question, and until now nobody asked it: the daily insight
  // has run these checks since it shipped and the chat ran none, so the same
  // model publishing the same two failures — a coaching platitude, a claim
  // about the trader's own psychology — was caught in the morning note and
  // waved through in the conversation.
  //
  // One corrective retry, the same shape the JSON contract already uses. A
  // second failure keeps the first answer rather than refusing: a reply
  // carrying a soft violation is worth more to the trader than an error
  // message, and the violations are logged either way.
  try {
    const violations = checkProse(answer, lang);
    if (hasHardViolation(violations)) {
      logger.warn('coach chat output violated its own rules', {
        clerkId: userId, rules: violations.filter(v => v.severity === 'hard').map(v => v.rule),
      });
      const corrected = parseCoachJson(
        await generateCoachJson(prompt + buildCorrection(violations), {
          clerkId: userId, purpose: 'coach_chat_recheck',
        }),
      );
      if (corrected && !hasHardViolation(checkProse(corrected, lang))) answer = corrected;
    }
  } catch (err) {
    // A failed re-ask must not cost the answer we already have.
    logger.warn('coach chat recheck failed', { error: err instanceof Error ? err.message : String(err) });
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
