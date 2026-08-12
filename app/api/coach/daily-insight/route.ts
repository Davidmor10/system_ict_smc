// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/daily-insight
// Returns the newest daily_insights row for the current user. Client-side
// glue only — the DB helpers do the real work.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { listRecentInsights } from '../../../lib/coach-pipeline/db/insights';
import { getOpenQuestion } from '../../../lib/coach-pipeline/db/behaviorFindings';
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

    // The open question rides along with the insight rather than getting its
    // own fetch: it belongs to the same card, and a second request would let
    // the card render its answer box a beat after the text it answers.
    //
    // Failure here is not failure of the insight. An un-migrated database or a
    // missing table costs the answer box, not the note the trader came to read.
    let question: { kind: string; question: string } | null = null;
    try {
      const open = await getOpenQuestion(userId);
      if (open) question = { kind: open.kind, question: open.question };
    } catch (err) {
      logger.warn('open question lookup failed', {
        userId, error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({ insight: rows[0] ?? null, openQuestion: question });
  } catch (err) {
    logger.error('daily-insight GET failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
