// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/journey — the trader's history, behaviour by behaviour.
//
// ONE ROW PER BEHAVIOUR, and every kind gets one whether or not it ever fired.
// The detector taxonomy is a closed set of five, so grouping them into stage
// buckets scattered each behaviour's history and made the ones that never
// fired vanish — and a kind the system looked at and did not find is the only
// thing that tells a trader what is actually being watched.
//
// The trader's own rules arrive as rows of the same shape and are marked as
// theirs. They carry no lifecycle stage: the stages mean confirmed on a sample
// that could have said no, and an experiment with guardrails, and none of that
// has run on a self-reported breach.
//
// EVERY FIELD HERE WAS ALREADY BEING COMPUTED AND SHOWN TO NOBODY.
//
//   • the lifecycle events — `listFindingEvents` had no caller at all;
//   • `past` on the tracking route — served for months, and the one component
//     reading that route used only `active` and dropped it;
//   • the rules the trader wrote and ticked as broken — collected for weeks
//     into `user_collections`, read only to rank a sentence for the daily
//     note, and never shown as a record of anything.
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
import { loadRuleBreaches } from '../../../lib/coach-pipeline/db/collections';
import { countJourney } from '../../../lib/progress/journey';
import { sortRows, stageFor, trendOf, type JourneyRow } from '../../../lib/progress/rows';
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
    // Each source is independently allowed to fail. A rules collection that
    // cannot be read must not blank the experiment the trader is ten trades
    // into — the parts of this screen are not a transaction.
    const [behavior, stored, events, ruleData] = await Promise.all([
      analyzeBehavior(userId, { persist: false }).catch(() => null),
      loadFindings(userId).catch(() => new Map<BehaviorKind, StoredFinding>()),
      listFindingEvents(userId, EVENT_LIMIT).catch(() => [] as unknown[]),
      loadRuleBreaches(userId).catch(() => ({ rules: new Map<string, string>(), breaches: [] })),
    ]);

    const findings = [...stored.values()];
    const snapshot = behavior?.snapshot ?? [];

    const log = (events as Array<{ kind: string; at: string; to_status: string; reason: string }>);
    const eventsFor = (kind: string) => log
      .filter(e => e.kind === kind)
      .map(e => ({ at: e.at, to: e.to_status, reason: e.reason }));

    // ── the five detectors, every one of them ────────────────────────────
    const builtin: JourneyRow[] = (Object.keys(BEHAVIOR_LABELS) as BehaviorKind[]).map(kind => {
      const f = stored.get(kind) ?? null;
      // The fresh pass knows the denominator even for a kind that has never
      // been stored — which is what makes "looked at 24 opportunities, not
      // found" sayable instead of a blank row.
      const fresh = snapshot.find(s => s.kind === kind) ?? null;

      const running = f?.experiment && f.experimentStartedAt && !f.experimentResult ? f : null;
      const progress = running && fresh ? windowProgress(running, fresh.opportunities) : null;

      const opportunities = f?.opportunities ?? fresh?.opportunities ?? 0;
      const occurrences = f?.occurrences ?? fresh?.occurrences ?? 0;

      return {
        kind,
        label: BEHAVIOR_LABELS[kind],
        source: 'builtin' as const,
        status: f?.status ?? null,
        stage: stageFor(f?.status ?? null),
        occurrences,
        opportunities,
        rate: opportunities > 0 ? occurrences / opportunities : null,
        trend: trendOf(f?.baselines.historicalRate, f?.baselines.rollingRate, f?.baselines.rollingN),
        historicalRate: f?.baselines.historicalRate ?? null,
        rollingRate: f?.baselines.rollingRate ?? null,
        isPrimary: f?.isPrimary ?? false,
        relapses: f?.relapses ?? 0,
        window: running?.experiment
          ? {
              what: running.experiment.instruction,
              done: progress?.done ?? 0,
              of: progress?.of ?? running.experiment.windowTrades,
            }
          : null,
        result: f?.experimentResult
          ? {
              verdict: f.experimentResult.verdict,
              before: Math.round(f.experimentResult.targetBefore * 100),
              after: Math.round(f.experimentResult.targetAfter * 100),
              // Both baselines: agreeing is the whole test, and a reader shown
              // only one cannot tell a changed habit from a good month.
              historicalImproved: f.experimentResult.historicalImproved,
              rollingImproved: f.experimentResult.rollingImproved,
              broken: f.experimentResult.broken.map(String),
            }
          : null,
        firstDetectedAt: f?.firstDetectedAt ?? null,
        lastSeenAt: f?.lastSeenAt ?? null,
        events: eventsFor(kind),
      };
    });

    // ── and the problems the trader named themselves ─────────────────────
    //
    // The denominator is the same one the rule detector uses: trades the
    // trader actually graded. Every rule shares it, because the question on
    // the form is asked once per trade and covers all of them. Counting
    // breaches against ALL trades instead would quietly divide by ungraded
    // ones and make every rate flattering.
    const gradedTrades = stored.get('rule_violation')?.opportunities
      ?? snapshot.find(s => s.kind === 'rule_violation')?.opportunities
      ?? 0;

    const perRule = new Map<string, { count: number; last: string }>();
    for (const b of ruleData.breaches) {
      const prev = perRule.get(b.ruleId);
      perRule.set(b.ruleId, {
        count: (prev?.count ?? 0) + 1,
        last: prev && prev.last > b.date ? prev.last : b.date,
      });
    }

    const ruleRows: JourneyRow[] = [...perRule.entries()]
      // A breach whose rule was deleted is a database key, not a finding.
      .filter(([id]) => ruleData.rules.has(id))
      .map(([id, agg]) => ({
        kind: `rule:${id}`,
        label: ruleData.rules.get(id)!,
        source: 'rule' as const,
        // No stage. Nothing here was confirmed against a counter-example and
        // no experiment has run on it — borrowing the vocabulary without the
        // evidence would be the same lie as a neutral score.
        status: null,
        stage: 'undetected' as const,
        occurrences: agg.count,
        opportunities: gradedTrades,
        rate: gradedTrades > 0 ? agg.count / gradedTrades : null,
        trend: 'unknown' as const,
        historicalRate: null,
        rollingRate: null,
        isPrimary: false,
        relapses: 0,
        window: null,
        result: null,
        firstDetectedAt: null,
        lastSeenAt: agg.last,
        events: [],
      }))
      .sort((a, b) => b.occurrences - a.occurrences);

    return NextResponse.json({
      counts: countJourney(findings),
      rows: sortRows([...builtin, ...ruleRows]),
      // True when the trader has written rules but never ticked one, so the
      // surface can tell "no rules yet" apart from "rules kept".
      hasRules: ruleData.rules.size > 0,
      gradedTrades,
      // Nothing has ever been detected. The surface uses this to explain the
      // silence rather than render an empty frame, which reads as a verdict.
      insufficientEvidence: behavior?.block.insufficientEvidence ?? true,
    });
  } catch (err) {
    logger.error('coach journey failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
