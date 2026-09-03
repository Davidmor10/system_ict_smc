// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/evolution — how the trader's edge hypothesis changed, week by
// week.
//
// IT LIVES UNDER /api/ai AND NOT /api/coach, AND THAT IS THE POINT.
//
// docs/ai-architecture.md splits the two stacks by the claims they own:
// lib/intelligence describes where a trader's results concentrate, and
// lib/coach-pipeline describes what the trader does and whether it changes.
// This is the first stack. It was briefly rendered on the journey page — a
// behaviour screen — which is exactly the cross-stack blend the document
// exists to prevent: an edge hypothesis and a habit are different subjects,
// and a page that mixes them teaches the trader they are the same thing.
//
// Read-only. Built from the hypothesis snapshot each weekly report already
// stores, so it costs one query and no model call.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getEvolutionTimeline } from '../../../lib/intelligence/service';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requirePlanApi('pro', '/api/ai/evolution');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/evolution' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:evolution:${userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    return NextResponse.json({ evolution: await getEvolutionTimeline(userId) });
  } catch (err) {
    logger.error('evolution timeline failed', { userId, error: err instanceof Error ? err.message : String(err) });
    // An empty axis, not a 500: this is one section of a long page.
    return NextResponse.json({ evolution: [] });
  }
}
