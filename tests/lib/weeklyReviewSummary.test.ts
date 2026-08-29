// The weekly behaviour panel rendered whatever it had, and on a normal week
// what it had was a progress bar and a "still unclear" list. Nothing said
// whether there WAS a conclusion — so a trader looking at a bar reasonably
// concluded the system had reached one and was not showing it.

import { describe, expect, it } from 'vitest';
import { summarizeWeeklyReview, type ReviewCounts } from '../../app/lib/weeklyReviewSummary';

const counts = (o: Partial<ReviewCounts> = {}): ReviewCounts =>
  ({ improved: 0, relapsed: 0, underTest: 0, moving: 0, unclear: 0, ...o });

describe('summarizeWeeklyReview', () => {
  it('says so when there is no review at all', () => {
    const s = summarizeWeeklyReview(null);
    expect(s.kind).toBe('none');
    expect(s.title).toContain('אין');
  });

  // The case from the screenshot: one window open, three behaviours still
  // being collected, and a panel that looked like it was hiding the answer.
  it('states plainly that a measurement is running and no conclusion exists', () => {
    const s = summarizeWeeklyReview(counts({ underTest: 1, unclear: 3 }));
    expect(s.kind).toBe('collecting');
    expect(s.title).toContain('אין מסקנה');
    expect(s.detail).toContain('3');
    expect(s.detail).toContain('לא לפני');
  });

  it('calls a week with nothing in it quiet, and defends that as an answer', () => {
    const s = summarizeWeeklyReview(counts());
    expect(s.kind).toBe('quiet');
    expect(s.detail).toContain('זו תשובה');
  });

  it('leads with the findings when there are any', () => {
    const s = summarizeWeeklyReview(counts({ improved: 1, relapsed: 2, underTest: 1 }));
    expect(s.kind).toBe('findings');
    expect(s.detail).toContain('התנהגות אחת השתפרה');
    expect(s.detail).toContain('2');
  });

  it('reads naturally at one and at many', () => {
    expect(summarizeWeeklyReview(counts({ underTest: 1 })).detail).toContain('התנהגות אחת נמצאת במדידה');
    expect(summarizeWeeklyReview(counts({ underTest: 2 })).detail).toContain('2 התנהגויות נמצאות במדידה');
  });

  it('never returns an empty headline', () => {
    for (const c of [null, counts(), counts({ moving: 1 }), counts({ unclear: 1 })]) {
      expect(summarizeWeeklyReview(c).title.length).toBeGreaterThan(0);
    }
  });
});
