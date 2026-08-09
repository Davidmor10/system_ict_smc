// ─────────────────────────────────────────────────────────────────────────────
// /api/cron/nightly-orchestrate — POST, called by Vercel Cron once per day
// at 01:00 UTC (03:00 IL winter / 04:00 IL summer — DST decision from Step 5).
//
// On Vercel Hobby (max one-per-day cron), this is the ONLY cron the pipeline
// has, so it does two things back-to-back in one invocation:
//   1. Enumerate active users + enqueue a daily_insight job per user (no
//      spread — all scheduled_at = now() so the drain picks them immediately).
//   2. Drain the queue by calling processJobBatch in a loop until it's empty
//      or the function budget is nearly used.
//
// Vercel function ceiling is 60s here. At ~5s Claude call × 5 concurrent
// workers ≈ 5 users/pass, we handle ~40-50 users in a 45s drain window —
// comfortable for the near-term. When the account moves to Pro, restore
// the separate minute-worker cron and drop the drain loop.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { scheduleNightlyJobs } from '../../../lib/coach-pipeline/pipelines/scheduleNightlyJobs';
import { processJobBatch, type BatchResult } from '../../../lib/coach-pipeline/pipelines/processJobBatch';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { T } from '../../../lib/coach-pipeline/types';
import { logger } from '../../../lib/logger';

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

const DRAIN_BUDGET_MS = 45_000;   // leave 15s for enqueue + logging + response

function assertCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.warn('CRON_SECRET unset — /api/cron/* endpoints are open');
    return null;
  }
  const header = req.headers.get('authorization') ?? '';
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

async function logRun(startedAt: string, ok: boolean, extra: Record<string, unknown> & {
  enqueued?: number; completed?: number; failed?: number; retried?: number; error?: string;
}): Promise<void> {
  try {
    await getClient().from(T.cronRuns).insert({
      cron_key:       'nightly-orchestrate',
      started_at:     startedAt,
      finished_at:    new Date().toISOString(),
      duration_ms:    Date.now() - Date.parse(startedAt),
      jobs_picked:    Number(extra.enqueued  ?? 0),
      jobs_completed: Number(extra.completed ?? 0),
      jobs_failed:    Number(extra.failed    ?? 0),
      jobs_retried:   Number(extra.retried   ?? 0),
      error:          ok ? null : String(extra.error ?? '').slice(0, 500),
    });
  } catch { /* observability shouldn't take down the endpoint */ }
}

/** Drain the queue by pulling batches until either (a) a batch is empty
 *  (nothing more to do) or (b) we're past DRAIN_BUDGET_MS. Aggregates the
 *  per-batch counters. */
async function drainUntilEmptyOrBudget(started: number): Promise<Pick<BatchResult, 'picked' | 'completed' | 'failed' | 'retried'>> {
  let picked = 0, completed = 0, failed = 0, retried = 0;
  while (Date.now() - started < DRAIN_BUDGET_MS) {
    const batch = await processJobBatch();
    picked    += batch.picked;
    completed += batch.completed;
    failed    += batch.failed;
    retried   += batch.retried;
    if (batch.picked === 0) break;
    if (batch.disabled)     break;
  }
  return { picked, completed, failed, retried };
}

export async function POST(req: Request) {
  const auth = assertCronAuth(req);
  if (auth) return auth;

  const started   = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    // Schedule with spread=0 — every job is due immediately so the drain
    // below picks them all in the first pass.
    const scheduled = await scheduleNightlyJobs(new Date(), 0);
    const drained   = await drainUntilEmptyOrBudget(started);

    const combined = { ...scheduled, ...drained };
    await logRun(startedAt, true, combined);
    return NextResponse.json({ ok: true, ...combined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('nightly-orchestrate failed', { error: msg });
    await logRun(startedAt, false, { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Support GET for manual poke from a browser (auth-gated identically).
export async function GET(req: Request) { return POST(req); }
