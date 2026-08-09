// ─────────────────────────────────────────────────────────────────────────────
// Worker — picks a batch of due jobs from processing_jobs, runs them
// concurrently, marks each success/failure. Called by /api/cron/process-jobs
// every minute.
//
// The pick step uses pick_pending_jobs (SQL RPC, Step 6.5) so two workers
// firing at the same instant never touch the same row.
// ─────────────────────────────────────────────────────────────────────────────

import { pickPendingJobs, markJobSuccess, markJobFailure } from '../db/jobs';
import { getClient } from '../db/client';
import { flags } from '../db/flags';
import { generateDailyInsight, type PlanTier } from './generateDailyInsight';
import { normalizeRole } from '../../getUserRole';
import { isOwnerEmail } from '../auth/owners';
import { israelToday, israelYesterday } from '../dates';
import { logger } from '../../logger';
import type { ProcessingJobRow, JobErrorKind, JobType } from '../types';

export interface JobOutcomeSummary {
  jobId:      string;
  jobType:    JobType;
  clerkId:    string;
  status:     'success' | 'retried' | 'dead_letter' | 'skipped';
  reason?:    string;
  latencyMs:  number;
}

export interface BatchResult {
  picked:     number;
  completed:  number;
  failed:     number;              // moved to dead_letter this pass
  retried:    number;              // rescheduled for another attempt
  disabled?:  boolean;
  outcomes:   JobOutcomeSummary[];
}

/** Look up a clerk's current plan tier straight from the profiles table.
 *  One row query per job — the batch is small (≤ 20) so no batching needed. */
async function fetchPlanTier(clerkId: string): Promise<PlanTier> {
  const { data } = await getClient()
    .from('profiles')
    .select('role, email')
    .eq('clerk_id', clerkId)
    .maybeSingle();
  // Owner override, same rule as getUserRole.ts — keyed off the stored email
  // because the worker has no Clerk session to ask.
  if (isOwnerEmail((data as { email?: string | null } | null)?.email)) return 'deluxe';
  return normalizeRole(data?.role);
}

/** Dispatch a single job. Returns whether it should be marked success, and
 *  the corresponding summary. */
async function runOne(job: ProcessingJobRow): Promise<
  | { kind: 'success'; summary: JobOutcomeSummary }
  | { kind: 'failure'; errorKind: JobErrorKind; message: string; summary: JobOutcomeSummary }
> {
  const started = Date.now();

  try {
    if (job.job_type === 'daily_insight' || job.job_type === 'session_insight') {
      const plan = await fetchPlanTier(job.clerk_id);
      // target_date is set at enqueue time; the fallback only matters for a
      // hand-inserted row. A session insight is intraday (today); a nightly
      // one analyzes the trading day that just closed (yesterday in Israel,
      // because the cron runs after Israel midnight).
      const date = job.target_date
        ?? (job.job_type === 'session_insight' ? israelToday() : israelYesterday());
      const out  = await generateDailyInsight({
        clerkId:  job.clerk_id,
        date,
        planTier: plan,
        kind:     job.job_type === 'session_insight' ? 'session' : 'daily',
      });

      const summary = (status: JobOutcomeSummary['status'], reason?: string): JobOutcomeSummary => ({
        jobId:     job.id,
        jobType:   job.job_type,
        clerkId:   job.clerk_id,
        status,
        reason,
        latencyMs: Date.now() - started,
      });

      switch (out.status) {
        case 'ok':
        case 'exists':
        case 'ineligible':
        case 'disabled':
          // All treated as "the job did its part" — retrying wouldn't help.
          return { kind: 'success', summary: summary('success', out.status) };
        case 'both_providers_down':
          return {
            kind: 'failure',
            errorKind: 'model_error',
            message: `claude=${out.claudeError.slice(0, 120)} gemini=${out.geminiError.slice(0, 120)}`,
            summary: summary('retried', 'both_providers_down'),
          };
        case 'failed':
          return {
            kind: 'failure',
            errorKind: 'model_error',
            message: out.reason.slice(0, 200),
            summary: summary('retried', out.reason.slice(0, 60)),
          };
      }
    }

    // profile_refresh / note_embed jobs aren't wired to a runner yet — mark
    // as skipped rather than failed so they don't consume retry budget.
    return {
      kind: 'success',
      summary: {
        jobId: job.id, jobType: job.job_type, clerkId: job.clerk_id,
        status: 'skipped', reason: 'no_runner_yet', latencyMs: Date.now() - started,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: 'failure',
      errorKind: /rate/i.test(message) ? 'rate_limit' : /timeout/i.test(message) ? 'timeout' : 'model_error',
      message,
      summary: {
        jobId: job.id, jobType: job.job_type, clerkId: job.clerk_id,
        status: 'retried', reason: message.slice(0, 60), latencyMs: Date.now() - started,
      },
    };
  }
}

/** One tick of the worker. Called by the /api/cron/process-jobs route. */
export async function processJobBatch(): Promise<BatchResult> {
  if (!(await flags.aiPipelineEnabled())) {
    return { picked: 0, completed: 0, failed: 0, retried: 0, disabled: true, outcomes: [] };
  }

  const [concurrency, retryMax] = await Promise.all([
    flags.workerConcurrency(),
    flags.workerRetryMax(),
  ]);

  const jobs = await pickPendingJobs(concurrency);
  if (!jobs.length) return { picked: 0, completed: 0, failed: 0, retried: 0, outcomes: [] };

  const results = await Promise.allSettled(jobs.map(runOne));

  let completed = 0;
  let failed    = 0;
  let retried   = 0;
  const outcomes: JobOutcomeSummary[] = [];

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const r   = results[i];

    if (r.status === 'rejected') {
      // runOne itself threw — treat as a retryable error.
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.error('runOne threw unexpectedly', { jobId: job.id, error: message });
      const next = await markJobFailure(job, { errorMsg: message, errorKind: 'model_error', maxAttempts: retryMax });
      if (next === 'dead_letter') failed += 1; else retried += 1;
      outcomes.push({
        jobId: job.id, jobType: job.job_type, clerkId: job.clerk_id,
        status: next === 'dead_letter' ? 'dead_letter' : 'retried',
        reason: message.slice(0, 60), latencyMs: 0,
      });
      continue;
    }

    if (r.value.kind === 'success') {
      await markJobSuccess(job.id);
      completed += 1;
      outcomes.push(r.value.summary);
    } else {
      const next = await markJobFailure(job, {
        errorMsg: r.value.message, errorKind: r.value.errorKind, maxAttempts: retryMax,
      });
      if (next === 'dead_letter') { failed += 1; r.value.summary.status = 'dead_letter'; }
      else                        { retried += 1; }
      outcomes.push(r.value.summary);
    }
  }

  return { picked: jobs.length, completed, failed, retried, outcomes };
}
