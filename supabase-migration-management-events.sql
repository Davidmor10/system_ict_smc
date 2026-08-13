-- ─────────────────────────────────────────────────────────────────────────────
-- management — what happened between entry and exit, with timestamps
--
-- WHY
--
-- The journal has always kept one stop value and one target value: the ones
-- true at the last save. That describes a plan and says nothing about its
-- management, because a stop widened at 10:42 is indistinguishable from a stop
-- that was always there. Everything the trader did mid-trade was invisible.
--
-- Each element is:
--
--   { "at": "2026-08-13T10:42:00Z",   -- when it was recorded
--     "kind": "stop" | "target" | "partial",
--     "to": 29875.5,                  -- the new level, or the partial's price
--     "contracts": 1,                 -- partials only
--     "note": "..." }                 -- optional, the trader's words
--
-- WHAT IT UNLOCKS
--
-- stop_moved is the trader's report — honest, and collected after the fact,
-- with the same drift as every after-the-fact answer. These are a record made
-- at the time, and from them the direction is COMPUTED: for a long a higher
-- stop is protective, for a short it is the reverse.
--
-- Both are kept, and the code never merges them into one number that hides
-- which it used. A claim built on a record and a claim built on a recollection
-- are different claims.
--
-- jsonb and not a table, on purpose: `exits` already works this way, the events
-- are only ever read with their trade, and a second table would be a second
-- thing to keep in sync with intelligence_trades.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table journal_trades       add column if not exists management jsonb;
alter table intelligence_trades  add column if not exists management jsonb;

-- Verify.
select
  count(*)                                                        as trades_total,
  count(*) filter (where jsonb_array_length(coalesce(management, '[]'::jsonb)) > 0) as with_events
from journal_trades;
