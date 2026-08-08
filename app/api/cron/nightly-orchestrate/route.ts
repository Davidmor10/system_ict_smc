// ─────────────────────────────────────────────────────────────────────────────
// /api/cron/nightly-orchestrate — POST, called by Vercel Cron once per day
// at 01:00 UTC (03:00 IL winter / 04:00 IL summer — DST decision from Step 5).
//
// Never runs AI. Only SQL:
//   1. Enumerate active users (intelligence_trades in last N days).
//   2. Filter by tier + cadence rule.
//   3. Spread across the 60-minute window and INSERT jobs.
//
// Idempotent — the unique index on processing_jobs(clerk_id, job_type,
// target_date) means a duplicate fire is a no-op. Runs in a few seconds even
// with a few thousand users.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { scheduleNightlyJobs } from '../../../lib/coach-pipeline/pipelines/scheduleNightlyJobs';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { T } from '../../../lib/coach-pipeline/types';
import { logger } from '../../../lib/logger';

// Vercel-side: 60s max — this route stays well under.
export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the secret is
 *  configured. In dev without the secret, both cron calls and manual pokes
 *  succeed — a warning is logged so it's visible. */
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

async function logRun(startedAt: string, ok: boolean, extra: Record<string, unknown> & { enqueued?: number; error?: string }): Promise<void> {
  try {
    await getClient().from(T.cronRuns).insert({
      cron_key:       'nightly-orchestrate',
      started_at:     startedAt,
      finished_at:    new Date().toISOString(),
      duration_ms:    Date.now() - Date.parse(startedAt),
      jobs_picked:    Number(extra.enqueued ?? 0),
      jobs_completed: 0,
      jobs_failed:    0,
      jobs_retried:   0,
      error:          ok ? null : String(extra.error ?? '').slice(0, 500),
    });
  } catch { /* observability shouldn't take down the endpoint */ }
}

export async function POST(req: Request) {
  const auth = assertCronAuth(req);
  if (auth) return auth;

  const startedAt = new Date().toISOString();
  try {
    const result = await scheduleNightlyJobs();
    await logRun(startedAt, true, { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('nightly-orchestrate failed', { error: msg });
    await logRun(startedAt, false, { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Support GET for manual poke from a browser (auth-gated identically).
export async function GET(req: Request) { return POST(req); }
