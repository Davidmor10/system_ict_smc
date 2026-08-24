// ─────────────────────────────────────────────────────────────────────────────
// Which rules the trader actually breaks — by name, not by count.
//
// The behaviour layer already knows THAT rules get broken: the trade form asks
// "did you keep your rules", and a `no` becomes a rule_violation occurrence.
// That is one bit of information, and a coach working from one bit can only
// ever repeat itself.
//
// The trade form also asks WHICH rules, and has done for weeks. This turns
// those ticks into the sentence the trader can act on: not "you deviated in 3
// of 11 trades" but "the rule you break is the one about waiting for
// confirmation — six times, most recently on Tuesday".
//
// Pure. Rows in, ranking out.
// ─────────────────────────────────────────────────────────────────────────────

import type { StoredBreach } from '../db/collections';

export interface RuleBreach {
  /** The trader's own wording, trimmed to a line. */
  rule: string;
  count: number;
  /** ISO date of the most recent breach — "still happening" and "stopped two
   *  months ago" are different findings and must not read the same. */
  lastDate: string;
}

/** How far back to count. A rule broken twice last winter is history; the note
 *  is about the trader in front of it. */
const WINDOW_DAYS = 60;

/** Enough of a list to see a shape, short enough to stay a sentence. */
const MAX_RULES = 4;

export function rankRuleBreaches(
  rules: Map<string, string>,
  breaches: readonly StoredBreach[],
  today: string,
): RuleBreach[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
  const from = cutoff.toISOString().slice(0, 10);

  const byRule = new Map<string, { count: number; lastDate: string }>();
  for (const b of breaches) {
    // A breach whose rule has since been deleted is dropped rather than shown
    // under its id. The trader cannot act on a rule they no longer keep.
    const title = rules.get(b.ruleId);
    if (!title || b.date < from || b.date > today) continue;
    const cur = byRule.get(title) ?? { count: 0, lastDate: b.date };
    cur.count += 1;
    if (b.date > cur.lastDate) cur.lastDate = b.date;
    byRule.set(title, cur);
  }

  return [...byRule.entries()]
    .map(([rule, v]) => ({ rule: rule.slice(0, 120), count: v.count, lastDate: v.lastDate }))
    .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1))
    .slice(0, MAX_RULES);
}

export const __internals = { WINDOW_DAYS, MAX_RULES };
