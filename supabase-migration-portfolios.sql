-- ─────────────────────────────────────────────────────────────────────────────
-- PORTFOLIOS — giving every AI table an account to belong to.
--
-- A trader with a $50,000 account and a $25,000 account has two records, and
-- averaging them produces a win rate that describes neither. The screens were
-- separated first; this is the other half — the profile, the tracked patterns,
-- the edge hypothesis, the weekly report and the daily insight, each of which
-- was keyed to a person and now belongs to one of their accounts.
--
-- WHAT IS DELIBERATELY NOT SCOPED
--
-- behavior_findings. Moving a stop after entry, or entering without a logged
-- confirmation, is a habit of the TRADER — it travels with them between
-- accounts, and splitting it would make every portfolio rebuild the same
-- picture of the same person from zero. It stays keyed to the person.
--
-- ON NULL account_id
--
-- Every row written from here carries one. Rows that predate portfolios do
-- not, and there is no honest way to guess which account they were in. They
-- are read as belonging to the OLDEST portfolio — the same rule the client
-- applies, in lib/portfolio/scope — so a trade is never hidden and never
-- counted twice.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The trades the AI reads ──────────────────────────────────────────────
alter table intelligence_trades add column if not exists account_id text;
create index if not exists intelligence_trades_account
  on intelligence_trades (clerk_id, account_id, date desc);

-- ── 2. What the AI writes about them ────────────────────────────────────────
--
-- Each of these was one row (or one set of rows) per trader. The primary keys
-- have to widen, and Postgres will not widen one in place: the old constraint
-- is dropped and the new one added, which is safe because the column defaults
-- to null and null is a legal part of a composite key here only if we make it
-- so. It is not — so a placeholder is used instead: the empty string stands
-- for "no portfolio", and the read path maps it to the oldest one.

alter table trader_profiles   add column if not exists account_id text not null default '';
alter table trader_hypotheses add column if not exists account_id text not null default '';
alter table pattern_memory    add column if not exists account_id text not null default '';
alter table weekly_ai_reports add column if not exists account_id text not null default '';
alter table daily_insights    add column if not exists account_id text not null default '';
alter table ai_insight_history add column if not exists account_id text not null default '';

-- trader_profiles: (clerk_id) → (clerk_id, account_id)
alter table trader_profiles drop constraint if exists trader_profiles_pkey;
alter table trader_profiles add primary key (clerk_id, account_id);

-- trader_hypotheses: (clerk_id) → (clerk_id, account_id)
alter table trader_hypotheses drop constraint if exists trader_hypotheses_pkey;
alter table trader_hypotheses add primary key (clerk_id, account_id);

-- pattern_memory: (clerk_id, pattern_id) → (clerk_id, account_id, pattern_id)
alter table pattern_memory drop constraint if exists pattern_memory_pkey;
alter table pattern_memory add primary key (clerk_id, account_id, pattern_id);

-- weekly_ai_reports: unique (clerk_id, iso_week) → + account_id
alter table weekly_ai_reports drop constraint if exists weekly_ai_reports_clerk_id_iso_week_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'weekly_ai_reports_clerk_account_week_key'
  ) then
    alter table weekly_ai_reports
      add constraint weekly_ai_reports_clerk_account_week_key unique (clerk_id, account_id, iso_week);
  end if;
end $$;

-- daily_insights: unique (clerk_id, date, kind) → + account_id
alter table daily_insights drop constraint if exists daily_insights_clerk_id_date_kind_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_insights_clerk_account_date_kind_key'
  ) then
    alter table daily_insights
      add constraint daily_insights_clerk_account_date_kind_key unique (clerk_id, account_id, date, kind);
  end if;
end $$;

create index if not exists ai_insight_history_account
  on ai_insight_history (clerk_id, account_id, created_at desc);

-- ── 3. Nightly work needs to know which portfolio traded recently ───────────
-- The job queue schedules one run per (trader, portfolio). Without the column
-- a second portfolio's run collides with the first on the "one job per day"
-- index and is silently dropped.
alter table processing_jobs add column if not exists account_id text not null default '';

-- Rebuilt with account_id in the key and the ORIGINAL predicate preserved:
-- 'success' belongs in it, or a finished run stops blocking a duplicate and
-- the same insight is generated — and paid for — twice on a retry.
drop index if exists jobs_no_dupe_per_day;
create unique index if not exists jobs_no_dupe_per_day
  on processing_jobs (clerk_id, account_id, job_type, target_date)
  where status in ('pending','running','success') and target_date is not null;

-- jobs_one_running_per_kind stays keyed to the trader alone. Only the ACTIVE
-- portfolio is processed each night, so there is never a second run to admit,
-- and keeping it per-trader is a throttle rather than a limitation.
