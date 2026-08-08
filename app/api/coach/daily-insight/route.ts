// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/daily-insight
// Returns the newest daily_insights row for the current user. Client-side
// glue only — the DB helpers do the real work.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { listRecentInsights } from '../../../lib/coach-pipeline/db/insights';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/daily-insight GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`di:get:${userId}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  try {
    const rows = await listRecentInsights(userId, 1);
    return NextResponse.json({ insight: rows[0] ?? null });
  } catch (err) {
    logger.error('daily-insight GET failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
