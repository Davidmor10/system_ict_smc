-- ─────────────────────────────────────────────────────────────────────────────
-- journal_trades.has_screenshot — a generated boolean
--
-- WHY
--
-- The intelligence layer reads every trade with `select('*')` on every
-- dashboard load. `screenshots` is a jsonb array of base64 data URLs, bounded
-- at 2 MB per image and 10 images per trade, and the only thing any analysis
-- does with it is ask whether the array is empty:
--
--   profile.ts:63   closed.filter(t => (t.screenshots?.length ?? 0) > 0)
--
-- So a trader who screenshots their trades pays for the entire image library
-- to cross the wire, be parsed into memory and be thrown away — every visit,
-- to answer one yes/no question per trade.
--
-- A generated column answers it in the database. The read then selects
-- everything EXCEPT the blobs, and the number the trader sees is unchanged.
--
-- STORED, not virtual: it is read on every dashboard load and written only when
-- a trade is saved.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table journal_trades
  add column if not exists has_screenshot boolean
  generated always as (
    screenshots is not null
    and jsonb_typeof(screenshots) = 'array'
    and jsonb_array_length(screenshots) > 0
  ) stored;

-- Verify: `with_screenshots` should match what the journal shows.
select
  count(*)                                      as trades_total,
  count(*) filter (where has_screenshot)        as with_screenshots
from journal_trades;
