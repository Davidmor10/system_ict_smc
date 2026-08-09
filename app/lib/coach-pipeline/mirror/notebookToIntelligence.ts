// ─────────────────────────────────────────────────────────────────────────────
// Mirror writer — notebook entries → notebook_entries.
//
// The notebook lives client-side and syncs through the generic
// /api/collections KV endpoint as one blob under `notebook_entries_v1`. The
// coach pipeline, meanwhile, reads a real `notebook_entries` table: chunked,
// embedded, searchable. Nothing connected the two, so the RAG index had no
// source and the coach never saw a line the trader wrote.
//
// Same contract as the trades mirror:
//   - Deterministic uuid per (clerk_id, client entry id) → upserts are
//     idempotent, and a re-save updates the same row rather than duplicating.
//   - Never throws. A failure here MUST NOT fail the save the user is
//     waiting on. Losing an embedding is recoverable; losing their writing
//     is not.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { T, type NotebookEntryRow } from '../types';
import { getClient } from '../db/client';
import { logger } from '../../logger';

/** The three notebook kinds the schema allows. Client folder ids map onto
 *  them; anything unrecognized (including user-created folders) is a note. */
export type NotebookKind = 'journal' | 'plan' | 'note';

function kindForFolder(folderId: string): NotebookKind {
  if (folderId === 'daily') return 'journal';
  if (folderId === 'plan')  return 'plan';
  return 'note';
}

/** SHA1 of `notebook_entries:${clerkId}:${entryId}` in canonical UUID layout.
 *  Same derivation as the trades mirror — determinism without a lookup, and
 *  because clerk_id is inside the hash, two users cannot derive the same id
 *  without a SHA1 prefix collision. */
export function deterministicEntryUuid(clerkId: string, entryId: string): string {
  const raw = createHash('sha1')
    .update(`notebook_entries:${clerkId}:${entryId}`, 'utf8')
    .digest('hex');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

/** HTML → plain text, for embedding and for what the model reads.
 *
 *  The editor stores bodyHtml. Feeding tags to an embedding model buries the
 *  signal under markup that is identical across every entry, and feeding them
 *  to Claude wastes the token budget the whole design exists to protect.
 *  Block-level tags become newlines so paragraph structure — which the
 *  chunker splits on — survives the conversion. */
export function htmlToText(html: string): string {
  return html
    // A closing block tag is a PARAGRAPH break, and the chunker splits on
    // \n{2,} — emitting a single newline here would silently merge every
    // paragraph of an entry into one chunk, which is the opposite of what
    // chunking is for. <br> is a line break inside a paragraph, so it stays
    // single. <li> keeps its own single newline so a list reads as a list.
    .replace(/<\/(p|div|h[1-6]|blockquote)\s*>/gi, '\n\n')
    .replace(/<(br|\/li)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** The client-side shape, narrowed to what the mirror reads. Declared here
 *  rather than imported so this server module doesn't pull in the notebook
 *  store's client dependencies. */
export interface ClientNotebookEntry {
  id:        string;
  folderId:  string;
  title?:    string;
  bodyHtml?: string;
  tags?:     string[];
  createdAt?: number;
  updatedAt?: number;
  deleted?:  boolean;
}

export interface MirrorNotebookResult {
  mirrored:      number;
  softDeleted:   number;
  /** Entry uuids whose text changed since their last embedding — the set the
   *  caller should embed. Empty when nothing needs re-indexing. */
  needsEmbedding: string[];
  error?:        string;
}

const EMPTY: MirrorNotebookResult = { mirrored: 0, softDeleted: 0, needsEmbedding: [] };

/** Upsert the user's notebook into notebook_entries and report which entries
 *  now need (re)embedding. Never throws. */
export async function mirrorNotebookEntries(
  clerkId: string,
  entries: readonly ClientNotebookEntry[],
): Promise<MirrorNotebookResult> {
  if (!clerkId || !Array.isArray(entries) || entries.length === 0) return EMPTY;

  try {
    const client = getClient();
    const now    = new Date().toISOString();

    const rows = entries.map(e => {
      const body = htmlToText(e.bodyHtml ?? '');
      return {
        clerk_id:   clerkId,
        id:         deterministicEntryUuid(clerkId, e.id),
        kind:       kindForFolder(e.folderId),
        title:      (e.title ?? '').slice(0, 500),
        body,
        body_hash:  sha256Hex(body),
        tags:       Array.isArray(e.tags) ? e.tags.slice(0, 20) : [],
        created_at: e.createdAt ? new Date(e.createdAt).toISOString() : now,
        updated_at: e.updatedAt ? new Date(e.updatedAt).toISOString() : now,
        deleted_at: e.deleted ? now : null,
      };
    });

    // An empty entry has nothing to embed and nothing to say. Keeping them out
    // of the table means "how many entries does this user have" stays a
    // meaningful number.
    const live = rows.filter(r => !r.deleted_at && r.body.length > 0);
    const gone = rows.filter(r =>  r.deleted_at || r.body.length === 0);

    // Which of the live rows already carry a matching embedding? Reading first
    // costs one query and saves an embedding call per unchanged entry on every
    // single save — and the notebook syncs its whole blob on every keystroke
    // batch, so unchanged is the overwhelmingly common case.
    const ids = live.map(r => r.id);
    const embeddedHashes = new Map<string, string | null>();
    if (ids.length) {
      const { data } = await client
        .from(T.notebookEntries)
        .select('id, embedded_body_hash')
        .eq('clerk_id', clerkId)
        .in('id', ids);
      for (const row of (data ?? []) as Array<{ id: string; embedded_body_hash: string | null }>) {
        embeddedHashes.set(row.id, row.embedded_body_hash);
      }
    }

    if (live.length) {
      const { error } = await client.from(T.notebookEntries).upsert(live, { onConflict: 'id' });
      if (error) throw error;
    }

    // Soft delete, never hard: the retrieval layer already filters on
    // deleted_at, and a note the user removed by accident is recoverable for
    // as long as the row survives.
    let softDeleted = 0;
    if (gone.length) {
      const { error } = await client
        .from(T.notebookEntries)
        .update({ deleted_at: now, updated_at: now })
        .eq('clerk_id', clerkId)
        .in('id', gone.map(r => r.id))
        .is('deleted_at', null);
      if (error) throw error;
      softDeleted = gone.length;
    }

    const needsEmbedding = live
      .filter(r => embeddedHashes.get(r.id) !== r.body_hash)
      .map(r => r.id);

    return { mirrored: live.length, softDeleted, needsEmbedding };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('mirrorNotebookEntries failed', { clerkId, count: entries.length, error: msg });
    return { ...EMPTY, error: msg };
  }
}

export type { NotebookEntryRow };
