// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/usage-summary — owner-only AI cost dashboard.
//
// Answers "how much did the AI cost me this month?" without opening Supabase.
// Reads ai_usage_log (the ledger every provider call writes to) and rolls it
// up three ways: today, this month, and a per-purpose / per-model breakdown.
//
// Owner-gated because it exposes account-wide spend across every user.
// ─────────────────────────────────────────────────────────────────────────────

import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { T } from '../../../lib/coach-pipeline/types';
import { logger } from '../../../lib/logger';

const OWNER_EMAILS = ['davidmor030908@gmail.com', 'davidmor030909@gmail.com'];

export const dynamic = 'force-dynamic';

interface UsageRow {
  provider:          string;
  model:             string;
  purpose:           string;
  tokens_in:         number;
  tokens_out:        number;
  cost_usd_estimate: number;
  ok:                boolean;
  created_at:        string;
  clerk_id:          string | null;
}

/** Roll a set of rows into a {calls, tokensIn, tokensOut, costUsd} summary. */
function roll(rows: UsageRow[]) {
  return rows.reduce(
    (acc, r) => ({
      calls:     acc.calls + 1,
      failed:    acc.failed + (r.ok ? 0 : 1),
      tokensIn:  acc.tokensIn + Number(r.tokens_in ?? 0),
      tokensOut: acc.tokensOut + Number(r.tokens_out ?? 0),
      costUsd:   acc.costUsd + Number(r.cost_usd_estimate ?? 0),
    }),
    { calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  );
}

/** Group rows by a key selector, then roll each group. */
function groupRoll(rows: UsageRow[], key: (r: UsageRow) => string) {
  const groups = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const k = key(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .map(([k, list]) => [k, roll(list)] as const)
      .sort(([, a], [, b]) => b.costUsd - a.costUsd),
  );
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user  = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email || !OWNER_EMAILS.includes(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const now        = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const dayStart   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

    const { data, error } = await getClient()
      .from(T.aiUsageLog)
      .select('provider, model, purpose, tokens_in, tokens_out, cost_usd_estimate, ok, created_at, clerk_id')
      .gte('created_at', monthStart)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const monthRows = (data ?? []) as UsageRow[];
    const todayRows = monthRows.filter(r => r.created_at >= dayStart);

    const month = roll(monthRows);
    const today = roll(todayRows);

    // Simple linear projection: (spend so far / days elapsed) × days in month.
    const dayOfMonth  = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projected   = dayOfMonth > 0 ? (month.costUsd / dayOfMonth) * daysInMonth : 0;

    return NextResponse.json({
      generatedAt: now.toISOString(),
      month: {
        since:            monthStart,
        calls:            month.calls,
        failedCalls:      month.failed,
        tokensIn:         month.tokensIn,
        tokensOut:        month.tokensOut,
        costUsd:          round4(month.costUsd),
        projectedMonthUsd: round4(projected),
      },
      today: {
        since:   dayStart,
        calls:   today.calls,
        costUsd: round4(today.costUsd),
      },
      byPurpose:  groupRoll(monthRows, r => r.purpose),
      byModel:    groupRoll(monthRows, r => `${r.provider}/${r.model}`),
      topUsers:   Object.fromEntries(
        Object.entries(groupRoll(monthRows, r => r.clerk_id ?? 'system')).slice(0, 10),
      ),
    });
  } catch (err) {
    logger.error('usage-summary GET failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
