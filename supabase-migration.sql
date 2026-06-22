-- ─────────────────────────────────────────────────────────────────────────────
-- Onyx Trading — Cross-Device Sync Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Journal trades: one row per trade, keyed to user via clerk_id
create table if not exists journal_trades (
  id             bigint       not null,
  clerk_id       text         not null,
  date_iso       text         not null default '',
  time_val       text         not null default '',
  symbol         text         not null default 'ES',
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
  deleted_at     timestamptz,
  primary key    (clerk_id, id)
);

create index if not exists journal_trades_clerk_idx on journal_trades (clerk_id);

-- 2. User preferences: chart timeframes, analysis state, lockout config
create table if not exists user_preferences (
  clerk_id        text        primary key,
  chart_tf_es     text        not null default '5',
  chart_tf_nq     text        not null default '5',
  analysis_state  jsonb,
  lockout_config  jsonb,
  updated_at      timestamptz default now()
);
