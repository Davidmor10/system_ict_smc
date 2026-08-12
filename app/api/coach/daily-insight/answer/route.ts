// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coach/daily-insight/answer
// Body: { kind: BehaviorKind, answer: string }
//
// The trader answering the coach's question. Small route, and the most
// important write in the behaviour layer.
//
// Everything else the system knows was computed from the trade history, which
// means every finding rests on a single source. The confidence model treats
// that as a hard ceiling: findings drawn from trade telemetry alone cannot
// reach `high`, however clean the numbers look, because five signals from one
// dataset are one signal counted five times.
//
// This is the other source. It is the only thing a trader can say that the
// system could not have worked out on its own, and it is what lets a finding
// cross from "these trades cluster here" to something worth acting on.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { recordAnswer } from '../../../../lib/coach-pipeline/db/behaviorFindings';
import { BEHAVIOR_LABELS, type BehaviorKind } from '../../../../lib/coach-pipeline/behavior/behaviors';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../lib/securityLog';
import { logger } from '../../../../lib/logger';

export const dynamic = 'force-dynamic';

/** Answers are prose, and prose has no upper bound a user will respect. The
 *  DB helper truncates as well; this rejects rather than silently storing a
 *  fragment of what someone thought they had written. */
const MAX_ANSWER = 2000;

function isKind(v: unknown): v is BehaviorKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BEHAVIOR_LABELS, v);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/daily-insight/answer POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`di:answer:${userId}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Bad JSON body' }, { status: 400 }); }

  const b = body as { kind?: unknown; answer?: unknown };
  if (!isKind(b.kind)) {
    return NextResponse.json({ error: 'unknown behaviour kind' }, { status: 400 });
  }
  if (typeof b.answer !== 'string' || !b.answer.trim()) {
    return NextResponse.json({ error: 'answer required' }, { status: 400 });
  }
  if (b.answer.length > MAX_ANSWER) {
    return NextResponse.json({ error: 'answer too long' }, { status: 400 });
  }

  try {
    // recordAnswer is clerk_id-scoped, so a forged kind can only ever reach
    // the caller's own row — and if they have no finding of that kind, it
    // writes nothing and says so.
    const written = await recordAnswer(userId, b.kind, b.answer);
    if (!written) {
      return NextResponse.json({ error: 'no open finding for that behaviour' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('answer POST failed', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
