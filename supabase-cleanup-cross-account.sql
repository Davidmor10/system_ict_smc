-- ─────────────────────────────────────────────────────────────────────────────
-- One-off cleanup: rows written into the WRONG account by the localStorage
-- leak (see app/lib/localOwner.ts and app/lib/sync/owned.ts).
--
-- The leak copied one account's journal into another's rows. The code fix
-- stops it happening again; it cannot un-write what was already written,
-- because on the device that data now legitimately belongs to the account
-- that received it.
--
-- ORDER MATTERS. Run this ONLY after the fix is deployed, and tell me when it
-- has run so I can bump CACHE_EPOCH and deploy again. Skipping that last step
-- means every browser still holding the copied journal restores it into the
-- cloud on the next load — which is what happened the first time.
--
-- Replace the id below with the account whose rows are to be emptied.
-- Nothing here touches any other account.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. LOOK FIRST. Run this alone and read the counts before going further.
select 'journal_trades'      as t, count(*) from journal_trades      where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii'
union all
select 'intelligence_trades' as t, count(*) from intelligence_trades where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii'
union all
select 'user_collections'    as t, count(*) from user_collections    where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii'
union all
select 'notebook_entries'    as t, count(*) from notebook_entries    where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';

-- ── 2. Only if the counts above are the copied rows and nothing the account
--       actually created itself. This is a hard delete and does not undo.
begin;

delete from journal_trades      where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';
delete from intelligence_trades where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';
delete from user_collections    where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';
delete from notebook_entries    where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';

-- Derived analysis built on the copied trades. Harmless if the tables are
-- already empty for this account.
delete from behavior_findings   where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';

commit;

-- ── 3. Confirm it is empty, then tell me. The epoch bump is the last step and
--       it is mine to make.
select 'journal_trades'      as t, count(*) from journal_trades      where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii'
union all
select 'intelligence_trades' as t, count(*) from intelligence_trades where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii'
union all
select 'user_collections'    as t, count(*) from user_collections    where clerk_id = 'user_3IdiEuQI5Q7iQuLZKTno37P20Ii';
