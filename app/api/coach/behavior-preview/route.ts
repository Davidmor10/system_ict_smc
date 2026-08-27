// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/behavior-preview — run the behaviour layer against real
// trades and show every intermediate value.
//
// Owner-only, and free: steps 1–3 are pure functions over rows already in the
// database. No model is called, no token is spent, nothing is written.
//
// It exists because the alternative is shipping the analysis into a prompt and
// judging it by the sentence that comes out the other end. That tells you
// almost nothing — a good sentence over bad evidence reads exactly like a good
// sentence over good evidence. This shows the evidence.
//
// Three sections, in the order they answer questions:
//
//   readiness  — can the data support this at all, and what is missing
//   behaviours — every finding with its thresholds, confidence and statements
//   primary    — the one thing that would be worked on today, if any
//
// `readiness` is the section that matters most right now. Every detector has
// a field it cannot work without, and a trade logged without that field is
// invisible to it. This turns "the feature says nothing" into a specific list
// of what to start recording.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { assertOwner, safeEqual, cronSecret } from '../../../lib/coach-pipeline/auth/guards';
import { listRecentTrades } from '../../../lib/coach-pipeline/db/trades';
import { BEHAVIOR_LABELS } from '../../../lib/coach-pipeline/behavior/behaviors';
import { runBehaviorLayer } from '../../../lib/coach-pipeline/behavior/run';
import {
  CONFIRM_MIN_OCCURRENCES, CONFIRM_MIN_OPPORTUNITIES,
  INVESTIGATE_MIN_OCCURRENCES, INVESTIGATE_MIN_OPPORTUNITIES,
} from '../../../lib/coach-pipeline/behavior/evidence';
import { MIN_TOTAL_OCCURRENCES } from '../../../lib/coach-pipeline/behavior/contingency';
import { computeGuardrails } from '../../../lib/coach-pipeline/behavior/guardrails';
// One implementation of "what can the coach see", shared with the panel the
// trader reads. Two copies of it would drift, and the version that drifted
// would be the one nobody was looking at.
import { computeReadiness } from '../../../lib/coach-pipeline/behavior/readiness';
import type { StoredFinding } from '../../../lib/coach-pipeline/behavior/memory';
import { loadFindings } from '../../../lib/coach-pipeline/db/behaviorFindings';
import { analyzeBehavior } from '../../../lib/coach-pipeline/pipelines/analyzeBehavior';
import { ROLLING_WINDOW } from '../../../lib/coach-pipeline/behavior/finding';
import type { BehaviorKind } from '../../../lib/coach-pipeline/behavior/behaviors';
import type { TradeRow } from '../../../lib/coach-pipeline/types';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

const ROUTE = '/api/coach/behavior-preview';

export const maxDuration = 30;
export const dynamic     = 'force-dynamic';

/** The raw fields the detectors read, one line per trade.
 *
 *  Aggregates say "0 usable" without saying which link broke. The chain is
 *  form → localStorage → PUT /api/journal → journal_trades → mirror →
 *  intelligence_trades, and a null at the end is consistent with a bug in any
 *  of them. This shows what actually landed, so the next question is which
 *  trade rather than which layer. */
function perTrade(trades: readonly TradeRow[]) {
  return trades.map(t => ({
    date:          t.date,
    time:          t.time,
    symbol:        t.symbol,
    result:        t.result,
    take_profit:   t.take_profit,
    exit_price:    t.exit_price,
    exitLegs:      Array.isArray(t.exits) ? t.exits.length : 0,
    r_multiple:    t.r_multiple,
    followed_rules: t.followed_rules,
    confirmations: Array.isArray(t.confirmations) ? t.confirmations.length : 0,
    updated_at:    t.updated_at,
  }));
}

/** How far a finding is from its next lifecycle step, in trades.
 *
 *  Silence is the honest answer for a thin history, but silence with no end in
 *  sight is indistinguishable from a broken feature. A number turns the wait
 *  into a target. */
function nextMilestone(occurrences: number, opportunities: number, status: string) {
  if (status === 'detected') {
    return {
      toReach: 'investigating',
      needMoreOccurrences:   Math.max(0, INVESTIGATE_MIN_OCCURRENCES - occurrences),
      needMoreOpportunities: Math.max(0, INVESTIGATE_MIN_OPPORTUNITIES - opportunities),
    };
  }
  if (status === 'investigating') {
    return {
      toReach: 'confirmed',
      needMoreOccurrences:   Math.max(0, CONFIRM_MIN_OCCURRENCES - occurrences),
      needMoreOpportunities: Math.max(0, CONFIRM_MIN_OPPORTUNITIES - opportunities),
    };
  }
  return { toReach: status, needMoreOccurrences: 0, needMoreOpportunities: 0 };
}

/** Same two doors as run-now: a Clerk session, or the cron secret with an
 *  explicit clerk_id. Read-only and free, but it still exposes one user's
 *  trade history, so it is gated exactly as tightly. */
function authorize(req: NextRequest): { userId: string } | NextResponse | 'session' {
  const key = req.nextUrl.searchParams.get('key')?.trim();
  if (!key) return 'session';

  const secret = cronSecret();
  if (!secret)               return NextResponse.json({ error: 'Unauthorized', reason: 'CRON_SECRET is not set' }, { status: 401 });
  if (!safeEqual(key, secret)) return NextResponse.json({ error: 'Unauthorized', reason: 'key does not match CRON_SECRET' }, { status: 401 });

  const clerkId = req.nextUrl.searchParams.get('clerk_id');
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized', reason: 'key accepted, but clerk_id is missing' }, { status: 401 });
  return { userId: clerkId };
}

export async function GET(req: NextRequest) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/coach/behavior-preview');
  if (denied) return denied;

  const viaKey = authorize(req);
  let userId: string;
  if (viaKey === 'session') {
    const gate = await assertOwner(ROUTE);
    if (gate instanceof NextResponse) return gate;
    userId = gate.userId;
  } else if (viaKey instanceof NextResponse) {
    return viaKey;
  } else {
    userId = viaKey.userId;
  }

  const started = Date.now();
  try {
    const trades = await listRecentTrades(userId, 500);

    // What the last run concluded. Missing table (the migration hasn't been
    // run yet) is reported rather than thrown: the whole point of this route
    // is to answer "what is missing", so it must survive its own answer.
    let stored = new Map<BehaviorKind, StoredFinding>();
    let memoryAvailable = true;
    let memoryError: string | null = null;
    try {
      stored = await loadFindings(userId);
    } catch (err) {
      memoryAvailable = false;
      memoryError = err instanceof Error ? err.message : String(err);
    }

    // The decision itself — the same pure function the nightly run calls, so
    // this route cannot describe a run that differs from the one that will
    // happen. It used to repeat the sequence here, and the copy drifted: it
    // went on ranking by severity after the run started rotating by when each
    // behaviour was last measured, and it kept deriving the experiment window
    // from a date after the run started slicing by position.
    const now = new Date().toISOString();
    const { findings, primary, watching, decisions } =
      runBehaviorLayer({ trades, stored, now });

    const previousPrimary = [...stored.values()].find(s => s.isPrimary)?.kind;
    const guardrailsTrailing = computeGuardrails([...trades].reverse().slice(-ROLLING_WINDOW));

    // What memory WOULD record tonight. Nothing is written here; the nightly
    // run owns the write. Reading the transition before it happens is the
    // only way to catch a lifecycle that moves for the wrong reason.
    const wouldRecord = decisions.map(({ finding, prior, record, transition, measured }) => ({
      kind: finding.kind,
      knownSince:  prior?.firstDetectedAt ?? null,
      statusNow:   prior?.status ?? null,
      statusAfter: record.status,
      transition,
      relapses:    record.relapses,
      experiment:  record.experiment,
      measured,
      openQuestion: record.question,
      answered:     record.traderAnswer != null,
    }));

    return NextResponse.json({
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cost: 'none — pure computation, no model call',

      readiness: computeReadiness(trades),
      perTrade:  perTrade(trades),

      // Exactly what the model receives tonight — same function the nightly
      // run calls, with the write turned off. Everything above explains how it
      // was derived; this is the thing itself, and it is the only part the
      // trader will ever indirectly read.
      promptBlock: (await analyzeBehavior(userId, { persist: false })).block,

      memory: {
        available: memoryAvailable,
        error:     memoryError,
        storedFindings: stored.size,
        previousPrimary: previousPrimary ?? null,
        guardrailsTrailing,
        wouldRecord,
      },

      thresholds: {
        detectTrigger:   MIN_TOTAL_OCCURRENCES,
        investigating:   { occurrences: INVESTIGATE_MIN_OCCURRENCES, opportunities: INVESTIGATE_MIN_OPPORTUNITIES },
        confirmed:       { occurrences: CONFIRM_MIN_OCCURRENCES,     opportunities: CONFIRM_MIN_OPPORTUNITIES },
      },

      behaviours: findings.map(f => ({
        kind:          f.kind,
        label:         f.label,
        status:        f.status,
        occurrences:   f.occurrences,
        opportunities: f.opportunities,
        rate:          f.rate,
        baselines:     f.baselines,
        confidence:    f.confidence,
        limitedBy:     f.assessment.limitedBy,
        factors:       f.assessment.factors,
        trigger:       f.trigger,
        statements:    f.statements.map(s => ({ tier: s.tier, text: s.text, trades: s.tradeIds.length })),
        question:      f.question,
        priorityScore: f.priorityScore,
        costPerOccurrenceR: f.costPerOccurrenceR,
        nextMilestone: nextMilestone(f.occurrences, f.opportunities, f.status),
      })),

      primary: primary
        ? {
            kind:       primary.kind,
            label:      primary.label,
            status:     primary.status,
            wouldSay:   primary.statements.map(s => s.text),
            wouldAsk:   primary.question,
            // The experiment as memory would record it, not a fresh
            // design: a window only opens for a primary that is confirmed,
            // has a counter-example and has been seen on a previous run, and
            // recomputing it here answered a different question.
            experiment: decisions.find(d => d.finding.kind === primary.kind)?.record.experiment ?? null,
          }
        : null,
      watching: watching.map(f => f.kind),

      // Absent behaviours are as informative as present ones: a kind missing
      // from `behaviours` had no opportunities at all, which is a data
      // problem rather than a clean record.
      notDetectable: Object.keys(BEHAVIOR_LABELS).filter(
        k => !findings.some(f => f.kind === k),
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('behavior-preview failed', { userId, error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
