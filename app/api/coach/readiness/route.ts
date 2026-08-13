// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/readiness — what the coach can see in this trader's journal,
// and what it is waiting for.
//
// The trader's own data, their own session, no model, no writes. Cheap enough
// to call on every dashboard load, which is the point: a coach that is
// correctly silent looks exactly like a broken one until it can say why.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { listRecentTrades } from '../../../lib/coach-pipeline/db/trades';
import { computeReadiness } from '../../../lib/coach-pipeline/behavior/readiness';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/readiness GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:readiness:${userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  try {
    const trades = await listRecentTrades(userId, 500);
    return NextResponse.json({ readiness: computeReadiness(trades) });
  } catch (err) {
    // A failure here costs a helper panel, never the page it sits on.
    logger.warn('readiness failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ readiness: null });
  }
}
