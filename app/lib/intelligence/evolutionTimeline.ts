// ─────────────────────────────────────────────────────────────────────────────
// Evolution Timeline — "Week 1: London Longs. Week 4: NY AM with IFVG. Week 9:
// edge weakened, new edge discovered." Built entirely from the hypothesis
// snapshot each weekly report already stores (weekly_ai_reports.
// primary_hypothesis_snapshot) — no separate history table needed. Pure:
// just condenses consecutive weeks sharing the same hypothesis into ranges.
// ─────────────────────────────────────────────────────────────────────────────

import type { EvolutionEntry, HypothesisSnapshot } from './types';

export interface WeeklyHypothesisRecord {
  isoWeek: string;
  weekStartDate: string; // YYYY-MM-DD, used purely for chronological ordering
  hypothesis: HypothesisSnapshot | null;
}

/** Pure: condenses a chronological list of per-week hypothesis snapshots into
    date ranges, so the same edge spanning several weeks reads as one entry
    instead of repeating itself. Two consecutive weeks belong to the same
    entry when their hypothesis `description` matches exactly (or both are
    null — "no clear edge yet" is itself a trackable state). */
export function buildEvolutionTimeline(records: WeeklyHypothesisRecord[]): EvolutionEntry[] {
  const sorted = [...records].sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
  const timeline: EvolutionEntry[] = [];

  for (const record of sorted) {
    const description = record.hypothesis?.description ?? null;
    const status = record.hypothesis?.status ?? 'insufficient_data';
    const last = timeline[timeline.length - 1];

    if (last && last.description === description) {
      last.toIsoWeek = record.isoWeek;
      last.status = status; // keep the most recent status for this stretch
    } else {
      timeline.push({ fromIsoWeek: record.isoWeek, toIsoWeek: record.isoWeek, description, status });
    }
  }

  return timeline;
}
