// Every dtf- class the pickers render has a rule behind it.
//
// The same guard the dashboard stylesheet has, for the same reason: a
// stylesheet has no compiler. These two components are drawn ENTIRELY by this
// file — there is no browser default underneath them — so a missing rule is
// not a cosmetic slip, it is an unstyled list of numbers where a calendar
// should be, and nothing but a person opening the form would say so.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');

const CSS = read('components', 'form', 'datetime.css');
const SOURCES = [
  read('components', 'form', 'DateField.tsx'),
  read('components', 'form', 'TimeField.tsx'),
];

/** Class names used in the markup: className="…" and className={`…`}, plus
 *  the concatenated `'dtf-day' + (…)` form the calendar builds its cells with. */
function usedClasses(src: string): Set<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{([^}]*(?:\}[^}]*)*?)\})/g)) {
    for (const raw of (m[1] ?? m[2] ?? '').split(/[\s${}?:'"`+()]+/)) {
      const c = raw.trim();
      if (/^dtf-[\w-]+$/.test(c)) found.add(c);
    }
  }
  return found;
}

describe('the picker stylesheet covers what the pickers render', () => {
  it('has a rule for every dtf- class in the markup', () => {
    const missing: string[] = [];
    for (const src of SOURCES) {
      for (const c of usedClasses(src)) {
        // Word boundary, so dtf-day does not match dtf-days.
        if (!new RegExp(`\\.${c}(?![\\w-])`).test(CSS)) missing.push(c);
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds the classes at all, so an empty scan cannot pass as a clean one', () => {
    expect(usedClasses(SOURCES[0]).size).toBeGreaterThan(6);
    expect(usedClasses(SOURCES[1]).size).toBeGreaterThan(4);
  });

  // The state modifiers are appended as strings rather than written as whole
  // class names, so the scan above cannot see them. Named here instead.
  it('keeps the state rules the calendar reads through', () => {
    for (const rule of [
      '.dtf-day.is-today',   // where now is
      '.dtf-day.is-sel',     // what was chosen
      '.dtf-day.is-shut',    // the exchange was closed
      '.dtf-day.is-later',   // has not happened yet
      '.dtf-trigger.is-open',
      '.dtf-trigger.is-bad', // the field the error banner is about
      '.dtf-tick.is-on',     // the minute under the band
    ]) {
      expect(CSS).toContain(rule);
    }
  });

  // A day the calendar refuses is marked with aria-disabled rather than
  // disabled, so the arrow keys can still put the focus ring on it — a
  // disabled button cannot take focus, and the cursor moved on without it.
  // The stylesheet has to key off the same attribute, and it has to draw a
  // focus ring at all, or the keyboard cursor is invisible.
  it('draws the keyboard cursor the calendar relies on', () => {
    expect(SOURCES[0]).toContain('aria-disabled={later || shut}');
    expect(SOURCES[0]).not.toMatch(/\sdisabled=\{later/);
    expect(CSS).toContain('.dtf-day:focus-visible');
    expect(CSS).toContain(".dtf-day[aria-disabled='true']");
    // A :disabled rule here would silently stop matching.
    expect(CSS).not.toMatch(/\.dtf-day[^{]*:disabled/);
  });

  // The wheel's arithmetic is split across the two files, and nothing at
  // runtime notices when it stops adding up: the component scrolls a column
  // to `index * ITEM`, which centres the chosen row on the gold band only
  // while the padding rows are exactly half a column short of a row. Change
  // the column height in the stylesheet alone and every value sits a few
  // pixels off the band that is supposed to mark it — a picker that looks
  // right and reads wrong.
  it('keeps the wheel geometry the component scrolls by', () => {
    const px = (re: RegExp) => {
      const hit = re.exec(CSS);
      expect(hit, `no match for ${re}`).not.toBeNull();
      return Number(hit![1]);
    };
    const item = px(/\.dtf-tick\s*\{[^}]*height:\s*(\d+)px/);
    const pad = px(/\.dtf-pad\s*\{[^}]*height:\s*(\d+)px/);
    const wheel = px(/\.dtf-wheel\s*\{[^}]*height:\s*(\d+)px/);
    const band = px(/\.dtf-band\s*\{[^}]*height:\s*(\d+)px/);

    // The component's row height is the stylesheet's row height.
    expect(Number(/const ITEM = (\d+)/.exec(SOURCES[1])?.[1])).toBe(item);
    // A padding row fills the column above the centred one, exactly.
    expect(pad).toBe((wheel - item) / 2);
    // And the band is drawn the size of the row it marks.
    expect(band).toBe(item);
  });
});
