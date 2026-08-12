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
import { detectBehaviors, BEHAVIOR_LABELS } from '../../../lib/coach-pipeline/behavior/behaviors';
import { buildContexts } from '../../../lib/coach-pipeline/behavior/context';
import { buildFinding, pickPrimary } from '../../../lib/coach-pipeline/behavior/finding';
import { designExperiment } from '../../../lib/coach-pipeline/behavior/experiment';
import {
  CONFIRM_MIN_OCCURRENCES, CONFIRM_MIN_OPPORTUNITIES,
  INVESTIGATE_MIN_OCCURRENCES, INVESTIGATE_MIN_OPPORTUNITIES,
} from '../../../lib/coach-pipeline/behavior/evidence';
import { MIN_TOTAL_OCCURRENCES } from '../../../lib/coach-pipeline/behavior/contingency';
import type { TradeRow } from '../../../lib/coach-pipeline/types';
import { logger } from '../../../lib/logger';

const ROUTE = '/api/coach/behavior-preview';

export const maxDuration = 30;
export const dynamic     = 'force-dynamic';

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

/** What each detector needs in order to see a trade at all.
 *
 *  A trade missing the field isn't "clean" — it is invisible, which is a very
 *  different thing and the one most likely to be misread as good news. */
function readiness(trades: readonly TradeRow[]) {
  const decided = trades.filter(t => !t.deleted_at && DECIDED.has(t.result));
  const count = (p: (t: TradeRow) => boolean) => decided.filter(p).length;

  return {
    tradesTotal:   trades.length,
    tradesDecided: decided.length,
    detectors: {
      discretionary_exit: {
        needs:   'exit_price — נגזר מהיציאות שתיעדת',
        usable:  count(t => t.exit_price != null && t.take_profit != null),
        blind:   count(t => t.exit_price == null),
      },
      rule_violation: {
        needs:   'תיבת "עמדתי בחוקים" בטופס',
        usable:  count(t => t.followed_rules != null),
        blind:   count(t => t.followed_rules == null),
      },
      no_confirmation: {
        needs:   'שדה האישורים (זמין תמיד)',
        usable:  decided.length,
        blind:   0,
      },
      size_spike: {
        needs:   'contracts (זמין תמיד) — צריך 5 עסקאות קודמות לבסיס',
        usable:  Math.max(0, decided.length - 5),
        blind:   Math.min(5, decided.length),
      },
    },
  };
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
    const trades   = await listRecentTrades(userId, 500);
    const contexts = buildContexts(trades);
    const tallies  = detectBehaviors(trades);

    // Average R per trade, for prioritising by cost. Only present on trades
    // whose R was measured rather than assumed.
    const rByTradeId = new Map<string, number | null>(
      trades.map(t => [t.id, t.r_multiple]),
    );

    const findings = tallies.map(t => buildFinding(t, contexts, { rByTradeId }));
    const { primary, watching } = pickPrimary(findings);

    return NextResponse.json({
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cost: 'none — pure computation, no model call',

      readiness: readiness(trades),

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
            experiment: primary.status === 'confirmed'
              ? designExperiment(primary.kind, primary.rate, primary.trigger)
              : null,
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
