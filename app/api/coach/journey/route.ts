// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/journey — the trader's history, behaviour by behaviour.
//
// Three questions, in the order a person asks them: what am I working on, what
// have I already changed, and what is still being watched.
//
// EVERY FIELD HERE WAS ALREADY BEING COMPUTED AND SHOWN TO NOBODY.
//
//   • the lifecycle events — `listFindingEvents` had no caller at all;
//   • the evolution timeline — carried a comment in its own source saying it
//     was not wired into any UI;
//   • `past` on the tracking route — served for months, and the one component
//     reading that route used only `active` and dropped it.
//
// So this is not a new analysis. It is a window onto work the system was
// already doing in the dark.
//
// WHAT IT DOES NOT SERVE is the learning score. It is still computed and
// stored nightly; it does not travel to a browser until it can say WHICH
// habit moved, rather than only that a number did.
//
// READ-ONLY, AND THAT IS LOAD-BEARING. Opening a page must never advance the
// trader's behavioural state or spend a model call: `analyzeBehavior` is
// called with persist:false. The nightly run is the only thing allowed to
// write.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { analyzeBehavior } from '../../../lib/coach-pipeline/pipelines/analyzeBehavior';
import { BEHAVIOR_LABELS, type BehaviorKind } from '../../../lib/coach-pipeline/behavior/behaviors';
import { listFindingEvents, loadFindings } from '../../../lib/coach-pipeline/db/behaviorFindings';
import { windowProgress, type StoredFinding } from '../../../lib/coach-pipeline/behavior/memory';
import { getEvolutionTimeline } from '../../../lib/intelligence/service';
import { countJourney, stageOf } from '../../../lib/progress/journey';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** How far back the lifecycle log goes. Enough to cover a few months of a
 *  behaviour moving through the process, short enough to stay one payload. */
const EVENT_LIMIT = 40;

export async function GET() {
  const denied = await requirePlanApi('pro', '/api/coach/journey');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/journey' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:journey:${userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    // Each of the four is independently allowed to fail. A missing evolution
    // timeline must not blank the experiment the trader is ten trades into —
    // the parts of this screen are not a transaction.
    const [behavior, stored, events, evolution] = await Promise.all([
      analyzeBehavior(userId, { persist: false }).catch(() => null),
      loadFindings(userId).catch(() => new Map<BehaviorKind, StoredFinding>()),
      listFindingEvents(userId, EVENT_LIMIT).catch(() => [] as unknown[]),
      getEvolutionTimeline(userId).catch(() => []),
    ]);

    const findings = [...stored.values()];
    const snapshot = behavior?.snapshot ?? [];

    // ── what I am working on ─────────────────────────────────────────────
    const running = findings.find(f => f.experiment && f.experimentStartedAt && !f.experimentResult);
    let active = null;
    if (running?.experiment && running.experimentStartedAt) {
      // The SAME subtraction the verdict makes, from the same detection pass.
      // A progress bar that disagrees with the thing it is a progress bar for
      // is worse than no progress bar.
      const fresh = snapshot.find(s => s.kind === running.kind);
      const progress = fresh ? windowProgress(running, fresh.opportunities) : null;
      active = {
        kind: running.kind,
        label: BEHAVIOR_LABELS[running.kind],
        status: running.status,
        what: running.experiment.instruction,
        done: progress?.done ?? 0,
        of: progress?.of ?? running.experiment.windowTrades,
        startedAt: running.experimentStartedAt,
      };
    }

    // ── what I already changed ───────────────────────────────────────────
    // Only behaviours with a judged experiment. A status of 'improved'
    // without a result behind it is a claim with nothing to open.
    const changed = findings
      .filter(f => f.experimentResult)
      .map(f => ({
        kind: f.kind,
        label: BEHAVIOR_LABELS[f.kind],
        status: f.status,
        verdict: f.experimentResult!.verdict,
        before: Math.round(f.experimentResult!.targetBefore * 100),
        after: Math.round(f.experimentResult!.targetAfter * 100),
        // Both baselines, because agreeing is the whole test — and a trader
        // who can see only one cannot tell a changed habit from a good month.
        historicalImproved: f.experimentResult!.historicalImproved,
        rollingImproved: f.experimentResult!.rollingImproved,
        broken: f.experimentResult!.broken.map(String),
        relapses: f.relapses,
        at: f.statusSince,
      }))
      .sort((a, b) => b.at.localeCompare(a.at));

    // ── what is being watched ────────────────────────────────────────────
    const watching = findings
      .filter(f => stageOf(f.status) === 'watching' && f.status !== 'archived')
      .map(f => ({
        kind: f.kind,
        label: BEHAVIOR_LABELS[f.kind],
        status: f.status,
        occurrences: f.occurrences,
        opportunities: f.opportunities,
        rate: f.rate,
        isPrimary: f.isPrimary,
        firstDetectedAt: f.firstDetectedAt,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.rate - a.rate);

    // The learning score is NOT served. It is still computed and stored every
    // night; it does not travel to a browser until it can name what moved.
    // See lib/progress/journey.ts for the reasoning.
    return NextResponse.json({
      counts: countJourney(findings),
      active,
      changed,
      watching,
      evolution,
      events: (events as Array<{ kind: string; at: string; from_status: string | null; to_status: string; reason: string }>)
        .map(e => ({
          kind: e.kind,
          label: BEHAVIOR_LABELS[e.kind as BehaviorKind] ?? e.kind,
          at: e.at,
          from: e.from_status,
          to: e.to_status,
          reason: e.reason,
        })),
      // Nothing has ever been detected. The surface uses this to explain the
      // silence rather than render an empty frame, which reads as a verdict.
      insufficientEvidence: behavior?.block.insufficientEvidence ?? true,
    });
  } catch (err) {
    logger.error('coach journey failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
