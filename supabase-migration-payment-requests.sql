-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — payment_requests: declared Bit transfers awaiting manual verification.
--
-- Bit has no callback. A trader transfers the monthly amount in the Bit app
-- and then tells us they did; the owner checks the transfer and approves or
-- rejects. This table is that queue, and it is also the audit trail — who
-- claimed what, when, and who decided.
--
-- profiles gains `access_until`. A Bit transfer is a one-off per month, not a
-- standing mandate: nothing charges the customer again and nothing revokes
-- access on its own, so without an end date one payment buys the product
-- forever. Nullable, because the accounts that predate this — and the owner —
-- have no expiry.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run.
--   Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists payment_requests (
  id          uuid        primary key default gen_random_uuid(),
  clerk_id    text        not null,
  full_name   text        not null,
  email       text        not null,
  plan        text        not null,
  amount      integer     not null,
  status      text        not null default 'pending',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  text
);

-- The vocabulary, so a typo in a route cannot write a status nothing renders.
alter table payment_requests drop constraint if exists payment_requests_plan_check;
alter table payment_requests
  add constraint payment_requests_plan_check
  check (plan in ('starter', 'pro', 'deluxe'));

alter table payment_requests drop constraint if exists payment_requests_status_check;
alter table payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- The admin panel reads newest first; the create path checks for an existing
-- pending request by the same trader.
create index if not exists payment_requests_created_idx on payment_requests (created_at desc);
create index if not exists payment_requests_clerk_status_idx on payment_requests (clerk_id, status);

-- ONE PENDING REQUEST PER TRADER.
--
-- Enforced here and not only in the route. Two tabs, a double-click or a retry
-- after a timeout all produce a second identical claim, and the owner then
-- sees the same transfer twice and cannot tell whether it was paid once or
-- twice. A partial unique index is the only place that cannot be raced.
create unique index if not exists payment_requests_one_pending_per_user
  on payment_requests (clerk_id)
  where status = 'pending';

-- ── profiles.access_until ───────────────────────────────────────────────────
alter table profiles add column if not exists access_until timestamptz;

comment on column profiles.access_until is
  'When Bit-granted access lapses. Null means no expiry (owner, or an account predating manual billing).';

-- Verify.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'payment_requests'
order by ordinal_position;
