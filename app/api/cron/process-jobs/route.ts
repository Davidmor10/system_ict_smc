// ─────────────────────────────────────────────────────────────────────────────
// /api/cron/process-jobs — POST, called by Vercel Cron every minute (24/7).
//
// Picks up to `worker_concurrency` (5) due jobs from processing_jobs and
// runs them via generateDailyInsight. Race-safe: two workers firing at the
// same instant get non-overlapping rows via SKIP LOCKED inside the RPC.
//
// The route itself is thin — all the work lives in processJobBatch.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { processJobBatch } from '../../../lib/coach-pipeline/pipelines/processJobBatch';
import { assertCronAuth } from '../../../lib/coach-pipeline/auth/guards';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { T } from '../../../lib/coach-pipeline/types';
import { logger } from '../../../lib/logger';

// Concurrent jobs at 15s Claude timeout = ~15s wall clock max in bad cases.
// 60s gives generous headroom.
export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

const ROUTE = '/api/cron/process-jobs';

async function logRun(startedAt: string, ok: boolean, extra: Record<string, unknown>): Promise<void> {
  try {
    await getClient().from(T.cronRuns).insert({
      cron_key:       'process-jobs',
      started_at:     startedAt,
      finished_at:    new Date().toISOString(),
      duration_ms:    Date.now() - Date.parse(startedAt),
      jobs_picked:    Number(extra.picked    ?? 0),
      jobs_completed: Number(extra.completed ?? 0),
      jobs_failed:    Number(extra.failed    ?? 0),
      jobs_retried:   Number(extra.retried   ?? 0),
      error:          ok ? null : String(extra.error ?? '').slice(0, 500),
    });
  } catch { /* observability shouldn't take down the endpoint */ }
}

export async function POST(req: Request) {
  const denied = assertCronAuth(req, ROUTE);
  if (denied) return denied;

  const startedAt = new Date().toISOString();
  try {
    const result = await processJobBatch();
    // A "did nothing" run is normal and doesn't need to spam cron_runs.
    if (result.picked > 0) await logRun(startedAt, true, { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Detail to the log only — raw Postgres errors name tables, columns and
    // constraints, which is a free schema map for anyone probing the endpoint.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('process-jobs failed', { error: msg });
    await logRun(startedAt, false, { error: msg });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Same as nightly-orchestrate: Vercel Cron issues GET, and the bearer guard
 *  is what keeps this closed, not the HTTP verb. */
export async function GET(req: Request) { return POST(req); }
