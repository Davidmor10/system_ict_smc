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
--
-- Three things this function must NOT do, learned the hard way:
--
--   a) It must never return two jobs with the same (clerk_id, job_type). The
--      partial unique index jobs_one_running_per_kind forbids two 'running'
--      rows of a kind per user, so the outer UPDATE would raise 23505 and
--      abort the WHOLE batch — one user with a stray duplicate takes down
--      everyone else's insight for the night. Hence `distinct on`.
--
--   b) It must not hand out a job for a user who already has one running.
--      Same index, same blast radius. Hence the `not exists` guard.
--
--   c) It must not let a crashed worker wedge a user forever. A serverless
--      invocation that is killed mid-job leaves status = 'running' with no
--      one to clear it, and (b) would then block that user permanently. The
--      reaper CTE returns anything running longer than 15 minutes to
--      'pending'. Note that CTEs share one snapshot, so a reaped row becomes
--      visible on the NEXT call, not this one — deliberate, and harmless
--      because the caller loops.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function pick_pending_jobs(p_limit int default 5)
returns setof processing_jobs
language sql volatile
as $$
  with reaped as (
    update processing_jobs
       set status     = 'pending',
           started_at = null,
           error      = 'reaped: running > 15 minutes without completing',
           error_kind = 'timeout'
     where status = 'running'
       and started_at is not null
       and started_at < now() - interval '15 minutes'
    returning id
  ),
  locked as (
    select pj.id, pj.clerk_id, pj.job_type, pj.scheduled_at
    from processing_jobs pj
    where pj.status = 'pending'
      and (pj.scheduled_at is null or pj.scheduled_at <= now())
      and (pj.next_retry_at is null or pj.next_retry_at <= now())
      and not exists (
        select 1
        from processing_jobs r
        where r.clerk_id = pj.clerk_id
          and r.job_type = pj.job_type
          and r.status   = 'running'
      )
    order by pj.scheduled_at asc nulls first
    -- Over-fetch: duplicates collapse in `candidates` below, so a narrow
    -- lock window would return fewer than p_limit jobs on a busy queue.
    limit greatest(1, least(coalesce(p_limit, 5), 20)) * 4
    for update skip locked
  ),
  candidates as (
    select distinct on (clerk_id, job_type) id, scheduled_at
    from locked
    order by clerk_id, job_type, scheduled_at asc nulls first
  ),
  bounded as (
    select id from candidates
    order by scheduled_at asc nulls first
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  )
  update processing_jobs pj
    set status      = 'running',
        started_at  = now()
    from bounded
    where pj.id = bounded.id
    returning pj.*;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — the coach pipeline calls these functions with the service_role key.
--
-- `authenticated` is deliberately NOT granted on pick_pending_jobs: it mutates
-- the queue (claims jobs, flips status) and takes no clerk_id, so any logged-in
-- user could hand themselves the entire queue and starve the worker. The revoke
-- is explicit because an earlier version of this file did grant it.
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function search_notebook_chunks(text, vector, int, numeric) to service_role, authenticated;
grant  execute on function pick_pending_jobs(int) to service_role;
revoke execute on function pick_pending_jobs(int) from authenticated;
revoke execute on function pick_pending_jobs(int) from anon;
