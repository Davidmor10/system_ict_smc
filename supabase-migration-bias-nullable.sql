-- ═══════════════════════════════════════════════════════════════════════════
-- Onyx — journal_trades.bias: let "not answered" be storable.
--
-- WHY
--
-- The direction is an optional field on the trade. The column was
-- `not null default 'INDECISIVE'`, so a trader who left it blank was stored
-- as having answered "no directional view" — and on reopening that trade the
-- "ללא כיוון" chip came back SELECTED. An answer they never gave, shown back
-- to them as their own.
--
-- Same failure the codebase already fixed for `setup` (which defaulted to
-- REVERSAL) and for followed_rules (which defaulted to true): an absent
-- answer read as a positive one.
--
-- WHAT THIS DOES NOT DO
--
-- It does not repair history. Rows already holding 'INDECISIVE' stay as they
-- are, because nothing can now tell a trader who chose it from a trader who
-- left the field alone. Only new saves are honest.
--
-- ORDER
--
-- Safe to run before or after the deploy. The application sends 'INDECISIVE'
-- rather than null while the column still forbids null, and switches to null
-- on its own once this has run — so neither order can break saving a trade.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run.
--   Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table journal_trades alter column bias drop not null;
alter table journal_trades alter column bias drop default;

-- Verify: expect is_nullable = YES and column_default = null.
select column_name, is_nullable, column_default
from information_schema.columns
where table_name = 'journal_trades' and column_name = 'bias';
