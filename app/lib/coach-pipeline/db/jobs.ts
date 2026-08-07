// ─────────────────────────────────────────────────────────────────────────────
// processing_jobs — the batch queue.
//
// Two callers:
//   - the orchestrator cron: enqueues a batch every night with staggered
//     scheduled_at values.
//   - the worker cron: picks a small batch every minute, runs them, then
//     marks each success/failed.
//
// Everything below is designed to be race-safe: pickJobsForRun uses
// SELECT FOR UPDATE SKIP LOCKED so two concurrent workers never grab the
// same row, and INSERTs use ON CONFLICT to lean on the DB unique indexes for
// dedup rather than a check-then-write pattern that can race.
// ─────────────────────────────────────────────────────────────────────────────

import { T, type ProcessingJobRow, type JobType, type JobErrorKind } from '../types';
import { getClient, requireClerkId } from './client';

// ── Enqueue ─────────────────────────────────────────────────────────────────

export interface EnqueueInput {
  clerkId:         string;
  jobType:         JobType;
  targetDate?:     string;                 // 'YYYY-MM-DD' for daily/session insights
  scheduledAt?:    Date;                   // defaults to now
  inputTradeIds?:  string[];
  inputEntryIds?:  string[];
}

/** Insert a new job. Idempotent by the unique index on
    (clerk_id, job_type, target_date) WHERE status IN (pending,running,success):
    duplicate INSERTs return null instead of throwing. */
export async function enqueueJob(input: EnqueueInput): Promise<ProcessingJobRow | null> {
  const cid = requireClerkId(input.clerkId);
  const row = {
    clerk_id:        cid,
    job_type:        input.jobType,
    status:          'pending' as const,
    target_date:     input.targetDate ?? null,
    scheduled_at:    (input.scheduledAt ?? new Date()).toISOString(),
    attempt_count:   0,
    input_trade_ids: input.inputTradeIds ?? null,
    input_entry_ids: input.inputEntryIds ?? null,
  };
  const { data, error } = await getClient()
    .from(T.processingJobs)
    .insert(row, { count: 'exact' })
    .select('*')
    .maybeSingle();
  // On unique-index conflict Supabase returns 23505 — surface as "no insert".
  if (error && error.code === '23505') return null;
  if (error) throw error;
  return (data as ProcessingJobRow | null) ?? null;
}

// ── Pick + claim ────────────────────────────────────────────────────────────

/** Atomically grab up to `limit` pending jobs whose scheduled_at is due,
    marking them 'running' in the same round-trip. Two concurrent workers
    calling this at the same instant NEVER get overlapping rows — the
    FOR UPDATE SKIP LOCKED at the CTE step is doing the deconfliction.

    Delegates to a Postgres function (`pick_pending_jobs`) that we'll add in
    a small follow-up SQL patch when we build the worker cron. Until then
    this helper is unused. */
export async function pickPendingJobs(limit = 5): Promise<ProcessingJobRow[]> {
  const { data, error } = await getClient().rpc('pick_pending_jobs', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ProcessingJobRow[];
}

// ── Complete / fail ─────────────────────────────────────────────────────────

export interface JobSuccess {
  outputSummary?: Record<string, unknown>;
  tokensUsed?:    number;
}

/** Mark a job as successfully finished. */
export async function markJobSuccess(jobId: string, result: JobSuccess = {}): Promise<void> {
  const { error } = await getClient()
    .from(T.processingJobs)
    .update({
      status:         'success',
      finished_at:    new Date().toISOString(),
      output_summary: result.outputSummary ?? null,
      tokens_used:    result.tokensUsed    ?? null,
      error:          null,
      error_kind:     null,
    })
    .eq('id', jobId);
  if (error) throw error;
}

export interface JobFailure {
  errorMsg:    string;
  errorKind:   JobErrorKind;
  maxAttempts: number;                     // usually feature_flags.worker_retry_max
}

/** Fail a job. Either reschedules it with exponential backoff (if it hasn't
    hit its retry ceiling) or moves it to dead_letter for manual inspection.
    Returns the resulting status so the caller can log accordingly. */
export async function markJobFailure(
  job:  ProcessingJobRow,
  fail: JobFailure,
): Promise<'pending' | 'dead_letter'> {
  const nextAttempt = job.attempt_count + 1;

  if (nextAttempt >= fail.maxAttempts) {
    const { error } = await getClient()
      .from(T.processingJobs)
      .update({
        status:        'dead_letter',
        finished_at:   new Date().toISOString(),
        attempt_count: nextAttempt,
        error:         fail.errorMsg.slice(0, 500),
        error_kind:    fail.errorKind,
      })
      .eq('id', job.id);
    if (error) throw error;
    return 'dead_letter';
  }

  // Exponential backoff: 2m, 4m, 8m, ...
  const backoffMs   = Math.min(2 ** nextAttempt * 60_000, 60 * 60_000);
  const nextRetryAt = new Date(Date.now() + backoffMs);
  const { error } = await getClient()
    .from(T.processingJobs)
    .update({
      status:         'pending',
      attempt_count:  nextAttempt,
      next_retry_at:  nextRetryAt.toISOString(),
      started_at:     null,
      error:          fail.errorMsg.slice(0, 500),
      error_kind:     fail.errorKind,
    })
    .eq('id', job.id);
  if (error) throw error;
  return 'pending';
}

// ── Inspection ──────────────────────────────────────────────────────────────

/** Latest N jobs (any status) for a user — useful for admin/observability. */
export async function listRecentJobs(clerkId: string, limit = 20): Promise<ProcessingJobRow[]> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.processingJobs)
    .select('*')
    .eq('clerk_id', cid)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ProcessingJobRow[];
}
