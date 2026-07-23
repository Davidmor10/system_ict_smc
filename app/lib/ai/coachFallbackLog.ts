import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

export type CoachFallbackStage = 'retry' | 'failed';

/** Records when the coach's structured-output contract was violated — the
    model returned something we could not parse into {final_answer}. Two stages:
      • 'retry'  — the first attempt failed to parse; we re-asked with a
                   corrective instruction.
      • 'failed' — still unparseable after the retry, so the user was shown the
                   fixed error message instead of ANY raw model text.
    Best-effort by design: a logging failure must never affect the user's
    request. It also emits to stdout (Vercel logs) so the signal exists even
    before the table is applied. Storing only a short question preview keeps the
    log useful without persisting whole conversations. */
export async function logCoachFallback(
  supabase: SupabaseClient | null,
  clerkId: string,
  stage: CoachFallbackStage,
  question: string,
): Promise<void> {
  logger.warn('coach structured-output fallback', { stage, clerkId });
  if (!supabase) return;
  try {
    await supabase.from('coach_generation_fallback').insert({
      clerk_id: clerkId,
      stage,
      question_preview: question.slice(0, 200),
    });
  } catch (err) {
    logger.warn('coach fallback log insert failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
