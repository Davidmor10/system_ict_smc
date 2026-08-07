// ─────────────────────────────────────────────────────────────────────────────
// Format retrieved chunks into the <past_writing> block that Claude reads.
// Pure — no I/O.
//
// The prompt in Step 4 declares this exact structure:
//   <past_writing>
//   [
//     { "date": "YYYY-MM-DD", "snippet": "...", "kind": "journal|plan|note" }
//   ]
//   </past_writing>
//
// We emit JSON (not markdown) because Claude reads it as data and won't
// accidentally quote back the formatting. An empty array is a valid,
// informative answer — the system prompt tells Claude to IGNORE past_writing
// when it's empty.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChunkHit, NotebookEntryRow } from '../types';

/** One item as Claude will see it inside past_writing. */
export interface PastWritingItem {
  date:    string;   // 'YYYY-MM-DD' — the entry's created_at date
  snippet: string;   // chunk content, unmodified
  kind:    NotebookEntryRow['kind'];
  score:   number;   // cosine similarity (0-1), 2 decimals — audit help
}

/** Enrich hits with the entry-level metadata (date, kind) that the chunk
 *  row doesn't carry. Caller passes in a map from entry_id → entry so this
 *  stays pure and testable. */
export function buildPastWritingItems(
  hits: readonly ChunkHit[],
  entriesById: ReadonlyMap<string, Pick<NotebookEntryRow, 'created_at' | 'kind'>>,
): PastWritingItem[] {
  return hits
    .map(h => {
      const entry = entriesById.get(h.entry_id);
      return {
        date:    entry ? entry.created_at.slice(0, 10) : '',
        snippet: h.content.trim(),
        kind:    entry?.kind ?? ('note' as const),
        score:   Math.round(h.score * 100) / 100,
      };
    })
    .filter(item => item.snippet.length > 0);
}

/** Serialize the block exactly as the prompt's DATA CONTRACT expects. Pretty-
 *  printed with 2-space indent so it stays readable if we ever inspect a
 *  daily_insights.context_snapshot row by hand. */
export function formatPastWritingBlock(items: readonly PastWritingItem[]): string {
  return JSON.stringify(items, null, 2);
}
