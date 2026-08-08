// ─────────────────────────────────────────────────────────────────────────────
// Real-time trigger — after a trade save, decide whether to enqueue a
// session_insight for Deluxe users.
//
// Design (Step 5 §5): fires when the trader has closed >= 3 trades since the
// last insight AND the most recent session_insight is > 4 hours old (or none
// yet today). Enqueues with a 2-minute delay so a 4th trade coming in
// immediately after gets folded into the same run.
//
// Zero AI calls — this is a decision + INSERT. The actual generation happens
// later when the worker picks the job up.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient, requireClerkId } from '../db/client';
import { enqueueJob } from '../db/jobs';
import { T } from '../types';
import type { Role } from '../../getUserRole';
import { israelToday } from '../dates';

const MIN_TRADES_SINCE_LAST = 3;
const MIN_HOURS_BETWEEN     = 4;
const ENQUEUE_DELAY_MS      = 2 * 60_000;

export type SessionTriggerOutcome =
  | { status: 'enqueued'; scheduledAt: string }
  | { status: 'skipped'; reason: 'wrong_plan' | 'not_enough_new_trades' | 'too_soon' | 'already_queued' };

/** Returns the ISO timestamp of this user's last session_insight generation
 *  (any kind), or null if none. Read straight from daily_insights — the
 *  source of truth. */
async function lastSessionInsightAt(clerkId: string): Promise<string | null> {
  const { data, error } = await getClient()
    .from(T.dailyInsights)
    .select('generated_at')
    .eq('clerk_id', clerkId)
    .eq('kind', 'session')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.generated_at ?? null;
}

/** How many decided trades since `sinceIso`. Uses `intelligence_trades`, so
 *  this expects the write path to mirror trades there — until it does, the
 *  count is 0 and the trigger simply doesn't fire (safe default). */
async function decidedTradesSince(clerkId: string, sinceIso: string): Promise<number> {
  const { count, error } = await getClient()
    .from(T.trades)
    .select('id', { count: 'exact', head: true })
    .eq('clerk_id', clerkId)
    .is('deleted_at', null)
    .in('result', ['WIN', 'LOSS', 'BE'])
    .gt('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/** Check + enqueue. Called after a successful trade save from the API route.
 *  Never throws — returns a discriminated outcome. */
export async function maybeEnqueueSessionInsight(
  clerkId: string,
  planTier: Role,
): Promise<SessionTriggerOutcome> {
  const cid = requireClerkId(clerkId);

  // Only Deluxe gets session insights.
  if (planTier !== 'deluxe') return { status: 'skipped', reason: 'wrong_plan' };

  // How long since the last session insight?
  const lastAt = await lastSessionInsightAt(cid);
  if (lastAt) {
    const hoursSince = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince < MIN_HOURS_BETWEEN) return { status: 'skipped', reason: 'too_soon' };
  }

  // Baseline: newer of (lastAt) and (start of today Israel). This makes the
  // count "trades since last insight, but never older than today".
  const startOfToday = new Date(`${israelToday()}T00:00:00Z`).toISOString();
  const since = lastAt && lastAt > startOfToday ? lastAt : startOfToday;

  const n = await decidedTradesSince(cid, since);
  if (n < MIN_TRADES_SINCE_LAST) return { status: 'skipped', reason: 'not_enough_new_trades' };

  // Enqueue with the 2-minute delay. ON CONFLICT (unique idx on
  // clerk_id, job_type, target_date) → null return means "already queued".
  const scheduledAt = new Date(Date.now() + ENQUEUE_DELAY_MS);
  const inserted = await enqueueJob({
    clerkId:    cid,
    jobType:    'session_insight',
    targetDate: israelToday(),
    scheduledAt,
  });
  if (!inserted) return { status: 'skipped', reason: 'already_queued' };

  return { status: 'enqueued', scheduledAt: scheduledAt.toISOString() };
}
