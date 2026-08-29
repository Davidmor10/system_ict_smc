// The weekly report's entry rule.
//
// The bug: the empty state on screen said "at least 3 trades" while the gate
// required 5. A trader with four closed trades this week was told the report
// would appear, and then watched it not appear with nothing to explain the
// gap. The number now lives in one module that both the gate and the message
// read, so they cannot drift apart again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { MIN_TRADES_FOR_WEEKLY } from '../../app/lib/intelligence/weeklyRules';

describe('the weekly threshold', () => {
  it('is a real number the gate can use', () => {
    expect(Number.isInteger(MIN_TRADES_FOR_WEEKLY)).toBe(true);
    expect(MIN_TRADES_FOR_WEEKLY).toBeGreaterThan(0);
  });

  it('is the number the service actually gates on', () => {
    const src = readFileSync('app/lib/intelligence/service.ts', 'utf8');
    expect(src).toContain("import { MIN_TRADES_FOR_WEEKLY } from './weeklyRules'");
    expect(src).toContain('closedThisWeek.length < MIN_TRADES_FOR_WEEKLY');
    // The old private copy must be gone, or the two can diverge again.
    expect(src).not.toMatch(/const MIN_TRADES_FOR_WEEKLY\s*=\s*\d/);
  });

  it('is the number the empty state shows, rather than a retyped one', () => {
    // The empty state moved out of the panel into its own module when it grew
    // from one message into three. The guarantee is unchanged: it reads the
    // threshold, it does not retype it.
    const src = readFileSync('app/lib/intelligence/weeklyEmpty.ts', 'utf8');
    expect(src).toContain("import { MIN_TRADES_FOR_WEEKLY } from './weeklyRules'");
    expect(src).toContain('${MIN_TRADES_FOR_WEEKLY}');
    expect(src).not.toMatch(/const MIN_TRADES_FOR_WEEKLY\s*=\s*\d/);
    expect(src).not.toContain('לפחות 3 עסקאות');
  });

  it('tells the reader the window is this week only', () => {
    // The half traders miss: a full journal counts for nothing here, because
    // the report compares this week against the last one.
    const src = readFileSync('app/lib/intelligence/weeklyEmpty.ts', 'utf8');
    expect(src).toContain('השבוע הנוכחי בלבד');
  });

  // A week the trader deliberately sat out is not a failure to feed the
  // machine, and the panel must not read like one.
  it('does not tell a trader who took nothing that they are missing trades', () => {
    const src = readFileSync('app/lib/intelligence/weeklyEmpty.ts', 'utf8');
    expect(src).toContain('לא סחרת השבוע');
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
