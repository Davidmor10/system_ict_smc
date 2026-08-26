-- ─────────────────────────────────────────────────────────────────────────────
-- cron_runs — what the nightly reconciliation found
--
-- WHY
--
-- The nightly cron already writes a row per run: when it started, how long it
-- took, how many jobs completed and failed. Nothing has ever read that table.
-- A failed run left a record nobody opened, and the log line naming it expired
-- an hour later on this plan.
--
-- The settings page reads it now, which makes the columns matter: a run that
-- says "ok" while silently repairing ten rows every night is not healthy, it
-- is a symptom being papered over. So the repair counts belong on the row
-- beside the job counts, not only in a log.
--
--   repaired_missing  trades live in journal_trades that the analysis layer
--                     could not see, re-mirrored by this run
--   repaired_ghosts   trades deleted in the journal that the analysis layer
--                     was still counting, tombstoned by this run
--   orphans           rows in intelligence_trades with no journal row behind
--                     them. REPORTED ONLY — the reconciler never deletes, so
--                     this number is expected to stay put until a human looks
--
-- Nullable with no default on purpose: a NULL means "this run predates the
-- reconciler", and a 0 means "it ran and found nothing". Defaulting to 0 would
-- merge those two into a reassuring lie about every historical row.
--
-- The writer works before and after this migration — it drops the three
-- columns and retries when PostgREST reports them missing — so applying it is
-- not urgent and running the app without it loses only these three numbers.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table cron_runs add column if not exists repaired_missing integer;
alter table cron_runs add column if not exists repaired_ghosts  integer;
alter table cron_runs add column if not exists orphans          integer;

-- Verify: the most recent runs, with the new columns present and empty.
select started_at, jobs_completed, jobs_failed,
       repaired_missing, repaired_ghosts, orphans, error
from cron_runs
order by started_at desc
limit 5;
