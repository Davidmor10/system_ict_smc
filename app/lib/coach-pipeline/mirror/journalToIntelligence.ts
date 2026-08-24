// ─────────────────────────────────────────────────────────────────────────────
// Mirror writer — every write path on /api/journal (POST / PUT / DELETE /
// PATCH) also calls into here so intelligence_trades stays in sync with the
// legacy journal_trades table. This is what turns the coach pipeline from
// "infrastructure that runs on nothing" into a live system that actually has
// data to reason about tonight.
//
// Guarantees:
//   - Deterministic uuid per (clerk_id, legacy id) → upserts are idempotent
//     (same trade written twice = same row).
//   - Never throws. A failure here MUST NOT take down the /api/journal call
//     the user is waiting on. Failures are logged and swallowed.
//   - No secondary AI calls, no cron enqueue. Only a plain Supabase upsert.
//
// If we later decide to drop the legacy table, this file is the one that
// becomes redundant — everything downstream already speaks intelligence_trades.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { TradeEntry } from '../../journal';
import { calcRR, calcWeightedExitPrice } from '../../calc/trade';
import { T } from '../types';
import { getClient } from '../db/client';
import { logger } from '../../logger';

/** SHA1 of `intelligence_trades:${clerkId}:${legacyId}` formatted as a UUID.
 *  Not a real UUIDv5, but Postgres' uuid column accepts any 32-hex-char
 *  string in the canonical 8-4-4-4-12 layout, and we get determinism cheaply.
 *  Same input → same UUID forever, so a re-save updates the mirror row. */
export function deterministicUuid(clerkId: string, legacyId: number): string {
  const raw = createHash('sha1')
    .update(`intelligence_trades:${clerkId}:${legacyId}`, 'utf8')
    .digest('hex');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

/** Contract-weighted average of the real exits, or null when none were
 *  logged. The null is load-bearing: it is how the behaviour layer tells a
 *  measured trade from an assumed one. */
function weightedExitPrice(trade: TradeEntry): number | null {
  const exits = trade.exits ?? [];
  if (!exits.length) return null;
  return calcWeightedExitPrice(exits);
}

/** Translate a legacy TradeEntry into an intelligence_trades row. */
export function tradeEntryToIntelligenceRow(clerkId: string, trade: TradeEntry, deleted = false) {
  return {
    clerk_id:        clerkId,
    id:              deterministicUuid(clerkId, trade.id),
    date:            trade.dateISO,
    time:            trade.time || null,
    symbol:          trade.symbol,
    direction:       trade.direction,
    contracts:       trade.contracts ?? 1,
    entry_price:     trade.entry,
    stop_loss:       trade.stop,
    take_profit:     trade.target ?? null,
    // The plan and the outcome, kept apart on purpose.
    //
    // rr_planned is the reward-to-risk the trade was TAKEN for; r_multiple is
    // what it actually returned. Both were null/derived before, which made the
    // two indistinguishable — and a system that cannot tell the plan from the
    // outcome cannot detect a deviation from the plan, which is the entire
    // point of the behaviour layer.
    //
    // exit_price is the contract-weighted average of the real exits. It is
    // null when the trader logged no exits, and that null is meaningful: it
    // marks a trade whose R is assumed rather than measured, so a detector can
    // refuse to draw conclusions from it.
    exit_price:      weightedExitPrice(trade),
    exits:           trade.exits ?? null,
    rr_planned:      calcRR(trade.entry, trade.stop, trade.target),
    r_multiple:      trade.tradeR ?? null,
    pnl_usd:         trade.pnlUsd ?? null,
    result:          trade.result,
    session:         trade.session || null,
    bias:            trade.bias || null,
    setup:           trade.setup ?? null,
    confirmations:   trade.confirmations ?? null,
    emotional_state: trade.emotionalState ?? null,
    // null when the trader didn't grade the trade. Never `true` by default:
    // this used to be hardcoded, which meant every trade claimed perfect rule
    // adherence and the violation detector could not fire even once.
    followed_rules:  typeof trade.followedRules === 'boolean' ? trade.followedRules : null,
    stop_moved:      trade.stopMoved ?? null,
    // Why the stop sat where it did, in the trader's words. Mirrored because
    // the daily note reads this table, and a stop level without the reasoning
    // behind it is a number the coach can only restate.
    stop_note:       trade.stopNote ?? null,
    management:      trade.management ?? null,
    notes:           trade.notes ?? '',
    tags:            [],
    screenshots:     trade.screenshots ?? null,
    deleted_at:      deleted ? new Date().toISOString() : null,
    updated_at:      new Date().toISOString(),
  };
}

/** Upsert one or many TradeEntry rows into intelligence_trades. Idempotent
 *  by the deterministic UUID. Never throws. */
export async function mirrorTrades(
  clerkId: string,
  trades: readonly TradeEntry[],
): Promise<void> {
  if (!clerkId || !trades.length) return;
  try {
    const rows = trades.map(t => tradeEntryToIntelligenceRow(clerkId, t));
    const { error } = await getClient()
      .from(T.trades)
      // Conflict-target names the tenant. `id` is derived from a hash of the
      // source row, so targeting it alone would let a hash collision across
      // two users resolve to "update the other user's row". With
      // (clerk_id, id) the unique index enforces the isolation instead of the
      // hash being trusted to. Requires intelligence_trades_clerk_id_key —
      // see supabase-migration-intelligence-patch-2.sql §3.
      .upsert(rows, { onConflict: 'clerk_id,id' });
    if (error) {
      logger.warn('mirror upsert to intelligence_trades failed', {
        clerkId, count: rows.length, error: error.message,
      });
    }
  } catch (err) {
    // Defensive — the whole point of the mirror is that it can't take down the
    // main call. A thrown exception here would defeat that.
    logger.warn('mirror upsert threw', {
      clerkId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Mark the intelligence_trades mirror row for a legacy trade id as
 *  deleted / undeleted. `deleted=true` sets deleted_at=now(); false clears it.
 *  Never throws. */
export async function mirrorTradeDeleted(
  clerkId: string,
  legacyId: number,
  deleted: boolean,
): Promise<void> {
  if (!clerkId || !Number.isSafeInteger(legacyId)) return;
  try {
    const uuid = deterministicUuid(clerkId, legacyId);
    const { error } = await getClient()
      .from(T.trades)
      .update({
        deleted_at: deleted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('clerk_id', clerkId)
      .eq('id', uuid);
    if (error) {
      logger.warn('mirror delete/restore failed', {
        clerkId, legacyId, deleted, error: error.message,
      });
    }
  } catch (err) {
    logger.warn('mirror delete/restore threw', {
      clerkId, legacyId, error: err instanceof Error ? err.message : String(err),
    });
  }
}
