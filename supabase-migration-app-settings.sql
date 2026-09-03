-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — app_settings: owner-configured values that are not code.
--
-- The Bit number and payee name lived in environment variables, which meant
-- changing where customers send money required a Vercel dashboard and a
-- redeploy. Until they were set the payment page showed a dash, and nobody
-- could pay — the product was live and uncollectable, with nothing on any
-- screen saying so.
--
-- These are settings, not configuration: the owner should be able to type them
-- into their own admin screen. One row per key, written only by an admin, read
-- by the checkout.
--
-- NOT PER-USER. Deliberately a separate table from user_collections rather
-- than a row on the owner's own record — the checkout has to read this without
-- knowing whose it is, and hanging a global value off one person's row makes
-- it break the day that person changes.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run.
--   Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists app_settings (
  key        text        primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Row Level Security on, with no policy: the service-role key used by the
-- server bypasses RLS, and nothing else may read or write this table. The
-- Bit number is not a secret, but the write side decides where money goes.
alter table app_settings enable row level security;

comment on table app_settings is
  'Owner-configured values read by the app. Written only through admin-gated server routes.';
