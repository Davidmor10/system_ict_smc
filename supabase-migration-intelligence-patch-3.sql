-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — Intelligence Pipeline, patch 3
--
-- Run AFTER patch 2. Idempotent — safe to run more than once.
--
-- One change, and it is about honesty rather than capability.
--
-- intelligence_trades.followed_rules was `not null default true`, and the
-- mirror hardcoded `true` because the journal had no such field. So every
-- trade in the table claims perfect rule adherence — a claim the trader never
-- made. Two consequences, both bad:
--
--   1. The rule-violation detector cannot fire. Not "rarely fires" — cannot,
--      on any data, ever.
--   2. Any adherence figure computed from this column reads 100%, which is
--      worse than having no figure at all: it is a flattering number with no
--      source.
--
-- The journal now asks the question directly, with three answers: yes, no,
-- and unanswered. This makes the column able to hold the third one.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Let the column say "I don't know".
-- ─────────────────────────────────────────────────────────────────────────────
alter table intelligence_trades alter column followed_rules drop default;
alter table intelligence_trades alter column followed_rules drop not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. Clear the fabricated verdicts.
--
-- Every existing `true` was written by the mirror's hardcoded default, not by
-- a trader grading their own trade. Keeping them would mean the first real
-- adherence rate is computed over a history of invented compliance — the
-- detector would look correct and be measuring nothing.
--
-- This is not recoverable, and it does not need to be: the value it deletes
-- was never information. Trades graded from here on carry a real answer.
--
-- If you have manually set any followed_rules values in SQL and want to keep
-- them, skip this statement.
-- ─────────────────────────────────────────────────────────────────────────────
update intelligence_trades set followed_rules = null where followed_rules is true;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. Verify. Expect is_nullable = YES, and graded_trades = 0 until you start
-- answering the question in the journal.
-- ─────────────────────────────────────────────────────────────────────────────
select
  (select is_nullable from information_schema.columns
    where table_name = 'intelligence_trades' and column_name = 'followed_rules') as is_nullable,
  (select count(*) from intelligence_trades where followed_rules is not null)    as graded_trades,
  (select count(*) from intelligence_trades)                                     as total_trades;
