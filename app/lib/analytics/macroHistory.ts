// ─────────────────────────────────────────────────────────────────────────────
// Real macro events, recovered from the cache the app has already been keeping.
//
// lib/ai/macroCalendar pulls a public economic calendar (FairEconomy's
// ForexFactory-sourced weekly JSON) and writes each day's payload into
// macro_calendar_cache / macro_calendar_journal_cache, keyed by the Israel day
// it was fetched on. The coach reads today's row to say what is on the diary.
//
// Nobody had read the OLD rows. They are a genuine history: the journal feed
// pulls last + this + next week, so every daily row carries a three-week
// window, and a row written months ago still holds what actually happened in
// those weeks — with the real releases, the real impact ratings, and the
// `actual` values as they stood.
//
// That is a far better source for correlation than any rule this codebase
// could derive, and it costs one query. lib/analytics/macro still carries the
// first-Friday rule, and still earns its place: the cache can only know about
// days the app was running for, and a trader's history usually starts earlier.
//
// COVERAGE IS THE WHOLE PROBLEM
//
// A day with no cached payload is not a quiet day — it is a day we cannot see.
// Filing it under "nothing happened" would put FOMC afternoons in the control
// group and quietly flatten every difference the comparison exists to find.
//
// So coverage is built from the dates that appear in the payloads at ALL, at
// any impact level, and not from the range between the first and last row: the
// feed lists dozens of low-impact events on every weekday, so a weekday inside
// a cached window always shows up. A date that never appears was never
// fetched, and is `unknown` rather than quiet.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MacroEvent } from '../ai/macroCalendar';
import { isPrimaryEvent } from '../ai/macroCalendar';
import { logger } from '../logger';

/** What the pattern engine needs to slice on: which days carried a real event,
 *  and which days we are entitled to have an opinion about at all. */
export interface MacroContext {
  /** Israel dates carrying at least one high-impact USD release or bank
   *  holiday — the events that actually move index futures. */
  eventDays: Set<string>;
  /** Israel dates the cached feed covered, at any impact. Everything outside
   *  this is unknown and must be excluded, never counted as quiet. */
  coveredDays: Set<string>;
}

export const EMPTY_MACRO_CONTEXT: MacroContext = {
  eventDays: new Set(), coveredDays: new Set(),
};

/** Fold cached payloads into a context. Pure — the IO is the caller's.
 *
 *  Rows are snapshots taken on different days and overlap heavily; a date is
 *  an event date if ANY snapshot says so. A later snapshot carrying the same
 *  event with an `actual` value does not change the verdict, only the detail,
 *  so no de-duplication is needed for this question. */
export function buildMacroContext(payloads: MacroEvent[][]): MacroContext {
  const eventDays  = new Set<string>();
  const coveredDays = new Set<string>();
  for (const events of payloads) {
    if (!Array.isArray(events)) continue;
    for (const e of events) {
      const day = e?.dateIsrael;
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      coveredDays.add(day);
      if (isPrimaryEvent(e)) eventDays.add(day);
    }
  }
  return { eventDays, coveredDays };
}

/** How many daily snapshots to fold in.
 *
 *  Each row is a three-week window, so a few hundred rows is well over a year
 *  of overlapping coverage. The cap is here because the payloads are large and
 *  this runs inside a request that already has a model call ahead of it. */
export const MAX_CACHE_ROWS = 400;

/** Read the accumulated calendar cache and reduce it to a context.
 *
 *  Never throws. A missing table, an empty cache, or a failed query all give
 *  the empty context, which switches the event/quiet comparison off entirely
 *  rather than running it on air. Silence is the correct output when the data
 *  is not there — this is exactly the slice where a confident wrong answer
 *  costs the most. */
export async function loadMacroContext(supabase: SupabaseClient | null): Promise<MacroContext> {
  if (!supabase) return EMPTY_MACRO_CONTEXT;

  const payloads: MacroEvent[][] = [];
  // The journal cache first — it is the three-week pull, so it covers the most
  // ground per row. The coach's this-week cache is folded in after, since on
  // days the wider fetch failed it may be the only row written.
  for (const table of ['macro_calendar_journal_cache', 'macro_calendar_cache']) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('payload')
        .order('day', { ascending: false })
        .limit(MAX_CACHE_ROWS);
      if (error) { logger.warn('macro history query failed', { table, error: error.message }); continue; }
      for (const row of data ?? []) {
        if (Array.isArray(row?.payload)) payloads.push(row.payload as MacroEvent[]);
      }
    } catch (err) {
      logger.warn('macro history read threw', { table, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return buildMacroContext(payloads);
}
