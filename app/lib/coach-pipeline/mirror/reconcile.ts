// ─────────────────────────────────────────────────────────────────────────────
// Reconciling the journal with the mirror.
//
// WHY THIS HAS TO EXIST
//
// Every write to intelligence_trades is best-effort by design. `mirrorTrades`
// catches its own errors and logs a warning, because the mirror must never
// take down the save that triggered it — a trader losing a trade because an
// analytics table was unavailable would be the worse failure by far.
//
// The consequence was never handled. A failed mirror leaves the journal
// correct and the analysis blind, with nothing that ever looks again. Found in
// production: ten trades written to journal_trades in one bulk sync, all
// stamped the same millisecond, none of which ever reached the mirror. Every
// pattern, every behaviour rate and every window since was computed over a
// journal missing a quarter of itself, and no screen anywhere could have shown
// that. The log line naming it expired an hour after it was written.
//
// Deletions had the same hole and were patched once, locally, in the journal
// route's `tombstoneTrades`. This is that repair generalised: not a fix for
// the call that failed, but a pass that assumes any call MAY have failed and
// compares the two tables on their own terms.
//
// WHAT IT DOES NOT DO
//
// It never deletes. A row in the mirror with no journal source behind it is
// reported and left alone — the journal is the source of truth for what the
// trader logged, but "I cannot find where this came from" is not the same
// claim as "this is not theirs", and acting on the difference would mean
// destroying data on the strength of a hash that failed to match.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient } from '../db/client';
import { T } from '../types';
import { rowToTrade, type TradeRow as JournalRow } from '../../journalRow';
import { deterministicUuid, mirrorTrades, mirrorTradeDeleted } from './journalToIntelligence';
import { logger } from '../../logger';

/** What one pass found and what it did about it. */
export interface ReconcileReport {
  /** Journal rows examined. */
  journalRows: number;
  /** Live in the journal, absent from the mirror. Re-mirrored. */
  missing: number;
  /** Deleted in the journal, still live in the mirror. Tombstoned. */
  ghosts: number;
  /** In the mirror with no journal row behind them. Reported only. */
  orphans: number;
  /** Ids of the orphans, so they can be looked at rather than guessed about. */
  orphanIds: string[];
  /** Set when the pass could not complete. Nothing is half-applied — the
   *  repairs that ran, ran; the rest is retried on the next pass. */
  error?: string;
}

export const EMPTY_REPORT: ReconcileReport = {
  journalRows: 0, missing: 0, ghosts: 0, orphans: 0, orphanIds: [],
};

/** The difference between the two tables, as a decision per row.
 *
 *  Pure, and separated from the reads and writes so the comparison itself can
 *  be tested without a database — which matters, because the comparison is
 *  where a mistake would either miss a broken row or "repair" a correct one. */
export function diff(
  journal: ReadonlyArray<{ id: number; deletedAt: string | null }>,
  mirrorIds: ReadonlyMap<string, { deletedAt: string | null }>,
  uuidOf: (legacyId: number) => string,
): { toMirror: number[]; toTombstone: number[]; orphanIds: string[] } {
  const toMirror: number[] = [];
  const toTombstone: number[] = [];
  const seen = new Set<string>();

  for (const row of journal) {
    const uid = uuidOf(row.id);
    seen.add(uid);
    const mirrored = mirrorIds.get(uid);

    if (row.deletedAt == null) {
      // Live in the journal. It belongs in the mirror, live — whether it is
      // missing outright or sitting there marked deleted. The second case is a
      // restore whose tombstone never lifted.
      if (!mirrored || mirrored.deletedAt != null) toMirror.push(row.id);
    } else if (mirrored && mirrored.deletedAt == null) {
      // Deleted in the journal and still counted by the analysis. The ghost.
      toTombstone.push(row.id);
    }
  }

  const orphanIds = [...mirrorIds.keys()].filter(id => !seen.has(id));
  return { toMirror, toTombstone, orphanIds };
}

/** Every trader with rows on EITHER side of the mirror.
 *
 *  The reconciler used to be handed the nightly run's eligible-user list,
 *  which is built from intelligence_trades — the very table it exists to
 *  repair. A trader whose trades never reached the mirror at all therefore had
 *  no rows there, was not on the list, and was never reconciled: the pass was
 *  blind to precisely the worst case it was written for.
 *
 *  Found on a live database. Ten journal rows belonged to a clerk_id with no
 *  presence in the mirror and no profile — an account somebody had deleted —
 *  and a reconciliation that ran cleanly reported nothing missing, because it
 *  never knew that trader existed.
 *
 *  So the list comes from both tables. A trader in one and not the other is
 *  the entire point of the exercise. */
export async function tradersToReconcile(): Promise<string[]> {
  const seen = new Set<string>();
  for (const table of ['journal_trades', T.trades] as const) {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await getClient()
        .from(table)
        .select('clerk_id')
        .order('clerk_id')
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ clerk_id: string | null }>;
      for (const r of rows) if (r.clerk_id) seen.add(r.clerk_id);
      if (rows.length < PAGE) break;
    }
  }
  return [...seen];
}

/** Page size for the journal read. Large enough that an ordinary journal is
 *  one round trip, small enough not to hold a whole history in memory at once
 *  when a heavy account eventually turns up. */
const PAGE = 1000;

async function loadJournalRows(clerkId: string): Promise<JournalRow[]> {
  const out: JournalRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await getClient()
      .from('journal_trades')
      .select('*')
      .eq('clerk_id', clerkId)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as JournalRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function loadMirrorIds(clerkId: string): Promise<Map<string, { deletedAt: string | null }>> {
  const out = new Map<string, { deletedAt: string | null }>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await getClient()
      .from(T.trades)
      .select('id, deleted_at')
      .eq('clerk_id', clerkId)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; deleted_at: string | null }>;
    for (const r of rows) out.set(r.id, { deletedAt: r.deleted_at });
    if (rows.length < PAGE) return out;
  }
}

/** One reconciliation pass for one trader. Never throws.
 *
 *  Idempotent by construction: both repairs are upserts keyed on the same
 *  deterministic id, so a pass that runs twice makes the same rows agree
 *  twice. A pass over an already-consistent journal writes nothing at all,
 *  which is what makes it safe to run every night. */
export async function reconcileTrades(clerkId: string): Promise<ReconcileReport> {
  if (!clerkId) return EMPTY_REPORT;
  try {
    const [journal, mirror] = await Promise.all([
      loadJournalRows(clerkId),
      loadMirrorIds(clerkId),
    ]);

    const byId = new Map(journal.map(r => [r.id, r]));
    const { toMirror, toTombstone, orphanIds } = diff(
      journal.map(r => ({ id: r.id, deletedAt: r.deleted_at })),
      mirror,
      legacyId => deterministicUuid(clerkId, legacyId),
    );

    if (toMirror.length) {
      // Through the same translation the save path uses. Re-deriving the row
      // here would be a second definition of what a mirrored trade is, and the
      // two would drift the first time a column was added.
      await mirrorTrades(clerkId, toMirror.map(id => rowToTrade(byId.get(id)!)));
    }
    for (const id of toTombstone) {
      await mirrorTradeDeleted(clerkId, id, true);
    }

    if (toMirror.length || toTombstone.length || orphanIds.length) {
      logger.warn('mirror reconcile repaired rows', {
        clerkId,
        missing: toMirror.length,
        ghosts: toTombstone.length,
        orphans: orphanIds.length,
      });
    }

    return {
      journalRows: journal.length,
      missing: toMirror.length,
      ghosts: toTombstone.length,
      orphans: orphanIds.length,
      orphanIds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('mirror reconcile failed', { clerkId, error: message });
    return { ...EMPTY_REPORT, error: message };
  }
}
