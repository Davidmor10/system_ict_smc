-- ─────────────────────────────────────────────────────────────────────────────
-- intelligence_trades.stop_note — the trader's own sentence about the stop.
--
-- journal_trades already carries it (supabase-migration-stop-note.sql). This
-- is the mirror the coach pipeline actually reads, so without the column the
-- reasoning stops at the journal and never reaches the nightly note.
--
-- Idempotent and nullable: safe to run before or after the app deploy.
-- ─────────────────────────────────────────────────────────────────────────────

alter table intelligence_trades add column if not exists stop_note text;
