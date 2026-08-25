// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/tracking — what is currently being counted, and how far in.
//
// The behaviour layer has been designing experiments, storing them, opening
// windows and judging the results since it shipped. Nothing ever displayed
// one. The whole apparatus ran in the dark: a trader could be nine trades into
// a measurement and have no way to know it, which makes the measurement
// worthless — the only thing that changes behaviour is being able to see the
// count move.
//
// This route is the window into it. Read-only, cheap, and honest about
// nothing: an account with no tracked behaviour gets `{ active: null }` and
// the surface renders nothing at all, rather than an encouraging placeholder.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { analyzeBehavior } from '../../../lib/coach-pipeline/pipelines/analyzeBehavior';
import { listRecentTrades } from '../../../lib/coach-pipeline/db/trades';
import { detectBehaviors, BEHAVIOR_LABELS, type BehaviorKind } from '../../../lib/coach-pipeline/behavior/behaviors';
import { loadFindings } from '../../../lib/coach-pipeline/db/behaviorFindings';
import type { StoredFinding } from '../../../lib/coach-pipeline/behavior/memory';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';

export interface TrackingActive {
  kind: BehaviorKind;
  label: string;
  /** The sentence the trader reads. A measurement, never an instruction. */
  what: string;
  /** Opportunities seen since the window opened, and the window length. */
  done: number;
  of: number;
  startedAt: string;
}

export interface TrackingPast {
  kind: BehaviorKind;
  label: string;
  verdict: string;
  /** Rate before and after, as whole percentages. */
  before: number;
  after: number;
  /** Named guardrails that got worse while the target improved. */
  broken: string[];
}

export async function GET() {
  const denied = await requirePlanApi('starter', '/api/coach/tracking');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/tracking' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:tracking:${userId}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    // persist:false — reading the dashboard must never advance the trader's
    // behavioural state. The nightly run is the only thing allowed to write.
    const [{ block }, stored, trades] = await Promise.all([
      analyzeBehavior(userId, { persist: false }),
      loadFindings(userId).catch(() => new Map<BehaviorKind, StoredFinding>()),
      listRecentTrades(userId, 200).catch(() => []),
    ]);

    let active: TrackingActive | null = null;
    const running = [...stored.values()].find(f => f.experiment && f.experimentStartedAt && !f.experimentResult);
    if (running?.experiment && running.experimentStartedAt) {
      // Opportunities since the window opened — the count the trader watches.
      // Recomputed from the trades rather than stored, so it cannot drift out
      // of step with the journal it describes.
      const since = running.experimentStartedAt.slice(0, 10);
      const inWindow = trades.filter(t => !t.deleted_at && t.date >= since);
      const tally = detectBehaviors(inWindow).find(t => t.kind === running.kind);
      active = {
        kind: running.kind,
        label: BEHAVIOR_LABELS[running.kind],
        what: running.experiment.instruction,
        done: Math.min(tally?.opportunities ?? 0, running.experiment.windowTrades),
        of: running.experiment.windowTrades,
        startedAt: running.experimentStartedAt,
      };
    }

    const past: TrackingPast[] = [...stored.values()]
      .filter(f => f.experimentResult)
      .map(f => ({
        kind: f.kind,
        label: BEHAVIOR_LABELS[f.kind],
        verdict: f.experimentResult!.verdict,
        before: Math.round(f.experimentResult!.targetBefore * 100),
        after: Math.round(f.experimentResult!.targetAfter * 100),
        broken: f.experimentResult!.broken.map(String),
      }));

    return NextResponse.json({
      active,
      past,
      // Nothing is being tracked and nothing ever was — the surface uses this
      // to decide between silence and an explanation of why it is silent.
      insufficientEvidence: block.insufficientEvidence,
    });
  } catch (err) {
    logger.error('coach tracking failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
