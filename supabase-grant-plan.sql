-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — grant a plan to one account by email (a comp, not a sale).
--
-- Set the two values in §0 and run the sections in order.
--
-- WHAT ACTUALLY GRANTS ACCESS
--
-- One column: `profiles.role`. Every gate in the app resolves through
-- getUserContext(), which reads `role` and nothing else, and the nightly
-- coach pipeline reads the same column when it decides who gets a run. So a
-- comp is one UPDATE, and there is no second place to keep in sync.
--
-- `subscription_status` is deliberately NOT touched. It is written only by
-- the Stripe webhook and read by nothing. Setting it to 'active' for an
-- account that never paid would record a sale that did not happen, and would
-- be the first thing to mislead you when you reconcile against Stripe.
-- A comp is honestly 'inactive'.
--
-- THE ORDER MATTERS, AND THIS IS WHERE THE LAST GRANT FAILED
--
-- The row is keyed by clerk_id, which does not exist until the person has an
-- account. Granting before they sign up matches ZERO rows and reports
-- success, because "no rows updated" is not an error in SQL. That is exactly
-- how the previous tester signed in to a "no plan" screen.
--
--   1. she signs up at the site and signs in ONCE
--   2. then §1 below finds her row
--   3. then §2 grants
--
-- Nothing here is destructive and every section is safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §0. The two values this script is about.
--
-- Matched case-insensitively: Clerk stores what the person typed, and an
-- address that differs only in capitals is the same mailbox. Trimmed too,
-- because a trailing space pasted from a message matches nothing and looks
-- identical on screen.
-- ─────────────────────────────────────────────────────────────────────────────
--   email : yardenm2014@gmail.com
--   tier  : pro          ('free' | 'starter' | 'pro' | 'deluxe')

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. LOOK FIRST. Does the account exist, and what does it have now?
--
-- Expect exactly one row. Read the result before running §2:
--
--   one row      → good. Note the current role; §2 changes it.
--   no rows      → she has not signed up, or signed up under another address.
--                  STOP. Granting now would silently do nothing.
--   two+ rows    → two accounts on one address. Decide which is hers (the one
--                  she actually signs in with) before granting, or she will
--                  keep landing on the free one.
-- ─────────────────────────────────────────────────────────────────────────────
select clerk_id, email, role, subscription_status, created_at
from profiles
where lower(trim(email)) = lower(trim('yardenm2014@gmail.com'));

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. GRANT.
--
-- `returning` is the point of this shape: it prints the row that changed, so
-- a grant that matched nothing is visible instead of looking like a success.
-- If this returns no rows, go back to §1 — do not re-run it hoping.
-- ─────────────────────────────────────────────────────────────────────────────
update profiles
   set role = 'pro'
 where lower(trim(email)) = lower(trim('yardenm2014@gmail.com'))
returning clerk_id, email, role, subscription_status;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. VERIFY — from the same angle the app reads it.
--
-- She must sign out and back in, or hard-reload: the plan is resolved on the
-- server per request, but a page already open was rendered under the old one.
-- ─────────────────────────────────────────────────────────────────────────────
select clerk_id, email, role, subscription_status
from profiles
where lower(trim(email)) = lower(trim('yardenm2014@gmail.com'));

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. REVOKE — at the end of the beta. Commented so it cannot run by accident.
--
-- 'free' keeps the account, the journal and every trade; it only closes the
-- paid screens. Deleting the row would NOT delete her data — it would orphan
-- it, and the read path would quietly create a fresh free row on her next
-- sign-in anyway. Never delete a profile to remove a plan.
-- ─────────────────────────────────────────────────────────────────────────────
-- update profiles
--    set role = 'free'
--  where lower(trim(email)) = lower(trim('yardenm2014@gmail.com'))
-- returning clerk_id, email, role;
