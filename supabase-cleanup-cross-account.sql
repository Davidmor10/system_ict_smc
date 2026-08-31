-- ─────────────────────────────────────────────────────────────────────────────
-- Rows written into the WRONG account by the localStorage leak.
--
-- The code fix stops it happening again. It cannot un-write what was already
-- written, so the copied rows have to be removed by hand.
--
-- This script FINDS the affected accounts rather than being told which they
-- are. That matters: every account signed into an un-fixed browser was
-- poisoned, including test accounts created along the way, and a cleanup
-- keyed to one id you happen to remember leaves the rest behind.
--
-- ORDER MATTERS. Run this only after the fix is deployed, then say it has run
-- so the cache epoch can be bumped and deployed. Without that last step, a
-- browser still holding the copied journal restores it on the next load.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. WHO HAS WHAT. Run this first and read it.
--
-- Two accounts whose trade ids are the same set are not a coincidence: the ids
-- are creation timestamps in milliseconds, so an identical list means one
-- journal, copied. `fingerprint` is that list, hashed — equal fingerprints are
-- the same journal.
select
  t.clerk_id,
  p.email,
  count(*)                                            as trades,
  min(t.date_iso)                                     as first_day,
  max(t.date_iso)                                     as last_day,
  md5(string_agg(t.id::text, ',' order by t.id))      as fingerprint
from journal_trades t
left join profiles p on p.clerk_id = t.clerk_id
where t.deleted_at is null
group by t.clerk_id, p.email
order by fingerprint, trades desc;

-- Any fingerprint appearing on more than one row is the leak. Decide which
-- clerk_id is the RIGHTFUL owner — normally the account whose email actually
-- traded them — and clean every OTHER account sharing that fingerprint.

-- ── 2. THE CLEANUP. Put the ids to empty in the list below.
--
-- Read it twice before running. This is a hard delete and does not undo. It
-- must not contain the rightful owner's id.
begin;

with victims(clerk_id) as (
  values
    ('PUT_THE_WRONG_ACCOUNT_ID_HERE')
    -- , ('AND_ANOTHER_IF_STEP_1_FOUND_ONE')
)
, d1 as (delete from journal_trades      where clerk_id in (select clerk_id from victims) returning 1)
, d2 as (delete from intelligence_trades where clerk_id in (select clerk_id from victims) returning 1)
, d3 as (delete from user_collections    where clerk_id in (select clerk_id from victims) returning 1)
, d4 as (delete from notebook_entries    where clerk_id in (select clerk_id from victims) returning 1)
, d5 as (delete from behavior_findings   where clerk_id in (select clerk_id from victims) returning 1)
select
  (select count(*) from d1) as journal_trades_deleted,
  (select count(*) from d2) as intelligence_trades_deleted,
  (select count(*) from d3) as collections_deleted,
  (select count(*) from d4) as notebook_deleted,
  (select count(*) from d5) as findings_deleted;

commit;

-- ── 3. Confirm. Re-run step 1: every remaining fingerprint should be unique.
