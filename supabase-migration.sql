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
  deleted_at     timestamptz,
  primary key    (clerk_id, id)
);
create index if not exists journal_trades_clerk_idx on journal_trades (clerk_id);

-- Idempotent — adds the new columns to a journal_trades table created before this migration.
alter table journal_trades add column if not exists contracts integer not null default 1;
alter table journal_trades add column if not exists screenshots jsonb;

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

-- Clerk passes user_id as a JWT claim; adjust claim name if using Supabase Auth
-- For Clerk integration use service-role key in API routes (bypasses RLS)
