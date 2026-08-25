// The confirmation-tag catalogue.
//
// The tags were never at risk — they are written onto every trade and travel
// with it. What was device-only was the vocabulary, and the damage that caused
// is subtle: a trader who retypes "IFVG 1m" on their phone after inventing
// "IFVG 1M" on their laptop ends up with two tags, each holding half a
// history. Neither half clears a sample floor, neither surfaces a pattern, and
// nothing anywhere says the two belong together. A split sample is worse than
// a missing one because it looks like data.
//
// These tests are about that split, and about the migration not losing anyone's
// existing vocabulary on the way to the cloud.

import { describe, it, expect } from 'vitest';
import {
  normalizeTag,
  migrateLegacy,
  addTag,
  removeTag,
  chipList,
  DEFAULT_CONFIRMATIONS,
  type CustomConfirmation,
} from '../../app/lib/confirmationTags';

const row = (tag: string): CustomConfirmation => ({ id: tag, tag, updatedAt: 1 });

describe('normalizeTag', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTag('  IFVG   1M  ')).toBe('IFVG 1M');
  });

  it('leaves case alone', () => {
    // Deliberate. "Sweep" and "SWEEP" might mean two things to the trader who
    // typed them; a stray double space never does. Duplicate detection is
    // case-insensitive, which prevents the split without overruling spelling.
    expect(normalizeTag('Silver Bullet')).toBe('Silver Bullet');
    expect(normalizeTag('SWEEP')).toBe('SWEEP');
  });

  it('reduces an all-whitespace tag to nothing', () => {
    expect(normalizeTag('   ')).toBe('');
  });
});

describe('migrateLegacy', () => {
  it('turns the old string list into rows keyed by the tag itself', () => {
    // The tag IS the id. Generating one would give two devices that each
    // invented "Silver Bullet" two rows and a duplicate chip.
    const rows = migrateLegacy(['Silver Bullet', 'IFVG 1M']);
    expect(rows.map(r => r.id)).toEqual(['Silver Bullet', 'IFVG 1M']);
    expect(rows.every(r => r.id === r.tag)).toBe(true);
  });

  it('drops built-ins so they cannot become deletable rows', () => {
    const rows = migrateLegacy(['SMT', 'IFVG', 'Silver Bullet']);
    expect(rows.map(r => r.tag)).toEqual(['Silver Bullet']);
  });

  it('drops a built-in written in another case', () => {
    expect(migrateLegacy(['smt', 'Ifvg'])).toHaveLength(0);
  });

  it('collapses a case-split that already happened on the device', () => {
    // THE REGRESSION THIS FEATURE EXISTS FOR. Two spellings, one meaning, one
    // chip — the first spelling wins because it is the one already written on
    // the trades.
    const rows = migrateLegacy(['IFVG 1M', 'IFVG 1m', 'ifvg 1M']);
    expect(rows).toHaveLength(1);
    expect(rows[0].tag).toBe('IFVG 1M');
  });

  it('drops blanks and whitespace-only entries', () => {
    expect(migrateLegacy(['', '   ', 'Real'])).toHaveLength(1);
  });

  it('returns nothing for an empty legacy list', () => {
    expect(migrateLegacy([])).toEqual([]);
  });

  it('stamps updatedAt so the first sync wins over an empty cloud row', () => {
    const rows = migrateLegacy(['Silver Bullet'], 12345);
    expect(rows[0].updatedAt).toBe(12345);
  });
});

describe('addTag', () => {
  it('appends a new tag', () => {
    const out = addTag([row('A')], 'B');
    expect(out?.map(c => c.tag)).toEqual(['A', 'B']);
  });

  it('normalizes on the way in', () => {
    const out = addTag([], '  IFVG   5M ');
    expect(out?.[0].tag).toBe('IFVG 5M');
  });

  it('refuses a duplicate regardless of case', () => {
    expect(addTag([row('IFVG 1M')], 'ifvg 1m')).toBeNull();
  });

  it('refuses a built-in, so it cannot be shadowed by a custom row', () => {
    expect(addTag([], 'SMT')).toBeNull();
    expect(addTag([], 'smt')).toBeNull();
  });

  it('refuses an empty tag', () => {
    expect(addTag([], '   ')).toBeNull();
  });

  it('returns a new array rather than mutating the old one', () => {
    const before = [row('A')];
    const after = addTag(before, 'B');
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe('removeTag', () => {
  it('removes only the exact tag', () => {
    const out = removeTag([row('A'), row('B')], 'A');
    expect(out.map(c => c.tag)).toEqual(['B']);
  });

  it('leaves the list alone when the tag is not there', () => {
    expect(removeTag([row('A')], 'Z').map(c => c.tag)).toEqual(['A']);
  });
});

describe('chipList', () => {
  it('puts the built-ins first, then the trader’s own', () => {
    const chips = chipList([row('Silver Bullet')]);
    expect(chips.slice(0, DEFAULT_CONFIRMATIONS.length)).toEqual([...DEFAULT_CONFIRMATIONS]);
    expect(chips.at(-1)).toBe('Silver Bullet');
  });

  it('never renders two chips that mean the same built-in', () => {
    // An old catalogue may hold "smt" from before built-ins were filtered out.
    // It must not appear beside "SMT".
    const chips = chipList([row('smt')]);
    expect(chips.filter(c => c.toLowerCase() === 'smt')).toHaveLength(1);
  });

  it('is just the built-ins when the trader has added nothing', () => {
    expect(chipList([])).toEqual([...DEFAULT_CONFIRMATIONS]);
  });
});
