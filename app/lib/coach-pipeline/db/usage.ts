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
    // eslint-disable-next-line no-console
    console.warn('coach-pipeline: ai_usage_log insert failed', error.message);
  }
}

/** Sum this user's AI cost since a given start of month (UTC). Used before
    every Claude call to decide whether to fall back to Gemini. */
export async function sumUserMonthlyCost(
  clerkId: string,
  monthStart: Date,
): Promise<number> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.aiUsageLog)
    .select('cost_usd_estimate')
    .eq('clerk_id', cid)
    .gte('created_at', monthStart.toISOString());
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number(r.cost_usd_estimate ?? 0), 0);
}

/** Sum total system cost since a given timestamp — usually "today at 00:00
    Israel time". Feeds the daily budget alarm. */
export async function sumSystemCostSince(sinceIso: string): Promise<number> {
  const { data, error } = await getClient()
    .from(T.aiUsageLog)
    .select('cost_usd_estimate')
    .gte('created_at', sinceIso);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number(r.cost_usd_estimate ?? 0), 0);
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
