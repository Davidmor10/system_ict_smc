// ─────────────────────────────────────────────────────────────────────────────
// Nightly orchestrator — enumerates eligible users and enqueues one
// daily_insight job per user with a staggered scheduled_at.
//
// Zero AI calls. Only SQL + INSERTs into processing_jobs. The `ON CONFLICT
// DO NOTHING` on the unique index (clerk_id, job_type, target_date) makes
// this idempotent: a duplicate cron fire in the same day is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import { T, type JobType } from '../types';
import { getClient } from '../db/client';
import { enqueueJob } from '../db/jobs';
import { flags } from '../db/flags';
import { normalizeRole, type Role } from '../../getUserRole';
import { isOwnerEmail } from '../auth/owners';
import { israelYesterday, israelDayOfWeek, scheduleSlotFor } from '../dates';
import { logger } from '../../logger';

/** Who the pipeline runs for, and how often.
 *
 *  ANALYSIS STARTS AT PRO. Starter buys the journal — the log, the notebook,
 *  the setups, the rules, the statistics over what was written. It does not
 *  buy the AI, and the honest way to sell it that way is not to compute it and
 *  hide it: a starter account's trades are never analysed at all. The night a
 *  trader upgrades is the night the system starts watching, and everything it
 *  says afterwards is about the trades it has actually seen.
 *
 *  Starter used to run on Sun/Tue/Thu, which meant paying for the cheapest
 *  tier bought a thinner version of the same product. It now buys a different
 *  product. */
function isEligibleToday(plan: Role, _dow: number): boolean {
  return plan === 'deluxe' || plan === 'pro';
}

interface EligibleUser {
  clerkId:  string;
  planTier: Role;
}

/** Distinct clerk_ids that have logged at least one intelligence_trades row
 *  in the last `idleSkipDays` — the "still active" set. Bounded by `hardLimit`
 *  to keep the orchestrator well within its Vercel function budget on the
 *  Sunday-morning burst; we can raise this once we have real usage numbers. */
async function listActiveClerkIds(idleSkipDays: number, hardLimit = 5000): Promise<string[]> {
  const since = new Date(Date.now() - idleSkipDays * 24 * 60 * 60 * 1000).toISOString();
  // Supabase-JS doesn't expose SELECT DISTINCT natively over PostgREST;
  // deduplicate client-side after a paginated read. For 5000 active users
  // this is at most 5 pages of 1000 rows — negligible latency.
  const seen = new Set<string>();
  const pageSize = 1000;
  const client = getClient();
  for (let offset = 0; offset < hardLimit; offset += pageSize) {
    const { data, error } = await client
      .from(T.trades)
      .select('clerk_id')
      .gt('created_at', since)
      .is('deleted_at', null)
      .order('clerk_id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ clerk_id: string }>;
    if (!rows.length) break;
    for (const r of rows) seen.add(r.clerk_id);
    if (rows.length < pageSize) break;
  }
  return [...seen];
}

/** Batch-load plan tiers from `profiles` — single query, no N+1 Clerk hits.
 *
 *  Owner emails resolve to deluxe regardless of what `role` says, matching
 *  getUserRole.ts. The worker has no Clerk session to ask, so the override
 *  keys off profiles.email instead of currentUser(). */
async function loadPlanTiers(clerkIds: string[]): Promise<Map<string, Role>> {
  if (!clerkIds.length) return new Map();
  const { data, error } = await getClient()
    .from('profiles')
    .select('clerk_id, role, email')
    .in('clerk_id', clerkIds);
  if (error) throw error;
  const map = new Map<string, Role>();
  for (const row of (data ?? []) as Array<{ clerk_id: string; role: unknown; email: string | null }>) {
    map.set(row.clerk_id, isOwnerEmail(row.email) ? 'deluxe' : normalizeRole(row.role));
  }
  return map;
}

/** Filter to users the pipeline should run for tonight, tagged with their plan. */
export async function enumerateEligibleUsers(
  now: Date = new Date(),
): Promise<EligibleUser[]> {
  const [idleSkipDays] = await Promise.all([flags.idleSkipDays()]);
  const dow  = israelDayOfWeek(now);
  const cids = await listActiveClerkIds(idleSkipDays);
  const tiers = await loadPlanTiers(cids);

  const out: EligibleUser[] = [];
  for (const cid of cids) {
    const plan = tiers.get(cid) ?? 'free';
    if (isEligibleToday(plan, dow)) out.push({ clerkId: cid, planTier: plan });
  }
  return out;
}

export interface ScheduleResult {
  enumerated:      number;        // total active users seen
  eligible:        number;        // matched today's cadence rule
  enqueued:        number;        // fresh jobs inserted
  skippedExisting: number;        // ON CONFLICT DO NOTHING hit
  windowMinutes:   number;
  disabled?:       boolean;       // kill switch was off — nothing enqueued
  error?:          string;
}

/** Full orchestrator run. Accepts an optional spread override so a caller
 *  that plans to drain the queue inline (e.g. Vercel Hobby, no minute-worker
 *  cron) can force every job's scheduled_at to now(). */
export async function scheduleNightlyJobs(
  now: Date = new Date(),
  spreadMinutesOverride?: number,
): Promise<ScheduleResult> {
  if (!(await flags.aiPipelineEnabled())) {
    logger.warn('scheduleNightlyJobs skipped — kill switch off');
    return { enumerated: 0, eligible: 0, enqueued: 0, skippedExisting: 0, windowMinutes: 0, disabled: true };
  }

  const windowMinutes = spreadMinutesOverride ?? await flags.spreadWindowMinutes();
  const users         = await enumerateEligibleUsers(now);
  // The trading day being analyzed, NOT the calendar day the cron wakes up on.
  // We fire at 01:00 UTC = 03:00/04:00 Israel, so Israel has already flipped
  // to the next date; targeting it would look for trades in a three-hour-old
  // day and find none, every single night.
  const targetDate    = israelYesterday(now);
  const jobType: JobType = 'daily_insight';

  let enqueued = 0;
  let existing = 0;
  for (const u of users) {
    const scheduledAt = scheduleSlotFor(u.clerkId, windowMinutes, now);
    const row = await enqueueJob({
      clerkId:     u.clerkId,
      jobType,
      targetDate,
      scheduledAt,
    });
    if (row) enqueued += 1; else existing += 1;

    // The descriptive stack's nightly pass. A second behind the insight, not
    // a minute: on Hobby this cron drains its own queue inline for about
    // forty-five seconds and never runs again that day, so anything not due
    // inside that window waits a full day. One second is enough to put the
    // note the trader actually reads ahead of a profile rebuild in the pick
    // order, and small enough that the same drain still reaches it.
    //
    // Its own row rather than riding inside the insight, because the two fail
    // independently: a model outage must not cost the deterministic refresh,
    // and a slow refresh must not cost the note. The same unique index makes
    // a second cron fire in one day a no-op for both.
    const refresh = await enqueueJob({
      clerkId:     u.clerkId,
      jobType:     'profile_refresh',
      targetDate,
      scheduledAt: new Date(scheduledAt.getTime() + 1_000),
    });
    if (refresh) enqueued += 1; else existing += 1;
  }

  return {
    enumerated:      users.length,  // eligible count IS enumerated because we filter first
    eligible:        users.length,
    enqueued,
    skippedExisting: existing,
    windowMinutes,
  };
}

// ── Exports for tests ───────────────────────────────────────────────────────
export const __internals = { isEligibleToday };
