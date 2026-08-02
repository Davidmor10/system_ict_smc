-- ─────────────────────────────────────────────────────────────────────────────
-- Onyx Journaling System — Full Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Journal trades (legacy table — kept for backwards compat)
create table if not exists journal_trades (
  id             bigint       not null,
  clerk_id       text         not null,
  date_iso       text         not null default '',
  time_val       text         not null default '',
  symbol         text         not null default 'ES',  -- 'MNQ'|'NQ'|'MES'|'ES' (see app/lib/instruments.ts)
  contracts      integer      not null default 1,
  direction      text         not null default 'LONG',
  entry          float8       not null default 0,
  stop_price     float8       not null default 0,
  target         float8       not null default 0,
  session        text         not null default '',
  bias           text         not null default 'INDECISIVE',
  model          text         not null default '',
  result         text         not null default 'OPEN',
  notes          text         not null default '',
  account_id     text,
  setup          text,
  confirmation   text,
  bias_alignment text,
  trade_r        float8,
  pnl_usd        float8,
  screenshots    jsonb,       -- array of data-URL strings
  exits          jsonb,       -- array of {price, contracts} partial/full exit legs
  confirmations  jsonb,       -- array of ConfirmationTag strings (FVG/IFVG/SMT/MSS/...)
  emotional_state text,       -- EmotionalState ('CALM'|'CONFIDENT'|'STRESSED'|...)
  deleted_at     timestamptz,
  primary key    (clerk_id, id)
);
create index if not exists journal_trades_clerk_idx on journal_trades (clerk_id);

-- Idempotent — adds the new columns to a journal_trades table created before this migration.
alter table journal_trades add column if not exists contracts integer not null default 1;
alter table journal_trades add column if not exists screenshots jsonb;
alter table journal_trades add column if not exists exits jsonb;
alter table journal_trades add column if not exists confirmations jsonb;
alter table journal_trades add column if not exists emotional_state text;

-- 2. User preferences
create table if not exists user_preferences (
  clerk_id        text        primary key,
  chart_tf_es     text        not null default '5',
  chart_tf_nq     text        not null default '5',
  analysis_state  jsonb,
  lockout_config  jsonb,
  updated_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Onyx Journaling System — New tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 3. Setups (Playbook)
create table if not exists setups (
  id          uuid        primary key default gen_random_uuid(),
  clerk_id    text        not null,
  name        text        not null,
  description text        not null default '',
  checklist   jsonb       not null default '[]',  -- [{text: string, required: boolean}]
  tags        text[]      not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists setups_clerk_idx on setups (clerk_id);

-- 4. Trading rules (Rules Engine)
create table if not exists trading_rules (
  id          uuid        primary key default gen_random_uuid(),
  clerk_id    text        not null,
  text        text        not null,
  category    text        not null default 'discipline', -- 'discipline'|'entry'|'exit'|'risk'
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists rules_clerk_idx on trading_rules (clerk_id);

-- 5. Trades (core journaling table — new schema)
create table if not exists trades (
  id              uuid        primary key default gen_random_uuid(),
  clerk_id        text        not null,
  created_at      timestamptz not null default now(),

  -- Core (required)
  date            date        not null,
  symbol          text        not null default 'ES',   -- 'ES'|'NQ'|'GC'|'CL'
  direction       text        not null,                 -- 'LONG'|'SHORT'
  entry_price     numeric     not null,
  stop_loss       numeric     not null,
  take_profit     numeric,
  exit_price      numeric,
  contracts       integer     not null default 1,

  -- Computed (stored for fast querying)
  rr              numeric,    -- planned RR at entry
  pnl             numeric,    -- realized PnL in USD
  result          text        not null default 'OPEN',  -- 'OPEN'|'WIN'|'LOSS'|'BE'

  -- Context
  setup_id        uuid        references setups(id) on delete set null,
  session         text,       -- 'asia'|'london'|'nyam'|'nypm' (see app/lib/sessions.ts)
  followed_rules  boolean     not null default true,
  mood            smallint    check (mood between 1 and 5),
  notes           text        not null default '',
  tags            text[]      not null default '{}',
  screenshot_url  text
);
create index if not exists trades_clerk_idx  on trades (clerk_id);
create index if not exists trades_date_idx   on trades (clerk_id, date desc);

-- 6. Rule violations (linked to trades)
create table if not exists rule_violations (
  id          uuid        primary key default gen_random_uuid(),
  clerk_id    text        not null,
  trade_id    uuid        references trades(id) on delete cascade,
  rule_id     uuid        references trading_rules(id) on delete cascade,
  date        date        not null,
  created_at  timestamptz not null default now()
);
create index if not exists violations_clerk_idx on rule_violations (clerk_id, date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (Row Level Security) — each user sees only their own rows
-- ─────────────────────────────────────────────────────────────────────────────
alter table trades           enable row level security;
alter table setups           enable row level security;
alter table trading_rules    enable row level security;
alter table rule_violations  enable row level security;

-- Also cover the legacy/account tables — journal_trades and user_preferences are
-- created above, and profiles is created out-of-band (by the Clerk webhook's
-- first upsert) but already exists in any live database, so this ALTER is safe
-- to run against it. With RLS enabled and no policies defined, every one of
-- these tables defaults to deny-all for any connection that isn't the
-- service-role key — which is exactly the app's model (Clerk, not Supabase
-- Auth, does the authentication; every read/write goes through server-side API
-- routes using the service-role key, which bypasses RLS by design). This is a
-- backstop, not the primary access control: if a future route ever forgets to
-- scope a query by clerk_id, RLS has no way to help since the service-role key
-- ignores it — the real guarantee is every API route filtering by clerk_id.
alter table journal_trades   enable row level security;
alter table user_preferences enable row level security;
alter table profiles         enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trader Intelligence System — persistent profile, pattern memory, weekly
-- narrative reports, and an append-only insight audit trail. Same conventions
-- as everything above: clerk_id text + index, jsonb for structured blobs,
-- idempotent, RLS enabled with NO policies (service-role key bypasses RLS by
-- design — every read/write goes through server-side routes that filter by
-- clerk_id themselves; this is a backstop, not the primary access control).
-- ─────────────────────────────────────────────────────────────────────────────

-- 11. Trader Profiles — one row per user, always a full recompute (never patched)
create table if not exists trader_profiles (
  clerk_id               text        primary key,
  schema_version         int         not null default 1,
  built_from_trade_count int         not null default 0,
  last_trade_date_iso    text,
  profile                jsonb       not null default '{}'::jsonb,   -- current TraderProfile
  previous_profile       jsonb,                                       -- prior snapshot, for "changes vs previous weeks"
  edge_score             numeric,                                     -- 0-100, quality of edge (not profitability), EMA-smoothed
  learning_score         numeric,                                     -- 0-100, is the trader improving over time
  score_history          jsonb       not null default '[]'::jsonb,     -- rolling {at, edgeScore, learningScore, winRate, avgRR, profitFactor}, capped at 12
  ai_known_facts         jsonb       not null default '[]'::jsonb,     -- durable AI Memory: [{fact, sourceField, confidence, firstStatedAt, lastConfirmedAt}]
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);
create index if not exists trader_profiles_clerk_idx on trader_profiles (clerk_id);

-- Idempotent — adds the intelligence-layer columns to a trader_profiles table created before this addendum.
alter table trader_profiles add column if not exists edge_score numeric;
alter table trader_profiles add column if not exists learning_score numeric;
alter table trader_profiles add column if not exists score_history jsonb not null default '[]'::jsonb;
alter table trader_profiles add column if not exists ai_known_facts jsonb not null default '[]'::jsonb;

-- 12. Pattern Memory — one row per (user, stable pattern id from discoverPatterns)
create table if not exists pattern_memory (
  clerk_id                  text        not null,
  pattern_id                text        not null,   -- PatternCandidate.id, e.g. "MNQ_nyam"
  kind                      text        not null,   -- PatternKind
  subject                   jsonb       not null,
  status                    text        not null default 'insufficient_data', -- active|strengthening|weakening|disappeared|insufficient_data
  current_metric            jsonb       not null,   -- latest GroupPerformance
  current_confidence_level  text        not null,
  current_sample_size       int         not null,
  baseline_win_rate         numeric     not null,
  delta                     numeric     not null,
  first_detected_at         timestamptz not null default now(),
  last_seen_at              timestamptz not null default now(),
  last_updated_at           timestamptz not null default now(),
  consecutive_misses        int         not null default 0,
  history                   jsonb       not null default '[]'::jsonb, -- rolling snapshots, capped at 12
  ai_title                  text,
  ai_evidence               text,
  ai_action                 text,
  ai_phrased_status         text,
  ai_phrased_win_rate       numeric,
  created_at                timestamptz not null default now(),
  primary key (clerk_id, pattern_id)
);
create index if not exists pattern_memory_clerk_idx on pattern_memory (clerk_id);
create index if not exists pattern_memory_clerk_updated_idx on pattern_memory (clerk_id, last_updated_at desc);

-- 13. Weekly AI Reports — one row per (user, ISO week)
create table if not exists weekly_ai_reports (
  id               uuid        primary key default gen_random_uuid(),
  clerk_id         text        not null,
  iso_week         text        not null,   -- "2026-W27"
  week_start_date  date        not null,
  generated_at     timestamptz not null default now(),
  trade_count      int         not null,
  confidence_level text        not null,
  narrative        jsonb       not null,   -- { schemaVersion, paragraphs: string[] }
  facts            jsonb       not null,   -- { schemaVersion, ...PeriodComparison } as fed to the LLM
  model_used       text,
  primary_hypothesis_snapshot jsonb,       -- {description, status, confidenceScore} at generation time — powers the Evolution Timeline with no extra table
  unique (clerk_id, iso_week)
);
create index if not exists weekly_ai_reports_clerk_idx on weekly_ai_reports (clerk_id);
create index if not exists weekly_ai_reports_clerk_week_idx on weekly_ai_reports (clerk_id, week_start_date desc);

-- Idempotent — adds the hypothesis snapshot to a weekly_ai_reports table created before this addendum.
alter table weekly_ai_reports add column if not exists primary_hypothesis_snapshot jsonb;

-- 13b. Trader Hypotheses — one row per user, the single CURRENT synthesized
-- edge hypothesis (e.g. "Long MNQ during NY AM with IFVG confirmation").
-- History/evolution is read from weekly_ai_reports.primary_hypothesis_snapshot
-- and ai_insight_history, not stored here — this row is always "what the
-- system currently believes," analogous to trader_profiles.
create table if not exists trader_hypotheses (
  clerk_id                text        primary key,
  description             text,                                       -- LLM-phrased narrative, cached
  evidence                text,
  supporting_pattern_ids  jsonb       not null default '[]'::jsonb,     -- pattern_memory.pattern_id[] this hypothesis is built from
  supporting_metrics      jsonb       not null default '{}'::jsonb,
  confidence_score        numeric     not null default 0,              -- 0-100
  status                  text        not null default 'insufficient_data', -- active|strengthening|weakening|invalidated|insufficient_data
  first_detected_at       timestamptz not null default now(),
  last_updated_at         timestamptz not null default now(),
  ai_phrased_status       text,
  ai_phrased_confidence   numeric,
  created_at              timestamptz not null default now()
);
create index if not exists trader_hypotheses_clerk_idx on trader_hypotheses (clerk_id);

-- 14. AI Insight History — append-only audit trail
create table if not exists ai_insight_history (
  id          uuid        primary key default gen_random_uuid(),
  clerk_id    text        not null,
  created_at  timestamptz not null default now(),
  kind        text        not null,   -- 'profile_update'|'pattern_status_change'|'weekly_report'|'dashboard_insight_shown'
  ref_id      text,
  payload     jsonb       not null default '{}'::jsonb
);
create index if not exists ai_insight_history_clerk_idx on ai_insight_history (clerk_id);
create index if not exists ai_insight_history_clerk_created_idx on ai_insight_history (clerk_id, created_at desc);

-- 15. Coach Chats — the AI Coach's multi-session chat history. One row per chat,
-- the full message list stored as jsonb (same "structured blob in a jsonb
-- column" convention as weekly_ai_reports.narrative). The "אחרונים" list is just
-- these rows for a user ordered by updated_at — no separate messages table.
create table if not exists coach_chats (
  id          uuid        primary key default gen_random_uuid(),
  clerk_id    text        not null,
  title       text        not null default 'שיחה חדשה',
  messages    jsonb       not null default '[]'::jsonb,  -- [{role:'user'|'assistant', content:string}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists coach_chats_clerk_idx on coach_chats (clerk_id, updated_at desc);

-- 15b. User Collections — one generic per-user KV store for every client-side
-- collection that used to live only in localStorage: setups, trading rules,
-- rule violations, the daily plan, reminders/focus, preferences and lockout.
-- `kind` is the namespace (e.g. 'setups', 'rules', 'violations', 'prefs',
-- 'lockout', 'dashboard', 'daily_plan:2026-07-10'); `data` is the full value
-- (array or object) — always written as a full replace, so there are no
-- partial-row merges server-side. Every read/write is scoped by clerk_id.
create table if not exists user_collections (
  clerk_id   text        not null,
  kind       text        not null,
  data       jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (clerk_id, kind)
);
create index if not exists user_collections_clerk_idx on user_collections (clerk_id);

-- Merge support for the journal: a per-trade edit timestamp so cross-device
-- hydration can let the newest edit win (idempotent).
alter table journal_trades add column if not exists updated_at timestamptz;

-- 16. Macro calendar cache — one row per Israel calendar day, holding that day's
-- fetch of the (public, ForexFactory-sourced FairEconomy) economic calendar feed
-- so the coach reads real macro events without re-fetching per request. Global,
-- not per-user: no clerk_id. Refreshed at most once per Israel day.
create table if not exists macro_calendar_cache (
  day         date        primary key,   -- Israel calendar day this snapshot was fetched for
  payload     jsonb       not null,      -- normalized MacroEvent[] for the week
  fetched_at  timestamptz not null default now()
);

-- Observability for the coach's structured-output fail-safe: one row each time
-- the model's reply could not be parsed into {final_answer}. 'retry' = first
-- attempt failed (we re-asked); 'failed' = still bad after the retry (the user
-- got the fixed error message, never raw text). Lets us see the real rate in
-- production instead of discovering leaks by hand.
create table if not exists coach_generation_fallback (
  id               bigint generated always as identity primary key,
  clerk_id         text        not null,
  stage            text        not null,   -- 'retry' | 'failed'
  question_preview text,                   -- first 200 chars only
  created_at       timestamptz not null default now()
);
create index if not exists coach_generation_fallback_created_idx on coach_generation_fallback (created_at desc);

alter table trader_profiles     enable row level security;
alter table pattern_memory      enable row level security;
alter table weekly_ai_reports   enable row level security;
alter table ai_insight_history  enable row level security;
alter table trader_hypotheses   enable row level security;
alter table coach_chats         enable row level security;
alter table macro_calendar_cache enable row level security;
alter table user_collections    enable row level security;
alter table coach_generation_fallback enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Trade Reviews — the AI Trade Review (video analysis) feature. One row
-- per uploaded video. Vision + transcript + report are all stored as jsonb so
-- the trader can re-open a past review without re-analyzing. Rows are scoped
-- by clerk_id (same access control shape as everything else).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists trade_reviews (
  id                  uuid        primary key,
  clerk_id            text        not null,
  trade_id            bigint      not null,
  status              text        not null default 'analyzing', -- 'uploading'|'analyzing'|'done'|'failed'
  error_message       text,
  video_file_uri      text,       -- Gemini File API URI; cleared/kept per retention policy
  storage_path        text,       -- Supabase Storage path (trade-review-videos bucket); cleared after Gemini upload
  video_mime          text,
  video_duration_sec  numeric,
  vision              jsonb,      -- VisionAnalysis
  transcript          jsonb,      -- Transcript
  report              jsonb,      -- TradeReviewReport (9 sections)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists trade_reviews_clerk_idx       on trade_reviews (clerk_id);
create index if not exists trade_reviews_clerk_trade_idx on trade_reviews (clerk_id, trade_id, created_at desc);
-- Idempotent — adds storage_path to a trade_reviews table created before this addendum.
alter table trade_reviews add column if not exists storage_path text;
alter table trade_reviews enable row level security;

-- Clerk passes user_id as a JWT claim; adjust claim name if using Supabase Auth
-- For Clerk integration use service-role key in API routes (bypasses RLS)
