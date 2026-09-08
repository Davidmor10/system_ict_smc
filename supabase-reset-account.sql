-- ─────────────────────────────────────────────────────────────────────────────
-- FULL RESET OF ONE ACCOUNT'S TRADING RECORD AND EVERYTHING DERIVED FROM IT.
--
-- Run by hand in the Supabase SQL editor, one step at a time. IRREVERSIBLE.
--
-- WHY IT EXISTS
--
-- The owner's 34 logged trades were wrong, and every AI surface in the product
-- had already been built from them: a trader profile, tracked patterns, weekly
-- reports and their archive, behaviour findings and the open questions on them,
-- daily insights, and the current edge hypothesis. Deleting only the trades
-- would leave the system asserting things about trades that no longer exist —
-- so the derived layer goes with them, in one transaction.
--
-- WHAT IT DOES NOT TOUCH, deliberately. The KEEPS line below is read by
-- tests/lib/resetScript.test.ts, which cross-checks this file against the
-- account-purge list in app/api/webhooks/clerk/route.ts: every table that
-- belongs to a trader must be either deleted here or named here, so a new
-- AI table cannot be added later and quietly survive a reset.
--
--   · user_collections, user_preferences, trading_rules, setups — the
--     trader's configuration, not their record.
--   · notebook_entries / notebook_chunks — words they wrote.
--   · coach_chats — conversations they had. Their own words again.
--   · ai_usage_log — cost accounting. Deleting it would falsify the spend
--     history, and it holds no trading data.
--   · payment_requests — billing. Never.
--   · rate_limits, coach_generation_fallback — infrastructure counters.
--   · profiles — the account itself. This resets a journal, not a user.
--
-- KEEPS: user_collections user_preferences trading_rules setups
-- KEEPS: notebook_entries notebook_chunks coach_chats ai_usage_log
-- KEEPS: payment_requests rate_limits coach_generation_fallback profiles
--
-- Any of those can be moved across; they are one line each.
--
-- ⚠ AFTER STEP 2, BUMP CACHE_EPOCH IN app/lib/localOwner.ts AND DEPLOY.
--
-- Not optional, and the order is not negotiable. Every device holds a
-- localStorage copy of the journal, and hydration reads "the cloud is missing
-- what I have" as an OUTAGE, not a deletion — so the next page load would
-- helpfully restore all 34 trades. The epoch bump is how the operator says
-- "this was meant". Do not open the app between the two steps.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ STEP 1 · READ-ONLY. What is about to be deleted. ════════════════════════
-- Run this alone first. If the numbers are not what you expect, stop.

with me as (
  select clerk_id from profiles where lower(email) = lower('davidmor030908@gmail.com')
)
select 'journal_trades'          as table_name, count(*) from journal_trades          where clerk_id in (select clerk_id from me)
union all select 'intelligence_trades',     count(*) from intelligence_trades      where clerk_id in (select clerk_id from me)
union all select 'trades (legacy)',         count(*) from trades                   where clerk_id in (select clerk_id from me)
union all select 'rule_violations',         count(*) from rule_violations           where clerk_id in (select clerk_id from me)
union all select 'trader_profiles',         count(*) from trader_profiles           where clerk_id in (select clerk_id from me)
union all select 'user_profile',             count(*) from user_profile              where clerk_id in (select clerk_id from me)
union all select 'pattern_memory',          count(*) from pattern_memory            where clerk_id in (select clerk_id from me)
union all select 'weekly_ai_reports',       count(*) from weekly_ai_reports         where clerk_id in (select clerk_id from me)
union all select 'trader_hypotheses',       count(*) from trader_hypotheses         where clerk_id in (select clerk_id from me)
union all select 'ai_insight_history',      count(*) from ai_insight_history        where clerk_id in (select clerk_id from me)
union all select 'behavior_findings',       count(*) from behavior_findings         where clerk_id in (select clerk_id from me)
union all select 'behavior_finding_events', count(*) from behavior_finding_events   where clerk_id in (select clerk_id from me)
union all select 'daily_insights',          count(*) from daily_insights            where clerk_id in (select clerk_id from me)
union all select 'processing_jobs',         count(*) from processing_jobs           where clerk_id in (select clerk_id from me)
order by table_name;


-- ══ STEP 2 · DESTRUCTIVE. Deletes everything counted above. ═════════════════
-- One block, so it is one transaction: it all goes or none of it does.
--
-- An email that matches no account, or more than one, RAISES rather than
-- proceeding. The failure mode of a typo here has to be "nothing happened",
-- never "the wrong account".

do $$
declare
  uid   text;
  found int;
begin
  select count(*) into found from profiles where lower(email) = lower('davidmor030908@gmail.com');
  if found <> 1 then
    raise exception 'expected exactly one account for that email, found % — nothing deleted', found;
  end if;
  select clerk_id into uid from profiles where lower(email) = lower('davidmor030908@gmail.com');

  -- The trades.
  delete from journal_trades      where clerk_id = uid;
  delete from intelligence_trades where clerk_id = uid;
  delete from trades              where clerk_id = uid;   -- legacy table, usually empty
  delete from rule_violations     where clerk_id = uid;

  -- Everything built from them. Events go before findings: the foreign key
  -- cascades, but only for rows whose finding still exists, and an event
  -- orphaned by an earlier partial cleanup would survive the cascade.
  delete from behavior_finding_events where clerk_id = uid;
  delete from behavior_findings       where clerk_id = uid;
  delete from daily_insights          where clerk_id = uid;
  delete from weekly_ai_reports       where clerk_id = uid;
  delete from pattern_memory          where clerk_id = uid;
  delete from trader_hypotheses       where clerk_id = uid;
  delete from trader_profiles         where clerk_id = uid;
  -- The coach pipeline's own rolled-up profile. A separate table from
  -- trader_profiles, and derived from exactly the same trades.
  delete from user_profile            where clerk_id = uid;
  delete from ai_insight_history      where clerk_id = uid;

  -- Queued and finished work. Left behind, a pending job would regenerate an
  -- insight tonight from trades that no longer exist.
  delete from processing_jobs         where clerk_id = uid;

  raise notice 'reset complete for %', uid;
end $$;


-- ══ STEP 3 · VERIFY. Re-run STEP 1. Every count must be 0. ══════════════════
