// The diagnostics surfaces show two kinds of value in one column: identifiers,
// emails and counts, which are left-to-right, and sentences, which are Hebrew.
// Both were forced to dir="ltr" — right for an id, and wrong for anything with
// a Hebrew word in it, which renders reordered. A two-letter answer like כן
// came out unreadable.

import { describe, expect, it } from 'vitest';
import { hasHebrew } from '../../app/lib/text/direction';

describe('hasHebrew', () => {
  it('is true for the short answers that were rendering backwards', () => {
    expect(hasHebrew('כן')).toBe(true);
    expect(hasHebrew('לא')).toBe(true);
    expect(hasHebrew('לא ניתן לספור')).toBe(true);
  });

  // Mixed values are the ones that actually broke: a Hebrew sentence with a
  // clerk id or a number inside it needs an RTL base, and the Latin run
  // inside it then renders correctly on its own.
  it('is true when Hebrew is mixed with Latin or digits', () => {
    expect(hasHebrew('3 פריטים · user_3Ew1DpTb')).toBe(true);
    expect(hasHebrew('3 (הקוד מצפה ל־3)')).toBe(true);
    expect(hasHebrew('ללא בעלים (נכתב לפני התיקון)')).toBe(true);
  });

  it('is false for the values that really are left-to-right', () => {
    expect(hasHebrew('user_3Ew1DpTb4PKwMUJmnRt6esz53vi')).toBe(false);
    expect(hasHebrew('davidmor030908@gmail.com')).toBe(false);
    expect(hasHebrew('journal_trades')).toBe(false);
    expect(hasHebrew('61')).toBe(false);
    expect(hasHebrew('—')).toBe(false);
  });
});
