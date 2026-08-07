// ─────────────────────────────────────────────────────────────────────────────
// End-to-end retrieval: today's trades → query text → embedding → RPC search
// → past_writing block, ready to inject into the insight prompt.
//
// Called by the daily-insight orchestrator (Step 10). Sits above chunker/
// embedder in the pipeline stack — those store; this reads.
//
// Cost model: exactly one embedding call per invocation (the query itself).
// text-embedding-004 is free tier; still logged to ai_usage_log under
// purpose='retrieval_query' so admin dashboards see query volume separately
// from ingest volume.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow, ChunkHit, NotebookEntryRow } from '../types';
import { T } from '../types';
import { computeTodaySignals, type TodaySignals } from '../analyzers/todaySignals';
import { buildRetrievalQuery } from '../retrieval/queryBuilder';
import { buildPastWritingItems, formatPastWritingBlock, type PastWritingItem } from '../retrieval/pastWritingBlock';
import { embedBatch, EMBEDDING_MODEL } from '../providers/google';
import { searchChunks } from '../db/notebook';
import { getClient, requireClerkId } from '../db/client';
import { logUsage } from '../db/usage';
import { logger } from '../../logger';

export interface RetrievalOptions {
  topK?:     number;   // default 5
  minScore?: number;   // default 0.6
}

export interface RetrievalResult {
  signals:      TodaySignals;
  queryText:    string;
  hits:         ChunkHit[];
  items:        PastWritingItem[];
  block:        string;                // the JSON string Claude receives
  chunkIds:     string[];              // for daily_insights.retrieval_chunk_ids
  topScore:     number | null;         // for daily_insights.retrieval_top_score
  latencyMs:    number;                // embed + rpc combined
  skipped:      false | 'no_trades' | 'embed_failed' | 'search_failed';
}

/** Empty-result helper — used for the various skip paths so the caller
 *  always gets the same shape regardless of what went wrong. */
function empty(
  signals: TodaySignals,
  queryText: string,
  reason: 'no_trades' | 'embed_failed' | 'search_failed' | false,
): RetrievalResult {
  return {
    signals,
    queryText,
    hits:      [],
    items:     [],
    block:     formatPastWritingBlock([]),
    chunkIds:  [],
    topScore:  null,
    latencyMs: 0,
    skipped:   reason,
  };
}

/** Fetch entry metadata (date + kind) for the chunks we got back — needed to
 *  render the past_writing items with the right date and kind. Scoped to
 *  this user, so a chunk pointing to another user's entry (impossible by
 *  RLS + our clerk-scoped RPC) would simply be dropped. */
async function loadEntriesForHits(
  clerkId: string,
  hits: readonly ChunkHit[],
): Promise<Map<string, Pick<NotebookEntryRow, 'created_at' | 'kind'>>> {
  const ids = Array.from(new Set(hits.map(h => h.entry_id)));
  if (!ids.length) return new Map();
  const { data, error } = await getClient()
    .from(T.notebookEntries)
    .select('id, created_at, kind')
    .eq('clerk_id', clerkId)
    .in('id', ids);
  if (error) throw error;
  const map = new Map<string, Pick<NotebookEntryRow, 'created_at' | 'kind'>>();
  for (const row of (data ?? []) as Array<Pick<NotebookEntryRow, 'id' | 'created_at' | 'kind'>>) {
    map.set(row.id, { created_at: row.created_at, kind: row.kind });
  }
  return map;
}

/** Run the full retrieval pipeline. Never throws — every failure lands as a
 *  populated RetrievalResult with `skipped` set, and the daily-insight
 *  generator falls back to running without a past_writing context. */
export async function retrievePastWriting(
  clerkId: string,
  todaysTrades: readonly TradeRow[],
  opts: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const cid       = requireClerkId(clerkId);
  const signals   = computeTodaySignals(todaysTrades);
  const queryText = buildRetrievalQuery(signals);

  // Skip retrieval entirely on a no-trade day — no point paying (even $0)
  // for a query with nothing distinctive to match against.
  if (signals.n_trades === 0) return empty(signals, queryText, 'no_trades');

  // 1. Embed the query.
  const embedStart = Date.now();
  let queryVector: number[];
  try {
    const res = await embedBatch([queryText], 'RETRIEVAL_QUERY');
    queryVector = res.vectors[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('retrievePastWriting: embed failed', { clerkId: cid, error: msg });
    await logUsage({
      clerkId: cid,
      provider: 'google',
      model:    EMBEDDING_MODEL,
      purpose:  'retrieval_query',
      tokensIn: 1,
      tokensOut: 0,
      costUsdEst: 0,
      ok: false,
      errorKind: /rate/i.test(msg) ? 'rate_limit' : 'model_error',
    });
    return empty(signals, queryText, 'embed_failed');
  }
  const embedLatency = Date.now() - embedStart;

  // 2. Vector search via the RPC we added in Step 6.5.
  const searchStart = Date.now();
  let hits: ChunkHit[] = [];
  try {
    hits = await searchChunks(cid, queryVector, {
      topK:     opts.topK     ?? 5,
      minScore: opts.minScore ?? 0.6,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('retrievePastWriting: search failed', { clerkId: cid, error: msg });
    // Still log the query embedding as a successful cost event — it happened.
    await logUsage({
      clerkId: cid, provider: 'google', model: EMBEDDING_MODEL,
      purpose: 'retrieval_query', tokensIn: 1, tokensOut: 0, costUsdEst: 0,
      latencyMs: embedLatency, ok: true,
    });
    return empty(signals, queryText, 'search_failed');
  }
  const searchLatency = Date.now() - searchStart;

  // 3. Load entry metadata + build items.
  const entries = await loadEntriesForHits(cid, hits);
  const items   = buildPastWritingItems(hits, entries);
  const block   = formatPastWritingBlock(items);

  // 4. Log the successful query embedding.
  await logUsage({
    clerkId:   cid,
    provider:  'google',
    model:     EMBEDDING_MODEL,
    purpose:   'retrieval_query',
    tokensIn:  1,
    tokensOut: 0,
    costUsdEst: 0,
    latencyMs: embedLatency,
    ok: true,
  });

  return {
    signals,
    queryText,
    hits,
    items,
    block,
    chunkIds:  hits.map(h => h.id),
    topScore:  hits.length ? hits[0].score : null,
    latencyMs: embedLatency + searchLatency,
    skipped:   false,
  };
}
