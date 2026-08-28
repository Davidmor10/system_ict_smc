// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coach/daily-insight/read
// Body: { id: string }
// Marks the given insight row as read (stamps read_at, idempotent — the
// underlying helper only writes when read_at IS NULL). Scoped to the
// authenticated user, so a caller trying to mark another user's row does
// nothing (the WHERE clerk_id filter drops it).
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { markInsightRead } from '../../../../lib/coach-pipeline/db/insights';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../lib/securityLog';
import { logger } from '../../../../lib/logger';
import { requirePlanApi } from '../../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('pro', '/api/coach/daily-insight/read');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/daily-insight/read POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`di:read:${userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Bad JSON body' }, { status: 400 }); }

  const id = (body as { id?: unknown })?.id;
  if (typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    await markInsightRead(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('daily-insight read POST failed', {
      userId, id, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
