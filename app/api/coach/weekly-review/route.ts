// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/weekly-review — what changed in the trader's behaviour over
// the last seven days.
//
// Distinct from /api/ai/weekly-report, which summarises the week's RESULTS.
// This one answers a different question — did anything about how you trade
// move — and it is the only surface that asks "since last week" rather than
// "right now".
//
// Free: no model. The review is assembled from the behaviour layer's own
// records and the lifecycle events it wrote as it went. Everything it can say
// was already decided by the analysis; nothing here is generated.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { listRecentTrades } from '../../../lib/coach-pipeline/db/trades';
import { loadFindings, listFindingEventsSince } from '../../../lib/coach-pipeline/db/behaviorFindings';
import { detectBehaviors } from '../../../lib/coach-pipeline/behavior/behaviors';
import { buildContexts } from '../../../lib/coach-pipeline/behavior/context';
import { buildFinding } from '../../../lib/coach-pipeline/behavior/finding';
import { familiesFor } from '../../../lib/coach-pipeline/behavior/memory';
import { buildWeeklyReview } from '../../../lib/coach-pipeline/behavior/weekly';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WINDOW_DAYS = 7;

export async function GET() {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/coach/weekly-review');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/weekly-review GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:weekly:${userId}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  const to   = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);

  try {
    const [trades, stored, events] = await Promise.all([
      listRecentTrades(userId, 500),
      loadFindings(userId),
      listFindingEventsSince(userId, from.toISOString()),
    ]);

    const contexts = buildContexts(trades);
    // Same construction as the nightly run, so the numbers in the review are
    // the numbers the coach is working from — not a second opinion computed
    // slightly differently on a different screen.
    const findings = detectBehaviors(trades).map(t => buildFinding(t, contexts, {
      rByTradeId:     new Map(trades.map(x => [x.id, x.r_multiple])),
      previousStatus: stored.get(t.kind)?.status,
      extraFamilies:  familiesFor(stored.get(t.kind) ?? null),
    }));

    const primaryKind = [...stored.values()].find(s => s.isPrimary)?.kind ?? null;

    return NextResponse.json({
      review: buildWeeklyReview({
        findings, stored, events, primaryKind,
        from: from.toISOString(), to: to.toISOString(),
      }),
    });
  } catch (err) {
    // A missing table or a failed read costs the panel, never the page.
    logger.warn('weekly-review failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ review: null });
  }
}
