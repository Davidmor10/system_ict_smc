// ─────────────────────────────────────────────────────────────────────────────
// End-to-end pipeline: take one notebook entry → chunk → embed → store.
//
// Called by:
//   - The note_embed background job (worker cron picks a batch of entries
//     from listEntriesNeedingEmbed and hands each to embedEntry).
//   - Optionally: an on-save "warm" call for small entries to avoid the
//     wait-until-nightly window (out of scope for now).
//
// Guarantees:
//   - Never leaves partial state: chunks and embedded_at flip together.
//     If embedding or insert fails, embedded_at stays null so the next run
//     picks the entry up again.
//   - Rate-limited per user: at most 500 embedding requests / user / 24h.
//     A "request" here is one chunk (not one batch), matching how Google
//     itself counts against quota.
//   - Every call — success or fail — writes ONE row to ai_usage_log so
//     cost dashboards see the truth.
//   - Kill switch honored: if ai_pipeline_enabled=false, exit as skipped.
// ─────────────────────────────────────────────────────────────────────────────

import { chunkBody } from '../chunker';
import { embedAll, EMBEDDING_MODEL } from '../providers/google';
import { getEntry, markEntryEmbedded, replaceChunks } from '../db/notebook';
import { logUsage } from '../db/usage';
import { flags } from '../db/flags';
import { getClient, requireClerkId } from '../db/client';
import { T } from '../types';
import { logger } from '../../logger';

export const EMBED_DAILY_CAP_PER_USER = 500;

export type EmbedOutcome =
  | { status: 'ok';           entryId: string; chunkCount: number; tokensIn: number; latencyMs: number }
  | { status: 'empty';        entryId: string }                              // body was blank → wrote 0 chunks
  | { status: 'unchanged';    entryId: string }                              // hash already up-to-date
  | { status: 'not_found';    entryId: string }
  | { status: 'rate_limited'; entryId: string; used: number; cap: number }
  | { status: 'disabled';     entryId: string }
  | { status: 'failed';       entryId: string; error: string };

/** Count embedding calls this user has made in the past 24h. Uses the
 *  authoritative ledger (ai_usage_log) so a restart / cold serverless
 *  instance never resets the count. */
async function countEmbeddingsLast24h(clerkId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getClient()
    .from(T.aiUsageLog)
    .select('tokens_in')
    .eq('clerk_id', clerkId)
    .eq('purpose', 'note_embed')
    .gte('created_at', since);
  if (error) throw error;
  // tokens_in on note_embed rows stores chunk count (see logUsage call below).
  return (data ?? []).reduce((s, r) => s + Number(r.tokens_in ?? 0), 0);
}

/** Full pipeline for one entry. Idempotent — if the entry's embedded_body_hash
 *  already matches the current body_hash, exits as 'unchanged' without any
 *  AI call. Safe to run twice in a row. */
export async function embedEntry(
  clerkId: string,
  entryId: string,
): Promise<EmbedOutcome> {
  const cid = requireClerkId(clerkId);

  // 0. Kill switch.
  if (!(await flags.aiPipelineEnabled())) {
    return { status: 'disabled', entryId };
  }

  // 1. Load the entry.
  const entry = await getEntry(cid, entryId);
  if (!entry) return { status: 'not_found', entryId };
  if (entry.deleted_at) return { status: 'not_found', entryId };

  // 2. Idempotency — already embedded at this hash.
  if (entry.embedded_at && entry.embedded_body_hash === entry.body_hash) {
    return { status: 'unchanged', entryId };
  }

  // 3. Chunk. Empty body → wipe chunks and mark embedded (so an emptied entry
  //    doesn't keep bubbling back into the "needs embed" queue).
  const chunks = chunkBody(entry.body);
  if (chunks.length === 0) {
    await replaceChunks(cid, entryId, []);
    await markEntryEmbedded(cid, entryId, entry.body_hash);
    return { status: 'empty', entryId };
  }

  // 4. Rate limit check — count chunks against the daily cap. Blocking here
  //    (not throwing) lets the caller reason about outcomes as data.
  const used = await countEmbeddingsLast24h(cid);
  if (used + chunks.length > EMBED_DAILY_CAP_PER_USER) {
    logger.warn('embedEntry rate limited', {
      clerkId: cid, entryId, used, cap: EMBED_DAILY_CAP_PER_USER, wanted: chunks.length,
    });
    return { status: 'rate_limited', entryId, used, cap: EMBED_DAILY_CAP_PER_USER };
  }

  // 5. Embed. On failure — log usage as ok=false and return failed; the
  //    entry stays unmarked so the next run tries again.
  let vectors: number[][] = [];
  let latencyMs = 0;
  const tokensIn = chunks.reduce((s, c) => s + c.token_count, 0);
  try {
    const res = await embedAll(chunks.map(c => c.content), 'RETRIEVAL_DOCUMENT');
    vectors  = res.vectors;
    latencyMs = res.latencyMs;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logUsage({
      clerkId: cid,
      provider: 'google',
      model: EMBEDDING_MODEL,
      purpose: 'note_embed',
      tokensIn: chunks.length,   // count of embedding requests attempted
      tokensOut: 0,
      costUsdEst: 0,
      ok: false,
      errorKind: /rate/i.test(msg) ? 'rate_limit' : 'model_error',
    });
    logger.error('embedEntry embed failed', { clerkId: cid, entryId, error: msg });
    return { status: 'failed', entryId, error: msg };
  }

  // 6. Persist chunks + mark embedded. Order matters: chunks first so a
  //    crash between the two leaves an entry that still needs embed (chunks
  //    are the recoverable side; embedded_at is the "trust me" flag).
  try {
    const inserts = chunks.map((c, i) => ({
      entry_id:    entryId,
      chunk_ix:    i,
      content:     c.content,
      token_count: c.token_count,
      embedding:   vectors[i],
    }));
    await replaceChunks(cid, entryId, inserts);
    await markEntryEmbedded(cid, entryId, entry.body_hash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logUsage({
      clerkId: cid,
      provider: 'google',
      model: EMBEDDING_MODEL,
      purpose: 'note_embed',
      tokensIn: chunks.length,
      tokensOut: 0,
      costUsdEst: 0,
      latencyMs,
      ok: false,
      errorKind: 'model_error',
    });
    logger.error('embedEntry persist failed', { clerkId: cid, entryId, error: msg });
    return { status: 'failed', entryId, error: msg };
  }

  // 7. Log success. text-embedding-004 is free on Google's public tier so
  //    costUsdEst = 0; if we ever move to a paid model, wire the estimate
  //    in one place here.
  await logUsage({
    clerkId: cid,
    provider: 'google',
    model: EMBEDDING_MODEL,
    purpose: 'note_embed',
    tokensIn: chunks.length,       // request count (rate limit denominator)
    tokensOut: 0,
    costUsdEst: 0,
    latencyMs,
    ok: true,
  });

  return { status: 'ok', entryId, chunkCount: chunks.length, tokensIn, latencyMs };
}
