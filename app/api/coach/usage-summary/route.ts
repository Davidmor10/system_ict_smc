// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/usage-summary — owner-only AI cost dashboard.
//
// Answers "how much did the AI cost me this month?" without opening Supabase.
// Reads ai_usage_log (the ledger every provider call writes to) and rolls it
// up three ways: today, this month, and a per-purpose / per-model breakdown.
//
// The rollup happens in Postgres (ai_usage_rollup), not here. Reading the raw
// rows and grouping them in JavaScript worked until the ledger passed 1000
// rows — PostgREST's default page cap — at which point the dashboard would
// have quietly shown a fraction of the real spend, which is the one number
// this endpoint exists to get right.
//
// Owner-gated because it exposes account-wide spend across every user.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { assertOwner } from '../../../lib/coach-pipeline/auth/guards';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { recentFailures } from '../../../lib/coach-pipeline/db/usage';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

const ROUTE = '/api/coach/usage-summary';

export const dynamic = 'force-dynamic';

interface RollupRow {
  bucket:     'total' | 'today' | 'purpose' | 'model' | 'user';
  key:        string;
  calls:      number;
  failed:     number;
  tokens_in:  number;
  tokens_out: number;
  cost_usd:   number;
}

interface Group {
  calls: number; failed: number; tokensIn: number; tokensOut: number; costUsd: number;
}

const EMPTY: Group = { calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };

function toGroup(r: RollupRow | undefined): Group {
  if (!r) return EMPTY;
  return {
    calls:     Number(r.calls ?? 0),
    failed:    Number(r.failed ?? 0),
    tokensIn:  Number(r.tokens_in ?? 0),
    tokensOut: Number(r.tokens_out ?? 0),
    costUsd:   Number(r.cost_usd ?? 0),
  };
}

/** Rows of one bucket → an object keyed by `key`, most expensive first. */
function bucketMap(rows: RollupRow[], bucket: RollupRow['bucket'], limit?: number) {
  const entries = rows
    .filter(r => r.bucket === bucket)
    .map(r => [r.key, toGroup(r)] as const)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd);
  return Object.fromEntries(limit ? entries.slice(0, limit) : entries);
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function GET() {
  // Every plan is paid. A signed-in account without a subscription is
  // refused here as well as in the UI, so the route cannot be called
  // directly to work around the gate.
  const denied = await requirePlanApi('starter', '/api/coach/usage-summary');
  if (denied) return denied;

  const gate = await assertOwner(ROUTE);
  if (gate instanceof NextResponse) return gate;

  try {
    const now        = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const dayStart   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

    // The rollup counts failures; this says what they were. Read alongside it
    // because "3 failed" and "3 timed out on the same model" are different
    // findings, and only the second one tells you what to change.
    const [{ data, error }, failures] = await Promise.all([
      getClient().rpc('ai_usage_rollup', { p_since: monthStart, p_day_start: dayStart }),
      recentFailures(monthStart),
    ]);
    if (error) throw error;

    const rows  = (data ?? []) as RollupRow[];
    const month = toGroup(rows.find(r => r.bucket === 'total'));
    const today = toGroup(rows.find(r => r.bucket === 'today'));

    // Simple linear projection: (spend so far / days elapsed) × days in month.
    const dayOfMonth  = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projected   = dayOfMonth > 0 ? (month.costUsd / dayOfMonth) * daysInMonth : 0;

    return NextResponse.json({
      generatedAt: now.toISOString(),
      month: {
        since:             monthStart,
        calls:             month.calls,
        failedCalls:       month.failed,
        tokensIn:          month.tokensIn,
        tokensOut:         month.tokensOut,
        costUsd:           round4(month.costUsd),
        projectedMonthUsd: round4(projected),
      },
      today: {
        since:   dayStart,
        calls:   today.calls,
        costUsd: round4(today.costUsd),
      },
      byPurpose: bucketMap(rows, 'purpose'),
      byModel:   bucketMap(rows, 'model'),
      failures,
      topUsers:  bucketMap(rows, 'user', 10),
    });
  } catch (err) {
    logger.error('usage-summary GET failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
