-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — Intelligence Pipeline RPCs (patch for supabase-migration-intelligence)
--
-- Two Postgres functions the coach-pipeline TypeScript layer needs to call
-- through PostgREST (supabase-js `.rpc()`), because both require SQL features
-- that PostgREST's filter syntax can't express:
--
--   1. search_notebook_chunks  — pgvector cosine similarity search
--                                (the <=> operator isn't exposable via .filter)
--   2. pick_pending_jobs       — atomic pick + claim with SKIP LOCKED
--                                (needs a CTE + UPDATE ... RETURNING, one
--                                round-trip, race-safe for concurrent workers)
--
-- How to run:
--   Supabase Dashboard → SQL Editor → New Query → paste this file → Run.
--   Idempotent: uses `create or replace` — safe to re-run any time.
--   Assumes supabase-migration-intelligence.sql already ran successfully.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. search_notebook_chunks — RAG retrieval scoped to one user.
--
-- Returns the top-K chunks whose cosine similarity to p_embedding is at least
-- p_min_score, ordered from most similar to least similar. The clerk_id filter
-- is first-class (not a suggestion) — the function has no code path that
-- returns rows from another user, so a bug in the calling code can't leak.
--
-- The HNSW index on notebook_chunks(embedding vector_cosine_ops) is used
-- automatically when the ORDER BY expression matches. We do the score cutoff
-- BEFORE limit, so a partial result is truthful ("nothing above 0.6") rather
-- than "top 5 no matter how weak".
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function search_notebook_chunks(
  p_clerk_id  text,
  p_embedding vector(768),
  p_top_k     int     default 5,
  p_min_score numeric default 0.6
)
returns table (
  clerk_id    text,
  id          uuid,
  entry_id    uuid,
  chunk_ix    int,
  content     text,
  token_count int,
  embedding   vector(768),
  created_at  timestamptz,
  score       numeric
)
language sql stable
as $$
  select
    c.clerk_id,
    c.id,
    c.entry_id,
    c.chunk_ix,
    c.content,
    c.token_count,
    c.embedding,
    c.created_at,
    (1 - (c.embedding <=> p_embedding))::numeric as score
  from notebook_chunks c
  where c.clerk_id = p_clerk_id
    and (1 - (c.embedding <=> p_embedding)) >= p_min_score
  order by c.embedding <=> p_embedding asc
  limit greatest(1, least(coalesce(p_top_k, 5), 20));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pick_pending_jobs — race-safe batch claim from the processing queue.
--
-- Two concurrent workers calling this at the same millisecond CANNOT get
-- overlapping rows: the inner CTE holds FOR UPDATE SKIP LOCKED, so whichever
-- transaction touches a row first hides it from the other for the length of
-- the transaction. The outer UPDATE then flips status → 'running' and stamps
-- started_at in the same round-trip — no "picked but not marked" window.
--
-- Rules honored:
--   - Only rows where status = 'pending'.
--   - scheduled_at must be due (<= now()).
--   - If next_retry_at is set (a retry after backoff), it must also be due.
--   - Earliest scheduled_at first (fair-ish ordering — cheapest is best-first
--     since orchestrator staggers scheduled_at across a 60-minute window).
--   - Bounded by p_limit (default 5, hard cap 20 to protect the worker
--     invocation budget on Vercel).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function pick_pending_jobs(p_limit int default 5)
returns setof processing_jobs
language sql volatile
as $$
  with candidates as (
    select id
    from processing_jobs
    where status = 'pending'
      and (scheduled_at is null or scheduled_at <= now())
      and (next_retry_at is null or next_retry_at <= now())
    order by scheduled_at asc nulls first
    limit greatest(1, least(coalesce(p_limit, 5), 20))
    for update skip locked
  )
  update processing_jobs pj
    set status      = 'running',
        started_at  = now()
    from candidates
    where pj.id = candidates.id
    returning pj.*;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — the coach pipeline calls these functions with the service_role
-- key, which has full DB access. But we also grant to authenticated so a
-- future switch to Supabase-Auth-backed calls Just Works.
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function search_notebook_chunks(text, vector, int, numeric) to service_role, authenticated;
grant execute on function pick_pending_jobs(int) to service_role, authenticated;
