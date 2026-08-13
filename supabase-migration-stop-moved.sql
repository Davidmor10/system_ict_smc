-- ─────────────────────────────────────────────────────────────────────────────
-- stop_moved — what happened to the stop after entry
--
-- WHY THREE VALUES AND NOT A BOOLEAN
--
-- "Did you move your stop" merges the two opposite acts in trade management.
-- Advancing a stop to protect a position is discipline. Widening it to avoid
-- being stopped out is the thing that empties accounts. A boolean counts them
-- together, and a detector built on it would be measuring nothing.
--
--   none      the stop stayed where it was set
--   advanced  moved toward the entry / into profit
--   widened   moved away from the entry, giving the trade more room
--
-- NULL means the trader didn't answer, and that is not "none" — an unanswered
-- trade is invisible to the detector rather than counted as clean. Same rule
-- as followed_rules, for the same reason: silence read as compliance is how a
-- discipline number becomes a flattering fiction.
--
-- WHY IT IS ASKED RATHER THAN COMPUTED
--
-- The tables keep one stop value, not a history of edits, so a widened stop is
-- indistinguishable from a stop that was always there. Until the journal
-- versions the field on write, the trader is the only witness.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table journal_trades
  add column if not exists stop_moved text
  check (stop_moved in ('none', 'advanced', 'widened'));

alter table intelligence_trades
  add column if not exists stop_moved text
  check (stop_moved in ('none', 'advanced', 'widened'));

-- Verify.
select
  count(*)                                          as trades_total,
  count(*) filter (where stop_moved is not null)    as answered,
  count(*) filter (where stop_moved = 'widened')    as widened
from journal_trades;
