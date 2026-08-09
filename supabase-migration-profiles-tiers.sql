-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — profiles: align the CHECK constraints with the four-tier rollout.
--
-- WHY THIS EXISTS
--
-- `profiles.role` was constrained back when there were fewer tiers. The
-- pricing rollout introduced free < starter < pro < deluxe, the app and the
-- Stripe webhook were updated — the constraint was not. The result is a
-- silent revenue bug, not just an inconvenient error:
--
--   checkout.session.completed → roleForTier() returns 'starter' / 'deluxe'
--   → INSERT/UPDATE violates profiles_role_check
--   → the webhook returns 500
--   → Stripe has taken the money, and the customer is still on `free`.
--
-- Only `pro` (and `free`) would have worked. Anyone buying the ₪49 or ₪199
-- plan paid for nothing.
--
-- The same reasoning applies to subscription_status: the webhook writes
-- Stripe's raw `sub.status`, whose vocabulary is larger than what a
-- hand-written constraint is likely to list (trialing, past_due, unpaid,
-- incomplete, incomplete_expired, paused …). A constraint that rejects a
-- real Stripe status turns a routine billing event into a 500.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run.
--   Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §0. What is there right now? Run this first if you want to see the damage.
-- ─────────────────────────────────────────────────────────────────────────────
-- select conname, pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where conrelid = 'profiles'::regclass and contype = 'c'
-- order by conname;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Normalize any legacy values BEFORE tightening the constraint.
--
-- An old row holding a tier name we no longer recognize would make the ALTER
-- below fail on validation. Anything unknown falls back to 'free' — the safe
-- direction: a wrongly-downgraded user complains and gets fixed, a wrongly-
-- upgraded one never does.
-- ─────────────────────────────────────────────────────────────────────────────
update profiles
   set role = 'free'
 where role is null
    or role not in ('free', 'starter', 'pro', 'deluxe');

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. role — the four tiers the app actually ships.
--
-- Kept as a CHECK rather than an enum on purpose: adding a tier later is one
-- ALTER here instead of an enum migration plus a type rewrite.
-- ─────────────────────────────────────────────────────────────────────────────
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('free', 'starter', 'pro', 'deluxe'));

alter table profiles alter column role set default 'free';

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. subscription_status — every value Stripe can send, plus our own two.
--
-- 'inactive' is the app's default for a user who never subscribed; the rest
-- is Stripe's own vocabulary, verbatim. This list must stay a superset of
-- what the webhook writes, or billing events start failing.
-- ─────────────────────────────────────────────────────────────────────────────
update profiles
   set subscription_status = 'inactive'
 where subscription_status is null
    or subscription_status not in (
      'inactive', 'active', 'trialing', 'past_due', 'canceled',
      'unpaid', 'incomplete', 'incomplete_expired', 'paused'
    );

alter table profiles drop constraint if exists profiles_subscription_status_check;
alter table profiles
  add constraint profiles_subscription_status_check
  check (subscription_status in (
    'inactive', 'active', 'trialing', 'past_due', 'canceled',
    'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. The upsert target the Stripe and Clerk webhooks rely on.
--
-- Both call .upsert(..., { onConflict: 'clerk_id' }), which requires a unique
-- constraint on that column. Without it the upsert errors at runtime instead
-- of resolving the conflict.
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists profiles_clerk_id_key on profiles (clerk_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- §5. Owner row. The coach pipeline resolves the plan from this table — the
-- background worker has no Clerk session to ask — so the owner needs a real
-- row, not just the email allowlist.
-- ─────────────────────────────────────────────────────────────────────────────
insert into profiles (clerk_id, email, role, subscription_status)
values (
  'user_3Ew1DpTb4PKwMUJmnRt6esz53vi',
  'davidmor030908@gmail.com',
  'deluxe',
  'active'
)
on conflict (clerk_id) do update
  set role  = 'deluxe',
      email = excluded.email;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6. Verify. Expect: role='deluxe', and both constraints listing four tiers
-- and nine statuses.
-- ─────────────────────────────────────────────────────────────────────────────
select clerk_id, email, role, subscription_status
from profiles
where clerk_id = 'user_3Ew1DpTb4PKwMUJmnRt6esz53vi';

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'profiles'::regclass and contype = 'c'
order by conname;
