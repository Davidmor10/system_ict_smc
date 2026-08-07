// ─────────────────────────────────────────────────────────────────────────────
// daily_insights — the actual output the dashboard renders. One row per
// (clerk_id, date, kind). Insert uses ON CONFLICT DO NOTHING as a defense
// against the impossible-but-still-guarded case of two workers racing on the
// same day.
// ─────────────────────────────────────────────────────────────────────────────

import {
  T,
  type DailyInsightRow,
  type InsightKind,
  type FallbackReason,
  type UserReaction,
} from '../types';
import { getClient, requireClerkId } from './client';

// ── Insert ──────────────────────────────────────────────────────────────────

export interface InsightInsert {
  clerkId:            string;
  date:               string;              // 'YYYY-MM-DD'
  kind:               InsightKind;
  contentMd:          string;
  contentHash:        string;              // sha256 hex of contentMd
  model:              string;
  promptVersion:      number;
  fallbackUsed:       boolean;
  fallbackReason?:    FallbackReason;
  tokensIn:           number;
  tokensOut:          number;
  costUsdEst:         number;
  latencyMs?:         number;
  retrievalChunkIds:  string[];
  retrievalTopScore?: number;
  contextSnapshot:    Record<string, unknown>;
}

/** Insert one insight, race-safe. Returns the row if inserted, or null if
    the (clerk_id, date, kind) already existed — the caller should treat null
    as "someone else already wrote this, skip". */
export async function insertInsight(
  input: InsightInsert,
): Promise<DailyInsightRow | null> {
  const cid = requireClerkId(input.clerkId);
  const row = {
    clerk_id:            cid,
    date:                input.date,
    kind:                input.kind,
    content_md:          input.contentMd,
    content_hash:        input.contentHash,
    model:               input.model,
    prompt_version:      input.promptVersion,
    fallback_used:       input.fallbackUsed,
    fallback_reason:     input.fallbackReason ?? null,
    tokens_in:           Math.max(1, Math.round(input.tokensIn)),   // DB CHECK: > 0
    tokens_out:          Math.max(1, Math.round(input.tokensOut)),
    cost_usd_estimate:   input.costUsdEst,
    latency_ms:          input.latencyMs ?? null,
    retrieval_chunk_ids: input.retrievalChunkIds,
    retrieval_top_score: input.retrievalTopScore ?? null,
    context_snapshot:    input.contextSnapshot,
  };
  const { data, error } = await getClient()
    .from(T.dailyInsights)
    .insert(row)
    .select('*')
    .maybeSingle();
  if (error && error.code === '23505') return null;   // unique_violation
  if (error) throw error;
  return (data as DailyInsightRow | null) ?? null;
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Get the insight for today (or a specific past day). Returns null when
    nothing was generated yet — the dashboard renders a skeleton state. */
export async function getInsightForDate(
  clerkId: string,
  dateIso: string,
  kind: InsightKind = 'daily',
): Promise<DailyInsightRow | null> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.dailyInsights)
    .select('*')
    .eq('clerk_id', cid)
    .eq('date', dateIso)
    .eq('kind', kind)
    .maybeSingle();
  if (error) throw error;
  return (data as DailyInsightRow | null) ?? null;
}

/** Recent insights for a user, newest first. Feeds a "history" view. */
export async function listRecentInsights(
  clerkId: string,
  limit = 30,
): Promise<DailyInsightRow[]> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.dailyInsights)
    .select('*')
    .eq('clerk_id', cid)
    .order('date', { ascending: false })
    .order('generated_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;
  return (data ?? []) as DailyInsightRow[];
}

// ── User signals (read receipts, reactions) ─────────────────────────────────

/** Stamp read_at the first time a user opens an insight. Idempotent — once
    set, never overwritten (we care about *first* view, not last). */
export async function markInsightRead(clerkId: string, insightId: string): Promise<void> {
  const cid = requireClerkId(clerkId);
  const { error } = await getClient()
    .from(T.dailyInsights)
    .update({ read_at: new Date().toISOString() })
    .eq('clerk_id', cid)
    .eq('id', insightId)
    .is('read_at', null);
  if (error) throw error;
}

/** Record the user's thumbs / meh reaction. Overwrites any prior reaction —
    the trader is allowed to change their mind. */
export async function setInsightReaction(
  clerkId: string,
  insightId: string,
  reaction: UserReaction,
): Promise<void> {
  const cid = requireClerkId(clerkId);
  const { error } = await getClient()
    .from(T.dailyInsights)
    .update({ user_reaction: reaction, reaction_at: new Date().toISOString() })
    .eq('clerk_id', cid)
    .eq('id', insightId);
  if (error) throw error;
}
