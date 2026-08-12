-- ─────────────────────────────────────────────────────────────────────────────
-- Patch 4 — journal_trades.followed_rules
--
-- WHY
--
-- The form asks "עמדתי בחוקים?" and the answer travelled as far as the request
-- body, where zod deleted it: tradeEntrySchema is a z.object(), and a z.object()
-- strips every key it does not declare. Nothing errored. The trade saved, the
-- row wrote, and the one field the rule-violation detector cannot work without
-- was gone before any code that cared about it ran.
--
-- The schema is fixed in app/lib/validation.ts. This adds the column at the end
-- of the chain so the legacy journal table can carry the answer too — without
-- it, /api/journal GET reads back `undefined` and the next cross-device merge
-- would quietly erase a locally-answered trade.
--
-- NULLABLE, NO DEFAULT — on purpose. `not null default true` is what the
-- intelligence table had, and it meant every trade in the system claimed
-- perfect rule adherence, which the detector reads as "nothing to see".
-- Unanswered has to stay distinguishable from answered-yes.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table journal_trades add column if not exists followed_rules boolean;

-- Verify: graded should rise by one every time you answer the question on a
-- trade and save it.
select
  count(*)                                          as trades_total,
  count(*) filter (where followed_rules is not null) as graded,
  count(*) filter (where exits is not null)          as with_exits
from journal_trades;
