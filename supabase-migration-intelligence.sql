-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — Intelligence Pipeline Migration (Steps 1-5)
--
-- Purpose:
--   Adds the AI intelligence pipeline (rolling profile + RAG + daily insights
--   + job queue + cost tracking + observability) as a NEW set of tables that
--   live alongside the existing schema in supabase-migration.sql. Nothing in
--   the existing schema is touched. In particular, the trades table below is
--   named intelligence_trades to avoid collision with the existing
--   journal_trades table.
--
-- How to run:
--   Supabase Dashboard → SQL Editor → New Query → paste this file → Run.
--   Idempotent: every statement is `if not exists` / `on conflict do nothing`
--   — safe to re-run on the same database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Extensions ─────────────────────────────────────────────────────────────
create extension if not exists vector;
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. INTELLIGENCE_TRADES — journaled trades (intelligence-pipeline copy)
--    Named separately so it never collides with the existing journal_trades.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists intelligence_trades (
  clerk_id                 text        not null,
  id                       uuid        primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  -- Core
  date                     date        not null,
  time                     text,
  symbol                   text        not null default 'ES',
  direction                text        not null,
  contracts                integer     not null default 1,
  entry_price              numeric     not null,
  stop_loss                numeric     not null,
  take_profit              numeric,
  exit_price               numeric,
  exits                    jsonb,

  -- Computed
  rr_planned               numeric,
  r_multiple               numeric,
  pnl_usd                  numeric,
  result                   text        not null default 'OPEN',

  -- Context for the coach
  session                  text,
  bias                     text,
  setup                    text,
  confirmations            jsonb,
  emotional_state          text,
  followed_rules           boolean     not null default true,
  notes                    text        not null default '',
  tags                     text[]      not null default '{}',
  screenshots              jsonb,

  -- AI processing watermarks (unprocessed trades pulled by Gemini worker)
  profile_processed_at     timestamptz,
  profile_processed_rev    int         not null default 0
);
create index if not exists intelligence_trades_clerk_date
  on intelligence_trades (clerk_id, date desc);
create index if not exists intelligence_trades_unprocessed
  on intelligence_trades (clerk_id, profile_processed_at)
  where profile_processed_at is null and deleted_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. NOTEBOOK_ENTRIES — Notion-style notes (kind: journal | plan | note)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists notebook_entries (
  clerk_id                 text        not null,
  id                       uuid        primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  kind                     text        not null
                             check (kind in ('journal','plan','note')),
  title                    text        not null default '',
  body                     text        not null,
  body_hash                text        not null,          -- sha256 hex

  mood                     smallint    check (mood between 1 and 5),
  tags                     text[]      not null default '{}',
  linked_trade_id          uuid        references intelligence_trades(id) on delete set null,

  -- AI processing watermarks
  profile_processed_at     timestamptz,
  profile_processed_rev    int         not null default 0,
  embedded_at              timestamptz,
  embedded_body_hash       text
);
create index if not exists notebook_clerk_updated  on notebook_entries (clerk_id, updated_at desc);
create index if not exists notebook_needs_embed    on notebook_entries (clerk_id)
  where deleted_at is null
    and (embedded_at is null or embedded_body_hash <> body_hash);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. NOTEBOOK_CHUNKS — RAG index (pgvector, 768-dim, HNSW cosine)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists notebook_chunks (
  clerk_id                 text        not null,
  id                       uuid        primary key default gen_random_uuid(),
  entry_id                 uuid        not null
                             references notebook_entries(id) on delete cascade,
  chunk_ix                 int         not null,
  content                  text        not null,
  token_count              int         not null,
  embedding                vector(768) not null,          -- Google text-embedding-004
  created_at               timestamptz not null default now()
);
create index if not exists chunks_clerk            on notebook_chunks (clerk_id);
create index if not exists chunks_by_entry         on notebook_chunks (entry_id, chunk_ix);
create index if not exists chunks_hnsw_cosine      on notebook_chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. USER_PROFILE — rolling compressed snapshot (500-token hard cap)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists user_profile (
  clerk_id                 text        primary key,
  updated_at               timestamptz not null default now(),
  schema_version           int         not null default 1,
  analyzer_version         int         not null default 1,

  statistical              jsonb       not null default '{}'::jsonb,
  behavioral               jsonb       not null default '{}'::jsonb,
  narrative_summary        text        not null default '',
  profile_token_count      int         not null default 0
                             check (profile_token_count <= 500),

  -- Watermarks — never re-process an already-included trade/note
  last_analyzed_at         timestamptz not null default 'epoch',
  last_trade_included_id   uuid,
  last_note_included_id    uuid
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. PROCESSING_JOBS — job queue for background AI work
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists processing_jobs (
  id                       uuid        primary key default gen_random_uuid(),
  clerk_id                 text        not null,
  job_type                 text        not null,   -- 'profile_refresh'|'note_embed'|'daily_insight'|'session_insight'
  status                   text        not null,   -- 'pending'|'running'|'success'|'failed'|'dead_letter'
  target_date              date,                   -- for daily/session insights
  scheduled_at             timestamptz,
  started_at               timestamptz,
  finished_at              timestamptz,
  attempt_count            int         not null default 0,
  next_retry_at            timestamptz,
  input_trade_ids          uuid[],
  input_entry_ids          uuid[],
  output_summary           jsonb,
  tokens_used              int,
  error                    text,
  error_kind               text                    -- 'timeout'|'rate_limit'|'model_error'|'exhausted'
);
create index if not exists jobs_clerk_type_started on processing_jobs (clerk_id, job_type, started_at desc);
create index if not exists jobs_ready              on processing_jobs (scheduled_at)
  where status = 'pending';
-- One 'running' job of each kind per user at a time
create unique index if not exists jobs_one_running_per_kind
  on processing_jobs (clerk_id, job_type) where status = 'running';
-- No duplicate scheduled/running/succeeded insights for the same user+day+kind
create unique index if not exists jobs_no_dupe_per_day
  on processing_jobs (clerk_id, job_type, target_date)
  where status in ('pending','running','success') and target_date is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. AI_USAGE_LOG — cost tracking (every AI call, always)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists ai_usage_log (
  id                       uuid        primary key default gen_random_uuid(),
  clerk_id                 text,                       -- null = system-level call
  created_at               timestamptz not null default now(),
  provider                 text        not null,       -- 'anthropic'|'google'
  model                    text        not null,
  purpose                  text        not null,       -- 'profile_refresh'|'note_embed'|'daily_insight'|...
  tokens_in                int         not null,
  tokens_out               int         not null,
  cost_usd_estimate        numeric     not null,
  latency_ms               int,
  ok                       boolean     not null,
  error_kind               text
);
create index if not exists usage_clerk_date        on ai_usage_log (clerk_id, created_at desc);
create index if not exists usage_by_purpose        on ai_usage_log (purpose, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RATE_LIMITS — per-user token/request budget window
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists rate_limits (
  clerk_id                 text        not null,
  purpose                  text        not null,
  window_start             timestamptz not null,
  tokens_consumed          int         not null default 0,
  requests_count           int         not null default 0,
  primary key (clerk_id, purpose, window_start)
);
create index if not exists rate_active             on rate_limits (clerk_id, purpose, window_start desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. DAILY_INSIGHTS — the output shown on the dashboard
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists daily_insights (
  clerk_id                 text        not null,
  id                       uuid        primary key default gen_random_uuid(),
  date                     date        not null,
  kind                     text        not null default 'daily'
                             check (kind in ('daily','session')),
  generated_at             timestamptz not null default now(),

  content_md               text        not null,
  content_hash             text        not null,       -- sha256 hex — dedup detection

  -- Model + accounting
  model                    text        not null,
  prompt_version           int         not null,
  fallback_used            boolean     not null default false,
  fallback_reason          text,                       -- 'budget_cap'|'rate_limit'|'timeout'|'api_error'|'system_budget_alarm'
  tokens_in                int         not null,
  tokens_out               int         not null,
  cost_usd_estimate        numeric     not null,
  latency_ms               int,

  -- Audit
  retrieval_chunk_ids      uuid[]      not null default '{}',
  retrieval_top_score      numeric,
  context_snapshot         jsonb       not null,

  -- User signals
  read_at                  timestamptz,
  user_reaction            text        check (user_reaction in ('helpful','meh','not_helpful')),
  reaction_at              timestamptz,

  unique (clerk_id, date, kind),
  check (tokens_in > 0 and tokens_out > 0)
);
create index if not exists daily_insights_clerk_date on daily_insights (clerk_id, date desc);
create index if not exists daily_insights_fallback   on daily_insights (fallback_used, generated_at desc)
  where fallback_used = true;
create index if not exists daily_insights_unread     on daily_insights (clerk_id, date desc)
  where read_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. FEATURE_FLAGS — kill switches + tunable thresholds
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists feature_flags (
  key                      text        primary key,
  value_json               jsonb       not null,
  updated_at               timestamptz not null default now(),
  updated_by               text
);

-- Seed defaults (idempotent — never overrides an existing value)
insert into feature_flags (key, value_json) values
  ('ai_pipeline_enabled',              'true'::jsonb),
  ('daily_budget_alarm_usd',           '5'::jsonb),
  ('user_monthly_cap_starter_usd',     '1'::jsonb),
  ('user_monthly_cap_pro_usd',         '3'::jsonb),
  ('user_monthly_cap_deluxe_usd',      '10'::jsonb),
  ('provider_rate_limiter_enabled',    'false'::jsonb),   -- Step 5 §3.ב — disabled default
  ('insight_prompt_version',           '1'::jsonb),
  ('analyzer_version',                 '1'::jsonb),
  ('idle_skip_days',                   '30'::jsonb),
  ('spread_window_minutes',            '60'::jsonb),
  ('worker_concurrency',               '5'::jsonb),
  ('worker_retry_max',                 '3'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. AI_PROVIDER_STATE — global RPM tracker (disabled by default; see flag)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists ai_provider_state (
  provider                 text        primary key,
  rpm_limit                int         not null,
  window_start             timestamptz not null default now(),
  window_count             int         not null default 0,
  is_backed_off_until      timestamptz
);
insert into ai_provider_state (provider, rpm_limit) values
  ('anthropic', 50),        -- tier 1 default; tune as account tier grows
  ('google',    1000)       -- Gemini Flash is generous
on conflict (provider) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. CRON_RUNS — observability of the batch pipeline
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists cron_runs (
  id                       bigint      generated always as identity primary key,
  cron_key                 text        not null,   -- 'nightly-orchestrate'|'process-jobs'
  started_at               timestamptz not null default now(),
  finished_at              timestamptz,
  duration_ms              int,
  jobs_picked              int         not null default 0,
  jobs_completed           int         not null default 0,
  jobs_failed              int         not null default 0,
  jobs_retried             int         not null default 0,
  error                    text
);
create index if not exists cron_runs_key_started   on cron_runs (cron_key, started_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- No policies = deny-all for anyone except the service-role key (which the
-- app's API routes use). Real access control is enforced in the routes by
-- filtering clerk_id. RLS here is the backstop.
-- ═══════════════════════════════════════════════════════════════════════════
alter table intelligence_trades enable row level security;
alter table notebook_entries    enable row level security;
alter table notebook_chunks     enable row level security;
alter table user_profile        enable row level security;
alter table processing_jobs     enable row level security;
alter table ai_usage_log        enable row level security;
alter table rate_limits         enable row level security;
alter table daily_insights      enable row level security;
alter table feature_flags       enable row level security;
alter table ai_provider_state   enable row level security;
alter table cron_runs           enable row level security;
