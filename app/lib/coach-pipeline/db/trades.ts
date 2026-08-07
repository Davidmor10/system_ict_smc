// ─────────────────────────────────────────────────────────────────────────────
// intelligence_trades access. Every function is clerk_id-scoped by
// construction — no query in this file can escape the current user's rows.
// ─────────────────────────────────────────────────────────────────────────────

import { T, type TradeRow } from '../types';
import { getClient, requireClerkId } from './client';

/** Return this user's trades whose profile-processing watermark isn't set.
    Used by the profile-refresh worker: reads at most `limit` rows (default
    50, the design cap for a single delta pass) so a heavy backfill can't
    blow up one Gemini call. Newest first — the profile cares more about
    recent behavior. Soft-deleted rows are excluded. */
export async function listUnprocessedTrades(
  clerkId: string,
  opts: { limit?: number } = {},
): Promise<TradeRow[]> {
  const cid   = requireClerkId(clerkId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { data, error } = await getClient()
    .from(T.trades)
    .select('*')
    .eq('clerk_id', cid)
    .is('profile_processed_at', null)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as TradeRow[];
}

/** Count trades this user has logged since a given ISO timestamp. Used by the
    session-insight trigger ("has this trader closed 3+ new trades since the
    last insight?"). Fast — index-only on (clerk_id, created_at). */
export async function countTradesSince(
  clerkId: string,
  sinceIso: string,
): Promise<number> {
  const cid = requireClerkId(clerkId);
  const { count, error } = await getClient()
    .from(T.trades)
    .select('id', { count: 'exact', head: true })
    .eq('clerk_id', cid)
    .is('deleted_at', null)
    .gt('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/** All of this user's trades for a specific Israel date. Feeds the "today"
    block of the daily insight prompt. */
export async function listTradesForDate(
  clerkId: string,
  dateIso: string,   // 'YYYY-MM-DD'
): Promise<TradeRow[]> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.trades)
    .select('*')
    .eq('clerk_id', cid)
    .eq('date', dateIso)
    .is('deleted_at', null)
    .order('time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as TradeRow[];
}

/** Stamp a batch of trades as included in the current profile refresh.
    Idempotent: setting `profile_processed_at` twice is a no-op. Called at
    the end of a successful refresh — never before, so a failed refresh
    leaves the rows unmarked and the next run will re-pick them. */
export async function markTradesProcessed(
  clerkId: string,
  tradeIds: string[],
  processedRev: number,
  processedAt: Date = new Date(),
): Promise<void> {
  if (!tradeIds.length) return;
  const cid = requireClerkId(clerkId);
  const { error } = await getClient()
    .from(T.trades)
    .update({
      profile_processed_at:  processedAt.toISOString(),
      profile_processed_rev: processedRev,
    })
    .eq('clerk_id', cid)
    .in('id', tradeIds);
  if (error) throw error;
}
