-- ─────────────────────────────────────────────────────────────────────────────
-- Trade form v2 — two columns the reordered form collects.
--
-- stop_move_tag  WHY the stop was advanced, on the branch of the question that
--                has a branch: breakeven | trailing | other. "Moved it" and
--                "moved it to lock in the entry" are not the same decision,
--                and only the second is a rule being kept.
--
-- stop_note      The trader's own words on the stop — where it sat and why
--                that level. Separate from `notes`, which answers why they
--                ENTERED. One textarea for two questions gets an answer to
--                neither.
--
-- Idempotent, like every other patch migration here: safe to re-run, and safe
-- to run before or after the app deploy (both columns are nullable, and the
-- reader defaults them to undefined).
-- ─────────────────────────────────────────────────────────────────────────────

alter table journal_trades add column if not exists stop_move_tag text;
alter table journal_trades add column if not exists stop_note     text;
