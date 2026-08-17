// ─────────────────────────────────────────────────────────────────────────────
// ai_usage_log — every AI call gets one row, always. Zero exceptions.
// Also: helpers to read monthly per-user cost (drives the fallback trigger)
// and daily system-wide cost (drives the budget alarm).
// ─────────────────────────────────────────────────────────────────────────────

import { T, type AiUsageRow, type Provider } from '../types';
import { getClient, requireClerkId } from './client';

export interface UsageInsert {
  clerkId:      string | null;         // null = system-level (no owning user)
  provider:     Provider;
  model:        string;
  purpose:      string;
  tokensIn:     number;
  tokensOut:    number;
  costUsdEst:   number;
  latencyMs?:   number;
  ok:           boolean;
  errorKind?:   string;
}

/** Write one usage row. Never blocks the caller — a logging failure MUST NOT
    take down the AI call it was accounting for. Errors are logged but
    swallowed. */
export async function logUsage(input: UsageInsert): Promise<void> {
  const row = {
    clerk_id:          input.clerkId,
    provider:          input.provider,
    model:             input.model,
    purpose:           input.purpose,
    tokens_in:         Math.max(0, Math.round(input.tokensIn)),
    tokens_out:        Math.max(0, Math.round(input.tokensOut)),
    cost_usd_estimate: input.costUsdEst,
    latency_ms:        input.latencyMs ?? null,
    ok:                input.ok,
    error_kind:        input.errorKind ?? null,
  };
  const { error } = await getClient().from(T.aiUsageLog).insert(row);
  if (error) {
    console.warn('coach-pipeline: ai_usage_log insert failed', error.message);
  }
}

/** One row per distinct (model, purpose, error_kind) among recent failures. */
export interface FailureGroup {
  model:     string;
  purpose:   string;
  errorKind: string;
  calls:     number;
  lastAt:    string;
}

/** Why the failed calls failed.
 *
 *  The rollup answers "how many failed" and stops there, which is exactly one
 *  question short of useful: a fallback chain that slides down to the weakest
 *  model every night looks identical to a healthy one until you know whether
 *  the failures are timeouts, an exhausted quota, or a retired model still
 *  being called. Three failures a month is a footnote; three timeouts a month
 *  means the timeout is mis-sized, and those are not the same finding.
 *
 *  A plain SELECT is safe here where it is not for the cost sums: this reads
 *  only `ok = false` rows and caps at `limit`, so it cannot silently truncate
 *  the way an un-capped page would. Grouping happens here because the set is
 *  tiny by construction — if it ever isn't, that is itself the alarm. */
export async function recentFailures(since: string, limit = 200): Promise<FailureGroup[]> {
  const { data, error } = await getClient()
    .from(T.aiUsageLog)
    .select('model, purpose, error_kind, created_at')
    .eq('ok', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  const groups = new Map<string, FailureGroup>();
  for (const r of data as Array<{ model: string; purpose: string; error_kind: string | null; created_at: string }>) {
    const errorKind = r.error_kind ?? 'unknown';
    const key = `${r.model}|${r.purpose}|${errorKind}`;
    const seen = groups.get(key);
    // Rows arrive newest-first, so the first one seen for a key is the latest.
    if (seen) seen.calls += 1;
    else groups.set(key, { model: r.model, purpose: r.purpose, errorKind, calls: 1, lastAt: r.created_at });
  }
  return [...groups.values()].sort((a, b) => b.calls - a.calls);
}

// ── Cost reads ──────────────────────────────────────────────────────────────
//
// Both sums go through Postgres RPCs (see supabase-migration-intelligence-
// patch-2.sql §1), NOT through a select-then-reduce.
//
// PostgREST caps a plain SELECT at 1000 rows by default and returns the
// truncated page without an error. The previous implementation summed that
// page client-side, so once the ledger passed 1000 rows in a window, every
// total silently under-reported — and a budget cap that under-reports is a
// budget cap that never trips. Aggregate where the rows are.

/** Sum this user's AI cost since a given start of month (UTC). Used before
    every Claude call to decide whether to fall back to Gemini. */
export async function sumUserMonthlyCost(
  clerkId: string,
  monthStart: Date,
): Promise<number> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient().rpc('sum_ai_cost_user', {
    p_clerk_id: cid,
    p_since:    monthStart.toISOString(),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Sum total system cost since a given timestamp — usually "today at 00:00
    Israel time". Feeds the daily budget alarm. */
export async function sumSystemCostSince(sinceIso: string): Promise<number> {
  const { data, error } = await getClient().rpc('sum_ai_cost_system', {
    p_since: sinceIso,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Chunks this user has embedded since `sinceIso`. tokens_in on a note_embed
    row carries the chunk count, not tokens — see embedEntry.ts. */
export async function sumEmbedChunksSince(
  clerkId: string,
  sinceIso: string,
): Promise<number> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient().rpc('sum_embed_chunks_user', {
    p_clerk_id: cid,
    p_since:    sinceIso,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Most-recent usage rows (any user) for the admin panel. */
export async function listRecentUsage(limit = 50): Promise<AiUsageRow[]> {
  const { data, error } = await getClient()
    .from(T.aiUsageLog)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw error;
  return (data ?? []) as AiUsageRow[];
}
