// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coach/daily-insight/reaction
// Body: { id: string, reaction: 'helpful' | 'meh' | 'not_helpful' }
// Persists the trader's reaction to a specific insight row. The reaction is
// overwriteable — the trader is allowed to change their mind, and the DB
// helper's UPDATE is intentionally free of a "once set, never overwrite" guard.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { setInsightReaction } from '../../../../lib/coach-pipeline/db/insights';
import type { UserReaction } from '../../../../lib/coach-pipeline/types';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../lib/securityLog';
import { logger } from '../../../../lib/logger';

export const dynamic = 'force-dynamic';

const VALID_REACTIONS: readonly UserReaction[] = ['helpful', 'meh', 'not_helpful'];
function isReaction(v: unknown): v is UserReaction {
  return typeof v === 'string' && (VALID_REACTIONS as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/daily-insight/reaction POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`di:react:${userId}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Bad JSON body' }, { status: 400 }); }

  const b = body as { id?: unknown; reaction?: unknown };
  if (typeof b.id !== 'string' || !b.id.trim()) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  if (!isReaction(b.reaction)) {
    return NextResponse.json({ error: 'reaction must be helpful | meh | not_helpful' }, { status: 400 });
  }

  try {
    await setInsightReaction(userId, b.id, b.reaction);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('daily-insight reaction POST failed', {
      userId, id: b.id, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
