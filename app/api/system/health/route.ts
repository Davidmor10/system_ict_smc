// ─────────────────────────────────────────────────────────────────────────────
// GET /api/system/health — did the nightly run work, and what did it find.
//
// WHY THIS EXISTS
//
// The nightly cron has written a row per run since it shipped: when it
// started, how long it took, how many jobs completed and failed. Nothing has
// ever read that table. A failed run left a record nobody opened, and on this
// plan the log line naming it expired an hour later.
//
// So the failure mode was total silence. Every screen kept rendering whatever
// the last successful run produced, growing quietly staler, and the only way
// to notice was to wonder why the coach had stopped saying anything new. That
// is not a monitoring gap, it is a trust one: a system that cannot tell the
// trader it is broken is asking to be believed on nights it should not be.
//
// The route reports the last run and nothing else. No history, no chart — the
// question it answers is "is this thing running", and the honest answer is one
// timestamp and one word.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { T, type CronRunRow } from '../../../lib/coach-pipeline/types';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';

export interface NightlyHealth {
  /** When the last run started, ISO. Null when none has ever run. */
  lastRunAt: string | null;
  /** Whether it finished without an error. */
  ok: boolean;
  /** How long it took, milliseconds. */
  durationMs: number | null;
  jobsCompleted: number;
  jobsFailed: number;
  /** What the mirror reconciliation repaired. Null means the run predates the
   *  reconciler, or the database has not run its migration — which is not the
   *  same as zero, and the surface must not merge them. */
  repairedMissing: number | null;
  repairedGhosts: number | null;
  orphans: number | null;
}

export async function GET() {
  const denied = await requirePlanApi('starter', '/api/system/health');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/system/health' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`system:health:${userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    const { data, error } = await getClient()
      .from(T.cronRuns)
      .select('*')
      .eq('cron_key', 'nightly-orchestrate')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw error;

    const row = (data ?? [])[0] as CronRunRow | undefined;
    if (!row) {
      return NextResponse.json({
        lastRunAt: null, ok: false, durationMs: null,
        jobsCompleted: 0, jobsFailed: 0,
        repairedMissing: null, repairedGhosts: null, orphans: null,
      } satisfies NightlyHealth);
    }

    // The error TEXT never leaves the server: it is a raw provider or Postgres
    // message and carries table, column and constraint names. The trader needs
    // to know the run failed, not what the schema is called.
    return NextResponse.json({
      lastRunAt:       row.started_at,
      ok:              row.error == null,
      durationMs:      row.duration_ms,
      jobsCompleted:   row.jobs_completed,
      jobsFailed:      row.jobs_failed,
      repairedMissing: row.repaired_missing ?? null,
      repairedGhosts:  row.repaired_ghosts  ?? null,
      orphans:         row.orphans          ?? null,
    } satisfies NightlyHealth);
  } catch (err) {
    logger.error('system health read failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
