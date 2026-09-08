// What the weekly report is allowed to claim — and the fact that it is now
// always written.
//
// The original bug: the empty state on screen said "at least 3 trades" while
// the gate required 5. The deeper bug, fixed here: there was a gate at all.
// Below five closed trades the service returned null, so a trader who took
// four trades in a week got no report and a threshold explained back to them
// instead. A week is now always written; the floor only decides whether the
// report may compare and conclude.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { MIN_TRADES_FOR_WEEKLY_CLAIMS } from '../../app/lib/intelligence/weeklyRules';

describe('the weekly threshold', () => {
  it('is a real number the gate can use', () => {
    expect(Number.isInteger(MIN_TRADES_FOR_WEEKLY_CLAIMS)).toBe(true);
    expect(MIN_TRADES_FOR_WEEKLY_CLAIMS).toBeGreaterThan(0);
  });

  it('is the number the service actually gates on', () => {
    const src = readFileSync('app/lib/intelligence/service.ts', 'utf8');
    expect(src).toContain("import { MIN_TRADES_FOR_WEEKLY_CLAIMS } from './weeklyRules'");
    expect(src).toContain('closedThisWeek.length < MIN_TRADES_FOR_WEEKLY_CLAIMS');
    // The old private copy must be gone, or the two can diverge again.
    expect(src).not.toMatch(/const MIN_TRADES_FOR_WEEKLY_CLAIMS\s*=\s*\d/);
  });

  it('never turns a thin week into no report at all', () => {
    const src = readFileSync('app/lib/intelligence/service.ts', 'utf8');
    // The line that used to end the function. Its return is now a written
    // report, and if `return null` ever comes back on this branch a
    // four-trade week goes silent again.
    expect(src).not.toMatch(/closedThisWeek\.length < MIN_TRADES_FOR_WEEKLY_CLAIMS\)\s*return null/);
    expect(src).toContain('factualWeeklyReport({');
  });

  it('does not let the panel gate the fetch on a trade count either', () => {
    // The second half of the same bug: even with the server writing a report,
    // a client that refuses to ask for it below three closed trades leaves
    // the new trader with the same blank card.
    const src = readFileSync('app/components/WeeklyReportPanel.tsx', 'utf8');
    expect(src).not.toContain('hasEnoughData');
  });

  it('does not count a factual week as prior history', () => {
    // Factual weeks are rows in the same table. Three quiet weeks in a row
    // must not read as an established history and lift the next report's
    // confidence on the strength of weeks that concluded nothing.
    const src = readFileSync('app/lib/intelligence/service.ts', 'utf8');
    expect(src).toContain('r.tradeCount >= MIN_TRADES_FOR_WEEKLY_CLAIMS');
  });

});

describe('what the capture rate is allowed to claim', () => {
  const page = readFileSync('app/dashboard/ai-analytics/page.tsx', 'utf8');

  it('never says the trade would have reached the target', () => {
    // The journal holds the exit price the trader typed. It does not hold the
    // chart, so it cannot know whether price later reached the target — only
    // where they got out relative to their own plan. The old wording,
    // "יוצא לפני שהן מגיעות ליעד", asserted the counterfactual.
    expect(page).not.toContain('לפני שהן מגיעות ליעד');
  });

  it('says outright what the number cannot see', () => {
    expect(page).toContain('לא רואה את הגרף');
  });
});
