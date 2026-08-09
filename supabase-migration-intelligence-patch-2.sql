-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — Intelligence Pipeline, patch 2 (post-audit fixes)
--
-- Run AFTER:
--   1. supabase-migration-intelligence.sql
--   2. supabase-migration-intelligence-rpcs.sql
--
-- Everything here is idempotent — safe to run more than once.
--
-- What it does, and why:
--   §1  Server-side cost aggregation. PostgREST caps a SELECT at 1000 rows by
--       default, and the budget guards summed the rows in JavaScript — so the
--       moment the ledger passed 1000 entries, every spend total silently
--       under-reported and the caps stopped capping. SUM belongs in Postgres.
--   §2  A usage rollup for the owner cost dashboard, same reason.
--   §3  A composite unique key on intelligence_trades so the mirror's upsert
--       can conflict-target (clerk_id, id) instead of id alone.
--   §4  The updated pick_pending_jobs — see the rpcs file for the full
--       rationale. Repeated here so this file alone is enough to get current.
--   §5  Grants, including the revoke of pick_pending_jobs from `authenticated`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Cost sums — one number per call, computed by the database.
--
-- Two functions rather than one nullable-clerk_id function on purpose: a
-- caller who means "this user" and accidentally passes null would otherwise
-- receive the account-wide total and compare it against a per-user cap.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sum_ai_cost_user(
  p_clerk_id text,
  p_since    timestamptz
)
returns numeric
language sql stable
as $$
  select coalesce(sum(cost_usd_estimate), 0)::numeric
  from ai_usage_log
  where clerk_id = p_clerk_id
    and created_at >= p_since;
$$;

create or replace function sum_ai_cost_system(p_since timestamptz)
returns numeric
language sql stable
as $$
  select coalesce(sum(cost_usd_estimate), 0)::numeric
  from ai_usage_log
  where created_at >= p_since;
$$;

-- Embedding volume for the per-user daily cap. tokens_in on a 'note_embed'
-- row stores the chunk count, not tokens — see embedEntry.ts.
create or replace function sum_embed_chunks_user(
  p_clerk_id text,
  p_since    timestamptz
)
returns bigint
language sql stable
as $$
  select coalesce(sum(tokens_in), 0)::bigint
  from ai_usage_log
  where clerk_id = p_clerk_id
    and purpose  = 'note_embed'
    and created_at >= p_since;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. ai_usage_rollup — everything the owner cost dashboard needs, grouped in
-- the database, in one round trip.
--
-- `bucket` names the grouping ('total' | 'today' | 'purpose' | 'model' |
-- 'user'), `key` is the group within it ('' for the two scalar buckets).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ai_usage_rollup(
  p_since     timestamptz,
  p_day_start timestamptz
)
returns table (
  bucket     text,
  key        text,
  calls      bigint,
  failed     bigint,
  tokens_in  bigint,
  tokens_out bigint,
  cost_usd   numeric
)
language sql stable
as $$
  with scoped as (
    select * from ai_usage_log where created_at >= p_since
  )
  select 'total'::text, ''::text,
         count(*), count(*) filter (where not ok),
         coalesce(sum(tokens_in),0)::bigint, coalesce(sum(tokens_out),0)::bigint,
         coalesce(sum(cost_usd_estimate),0)::numeric
  from scoped
  union all
  select 'today', '',
         count(*), count(*) filter (where not ok),
         coalesce(sum(tokens_in),0)::bigint, coalesce(sum(tokens_out),0)::bigint,
         coalesce(sum(cost_usd_estimate),0)::numeric
  from scoped where created_at >= p_day_start
  union all
  select 'purpose', coalesce(purpose, 'unknown'),
         count(*), count(*) filter (where not ok),
         coalesce(sum(tokens_in),0)::bigint, coalesce(sum(tokens_out),0)::bigint,
         coalesce(sum(cost_usd_estimate),0)::numeric
  from scoped group by 2
  union all
  select 'model', coalesce(provider,'?') || '/' || coalesce(model,'?'),
         count(*), count(*) filter (where not ok),
         coalesce(sum(tokens_in),0)::bigint, coalesce(sum(tokens_out),0)::bigint,
         coalesce(sum(cost_usd_estimate),0)::numeric
  from scoped group by 2
  union all
  select 'user', coalesce(clerk_id, 'system'),
         count(*), count(*) filter (where not ok),
         coalesce(sum(tokens_in),0)::bigint, coalesce(sum(tokens_out),0)::bigint,
         coalesce(sum(cost_usd_estimate),0)::numeric
  from scoped group by 2;
$$;

-- Cost queries always filter on created_at, and usually on clerk_id too.
create index if not exists ai_usage_created_at      on ai_usage_log (created_at desc);
create index if not exists ai_usage_clerk_created   on ai_usage_log (clerk_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. intelligence_trades — composite unique key for the mirror upsert.
--
-- The mirror derives a deterministic UUID from the source row, then upserts
-- with `on conflict (id)`. That works, but it conflict-targets a key that
-- doesn't mention the tenant: a UUID collision across users would let one
-- user's write land on another user's row. Adding (clerk_id, id) lets the
-- upsert name the tenant in its conflict target, so the constraint itself
-- enforces the isolation instead of the hash being trusted to.
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists intelligence_trades_clerk_id_key
  on intelligence_trades (clerk_id, id);

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. pick_pending_jobs — duplicate-safe, running-aware, self-healing.
--
--   a) `distinct on (clerk_id, job_type)`: without it, two pending jobs of the
--      same kind for one user would both flip to 'running' in the same UPDATE
--      and violate the jobs_one_running_per_kind unique index — aborting the
--      entire batch. One user's stray duplicate would cost everyone their
--      nightly insight.
--   b) `not exists (... status = 'running')`: same index, same blast radius,
--      across calls rather than within one.
--   c) The reaper: a serverless invocation killed mid-job leaves status
--      'running' forever, and (b) would then block that user permanently.
--      Anything running > 15 minutes goes back to 'pending'. CTEs share one
--      snapshot, so a reaped row is picked up on the NEXT call — fine, the
--      caller loops.
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
-- §5. Grants.
--
-- The pipeline runs on the service_role key. `authenticated` is granted only
-- the read-only, clerk-scoped search function. pick_pending_jobs mutates the
-- queue and takes no clerk_id — any logged-in user could claim every job in
-- it and starve the worker — so it is explicitly revoked, because an earlier
-- version of the rpcs file did grant it.
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function sum_ai_cost_user(text, timestamptz)         to service_role;
grant execute on function sum_ai_cost_system(timestamptz)             to service_role;
grant execute on function sum_embed_chunks_user(text, timestamptz)    to service_role;
grant execute on function ai_usage_rollup(timestamptz, timestamptz)   to service_role;
grant execute on function pick_pending_jobs(int)                      to service_role;

revoke execute on function sum_ai_cost_user(text, timestamptz)        from authenticated, anon;
revoke execute on function sum_ai_cost_system(timestamptz)            from authenticated, anon;
revoke execute on function sum_embed_chunks_user(text, timestamptz)   from authenticated, anon;
revoke execute on function ai_usage_rollup(timestamptz, timestamptz)  from authenticated, anon;
revoke execute on function pick_pending_jobs(int)                     from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6. Sanity check — run this after the patch and read the output.
-- ─────────────────────────────────────────────────────────────────────────────
-- select
--   (select count(*) from pg_proc where proname = 'sum_ai_cost_user')    as has_user_sum,
--   (select count(*) from pg_proc where proname = 'sum_ai_cost_system')  as has_system_sum,
--   (select count(*) from pg_proc where proname = 'ai_usage_rollup')     as has_rollup,
--   (select count(*) from pg_indexes
--     where indexname = 'intelligence_trades_clerk_id_key')              as has_composite_key;
