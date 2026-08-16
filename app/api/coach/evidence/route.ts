// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/evidence?kind=discretionary_exit
//
// The trades behind a claim. Every one of them, with the numbers that put it
// on the list and the numbers that kept it off.
//
// WHY THIS IS THE MOST IMPORTANT ROUTE IN THE COACH
//
// The system will eventually be wrong about something. It will say a trader
// keeps exiting early, and three of those trades will have been managed
// exactly as planned. What happens next depends entirely on whether the trader
// can open the claim.
//
// If they can, they find the three, they tell us, and the analysis gets better
// — that is the feedback loop working. If they cannot, the claim is an oracle:
// believable or not, never correctable, and the moment it is wrong once the
// whole product is discounted.
//
// So the quality bar here is not how confident the coach sounds. It is how
// cheaply the trader can check whether it is right.
//
// Recomputed rather than stored: the detectors are pure functions over rows
// that are already in the database, so the evidence is always the CURRENT
// evidence. A trade corrected this morning drops off the list this morning,
// instead of a snapshot outliving the facts it came from.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { listRecentTrades } from '../../../lib/coach-pipeline/db/trades';
import {
  detectBehaviors, occurrenceTradeIds, BEHAVIOR_LABELS, type BehaviorKind,
} from '../../../lib/coach-pipeline/behavior/behaviors';
import { verifyTrade } from '../../../lib/trade/verification';
import type { ManagementEvent } from '../../../lib/trade/management';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

export const dynamic = 'force-dynamic';

function isKind(v: string | null): v is BehaviorKind {
  return v !== null && Object.prototype.hasOwnProperty.call(BEHAVIOR_LABELS, v);
}

export async function GET(req: NextRequest) {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/coach/evidence');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/coach/evidence GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`coach:evidence:${userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  const kind = req.nextUrl.searchParams.get('kind');
  if (!isKind(kind)) {
    return NextResponse.json({ error: 'unknown behaviour kind' }, { status: 400 });
  }

  try {
    const trades = await listRecentTrades(userId, 500);
    const tally  = detectBehaviors(trades).find(t => t.kind === kind);
    if (!tally) {
      return NextResponse.json({
        kind, label: BEHAVIOR_LABELS[kind],
        occurrences: 0, opportunities: 0, trades: [],
      });
    }

    const occurred = occurrenceTradeIds(tally);
    const byId = new Map(trades.map(t => [t.id, t]));
    const evidenceById = new Map(tally.events.map(e => [e.tradeId, e.evidence]));

    // BOTH sides, in the order they happened. A list of only the trades that
    // counted is a prosecution; the ones that didn't are what make the rate
    // mean something, and they are also where a wrong classification is
    // easiest for the trader to spot.
    const rows = tally.opportunityTradeIds.map(id => {
      const t = byId.get(id);
      if (!t) return null;
      return {
        id:          t.id,
        date:        t.date,
        time:        t.time,
        symbol:      t.symbol,
        direction:   t.direction,
        contracts:   t.contracts,
        entry:       t.entry_price,
        stop:        t.stop_loss,
        target:      t.take_profit,
        exit:        t.exit_price,
        result:      t.result,
        rMultiple:   t.r_multiple,
        session:     t.session,
        setup:       t.setup,
        followedRules: t.followed_rules,
        stopMoved:   t.stop_moved,
        counted:     occurred.has(id),
        /** The numbers the detector actually used. This is what makes the
         *  claim checkable rather than assertable. */
        evidence:    evidenceById.get(id) ?? null,
        /** Which of this trade's self-reported claims the records can check,
         *  and whether they agree. A disagreement is a prompt to look, never
         *  a verdict — see lib/trade/verification. */
        checks: verifyTrade({
          direction:  t.direction === 'SHORT' ? 'SHORT' : 'LONG',
          entry:      t.entry_price,
          stop:       t.stop_loss,
          target:     t.take_profit,
          contracts:  t.contracts,
          result:     t.result,
          exits:      t.exits,
          stopMoved:  (t.stop_moved as 'none' | 'advanced' | 'widened' | null) ?? null,
          management: (t.management ?? null) as ManagementEvent[] | null,
        }).filter(c => c.status !== 'unverifiable'),
      };
    }).filter(Boolean);

    return NextResponse.json({
      kind,
      label:         BEHAVIOR_LABELS[kind],
      occurrences:   tally.occurrences,
      opportunities: tally.opportunities,
      rate:          tally.rate,
      trades:        rows,
    });
  } catch (err) {
    logger.error('evidence GET failed', {
      userId, kind, error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
