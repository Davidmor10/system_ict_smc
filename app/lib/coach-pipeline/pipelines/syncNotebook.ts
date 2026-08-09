// ─────────────────────────────────────────────────────────────────────────────
// syncNotebook — the bridge between the notebook the trader writes in and the
// index the coach searches.
//
// Called from /api/collections on every notebook save. Two steps:
//   1. Mirror the client blob into notebook_entries (plain DB write, cheap).
//   2. Get the changed entries embedded, so retrieval can find them.
//
// Step 2 is split deliberately. A handful of entries are embedded inline —
// one batched call, a few hundred milliseconds — so a trader who writes a
// note and asks for an insight a minute later actually gets it back. Anything
// beyond that (a first sync carrying a year of writing, a bulk paste) is
// queued for the worker instead of making someone wait on a spinner while we
// index their archive.
//
// Never throws. The user is waiting on their save; an indexing failure must
// cost them nothing but a delay in retrieval.
// ─────────────────────────────────────────────────────────────────────────────

import {
  mirrorNotebookEntries,
  type ClientNotebookEntry,
  type MirrorNotebookResult,
} from '../mirror/notebookToIntelligence';
import { embedEntry } from './embedEntry';
import { enqueueJob } from '../db/jobs';
import { logger } from '../../logger';

/** How many entries to embed before the user's request returns. Sized by
 *  latency, not cost: embedding is effectively free, but each entry is its own
 *  round-trip and a save is a foreground action. Four keeps the added latency
 *  under roughly a second in the ordinary edit-one-note case, which is what
 *  almost every save is. */
export const INLINE_EMBED_LIMIT = 4;

export interface SyncNotebookResult {
  mirrored:      number;
  softDeleted:   number;
  embedded:      number;
  queued:        number;
  failed:        number;
  error?:        string;
}

export async function syncNotebook(
  clerkId: string,
  entries: readonly ClientNotebookEntry[],
): Promise<SyncNotebookResult> {
  let mirror: MirrorNotebookResult;
  try {
    mirror = await mirrorNotebookEntries(clerkId, entries);
  } catch (err) {
    // mirrorNotebookEntries already swallows its own errors; this is the
    // belt for a programmer error inside it.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('syncNotebook: mirror threw', { clerkId, error: msg });
    return { mirrored: 0, softDeleted: 0, embedded: 0, queued: 0, failed: 0, error: msg };
  }

  if (mirror.error) {
    return { mirrored: 0, softDeleted: 0, embedded: 0, queued: 0, failed: 0, error: mirror.error };
  }

  const toEmbedNow  = mirror.needsEmbedding.slice(0, INLINE_EMBED_LIMIT);
  const toEmbedLater = mirror.needsEmbedding.slice(INLINE_EMBED_LIMIT);

  let embedded = 0;
  let failed   = 0;
  for (const entryId of toEmbedNow) {
    try {
      const out = await embedEntry(clerkId, entryId);
      if (out.status === 'ok' || out.status === 'unchanged' || out.status === 'empty') embedded += 1;
      else {
        failed += 1;
        logger.warn('syncNotebook: embed did not complete', { clerkId, entryId, status: out.status });
      }
    } catch (err) {
      failed += 1;
      logger.warn('syncNotebook: embed threw', {
        clerkId, entryId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The overflow goes to the queue. target_date stays null on purpose: the
  // per-day unique index only applies to dated jobs, and two bulk pastes on
  // the same day are two genuinely different pieces of work, not a duplicate.
  let queued = 0;
  if (toEmbedLater.length) {
    try {
      const row = await enqueueJob({
        clerkId,
        jobType:       'note_embed',
        inputEntryIds: toEmbedLater,
      });
      if (row) queued = toEmbedLater.length;
    } catch (err) {
      logger.warn('syncNotebook: enqueue failed', {
        clerkId, count: toEmbedLater.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { mirrored: mirror.mirrored, softDeleted: mirror.softDeleted, embedded, queued, failed };
}
