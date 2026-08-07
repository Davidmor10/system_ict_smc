// ─────────────────────────────────────────────────────────────────────────────
// notebook_entries + notebook_chunks access.
//
// The entry side is a plain CRUD. The chunk side owns the RAG index — it lets
// callers replace all chunks for an entry atomically (delete + insert +
// mark embedded, in one transaction path) and run cosine-similarity retrieval
// scoped to a single user.
// ─────────────────────────────────────────────────────────────────────────────

import { T, type NotebookEntryRow, type NotebookChunkRow, type ChunkHit } from '../types';
import { getClient, requireClerkId } from './client';

// ── Entry helpers ───────────────────────────────────────────────────────────

/** Entries this user has that need embedding — either never embedded, or the
    body_hash changed since the last embed. The chunker/embedder worker reads
    from here. Soft-deleted rows excluded. Newest edits first. */
export async function listEntriesNeedingEmbed(
  clerkId: string,
  opts: { limit?: number } = {},
): Promise<NotebookEntryRow[]> {
  const cid   = requireClerkId(clerkId);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const { data, error } = await getClient()
    .from(T.notebookEntries)
    .select('*')
    .eq('clerk_id', cid)
    .is('deleted_at', null)
    .or('embedded_at.is.null,embedded_body_hash.neq.body_hash')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Postgres can't compare column-to-column inside a .or() string, so a second
  // filter in-process guards the "hash changed since embed" case cleanly.
  return ((data ?? []) as NotebookEntryRow[]).filter(
    r => !r.embedded_at || r.embedded_body_hash !== r.body_hash,
  );
}

/** Fetch a specific entry (scoped) — for the embedder loop. */
export async function getEntry(
  clerkId: string,
  entryId: string,
): Promise<NotebookEntryRow | null> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.notebookEntries)
    .select('*')
    .eq('clerk_id', cid)
    .eq('id', entryId)
    .maybeSingle();
  if (error) throw error;
  return (data as NotebookEntryRow | null) ?? null;
}

/** Mark an entry as embedded — final step of a successful chunk+embed pass.
    Stores the body_hash that was embedded so a later edit re-triggers work. */
export async function markEntryEmbedded(
  clerkId: string,
  entryId: string,
  embeddedBodyHash: string,
  embeddedAt: Date = new Date(),
): Promise<void> {
  const cid = requireClerkId(clerkId);
  const { error } = await getClient()
    .from(T.notebookEntries)
    .update({
      embedded_at:        embeddedAt.toISOString(),
      embedded_body_hash: embeddedBodyHash,
    })
    .eq('clerk_id', cid)
    .eq('id', entryId);
  if (error) throw error;
}

// ── Chunk helpers ───────────────────────────────────────────────────────────

/** Insert type for a new chunk — id and created_at are DB defaults. */
export interface ChunkInsert {
  entry_id:    string;
  chunk_ix:    number;
  content:     string;
  token_count: number;
  embedding:   number[];   // 768-dim
}

/** Replace every chunk for an entry with a fresh set. The pipeline calls this
    after re-chunking an edited entry: old vectors gone, new vectors in.
    Not a real DB transaction (Supabase-JS doesn't expose one over PostgREST),
    but sequenced so a mid-flight failure never leaves the entry marked
    embedded without chunks (the caller must call markEntryEmbedded only
    after this succeeds). */
export async function replaceChunks(
  clerkId: string,
  entryId: string,
  chunks: ChunkInsert[],
): Promise<void> {
  const cid    = requireClerkId(clerkId);
  const client = getClient();

  // 1. Delete existing chunks for this entry (scoped by clerk_id + entry_id).
  const del = await client
    .from(T.notebookChunks)
    .delete()
    .eq('clerk_id', cid)
    .eq('entry_id', entryId);
  if (del.error) throw del.error;

  // 2. Insert new chunks in one batched call.
  if (!chunks.length) return;
  const rows = chunks.map(c => ({ ...c, clerk_id: cid }));
  const ins  = await client.from(T.notebookChunks).insert(rows);
  if (ins.error) throw ins.error;
}

/** Similarity search over the user's chunks. Uses pgvector's cosine distance
    operator `<=>`. Score returned is `1 - distance` (higher = more similar).
    Filtered by a minimum score so obviously-unrelated chunks don't reach the
    prompt as noise. */
export async function searchChunks(
  clerkId: string,
  queryEmbedding: number[],
  opts: { topK?: number; minScore?: number } = {},
): Promise<ChunkHit[]> {
  const cid      = requireClerkId(clerkId);
  const topK     = Math.min(Math.max(opts.topK ?? 5, 1), 20);
  const minScore = opts.minScore ?? 0.6;

  // pgvector's <=> operator isn't directly exposable through PostgREST filter
  // syntax, so we call a Postgres function we'll add to the migration in a
  // later step. For now this helper delegates to it — the SQL function is
  // introduced when we build the retrieval layer.
  const { data, error } = await getClient().rpc('search_notebook_chunks', {
    p_clerk_id:  cid,
    p_embedding: queryEmbedding,
    p_top_k:     topK,
    p_min_score: minScore,
  });
  if (error) throw error;
  return (data ?? []) as ChunkHit[];
}
