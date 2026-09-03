// Every dp- class the dashboard renders has a rule behind it.
//
// This exists because of a specific accident, and the accident is the kind
// that ships: an edit to dp.css sliced from the middle of the file to a block
// that had been appended at the END of it, and took the 258 lines in between
// with it — the widget grid, the calendar, the macro panel, the AI card. Types
// passed. Lint passed. 1,613 tests passed. The build passed. The dashboard was
// a single unstyled column, and nothing said so until a person opened it.
//
// A stylesheet has no compiler. This is the compiler.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');

const CSS = read('components', 'dp.css');
const SOURCES = [
  read('components', 'DashboardView.tsx'),
  read('components', 'TraderSummary.tsx'),
];

/** Class names used in the markup: className="…" and className={`…`}. */
function usedClasses(src: string): Set<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const raw of (m[1] ?? m[2] ?? '').split(/[\s${}?:'"]+/)) {
      const c = raw.trim();
      if (c.startsWith('dp-')) found.add(c);
    }
  }
  return found;
}

describe('the dashboard stylesheet covers what the dashboard renders', () => {
  it('has a rule for every dp- class in the markup', () => {
    const missing: string[] = [];
    for (const src of SOURCES) {
      for (const c of usedClasses(src)) {
        // Word boundary, so dp-state does not match dp-state-head.
        if (!new RegExp(`\\.${c}(?![\\w-])`).test(CSS)) missing.push(c);
      }
    }
    expect(missing).toEqual([]);
  });

  // The specific rules whose loss produced the broken screen. Named
  // individually so a failure says which part of the page went flat rather
  // than only that a count changed.
  it('keeps the structural rules the layout collapses without', () => {
    for (const rule of [
      '.dp-app .dp-kpis',        // the widget grid
      '.dp-app .dp-body',        // the calendar + macro row
      '.dp-app .dp-col',
      '.dp-app .dp-control-row', // sessions + unit toggle
      '.dp-app .dp-cal-grid',
      '.dp-app .dp-macro',
      '.dp-app .dp-state',       // the claim at the top
    ]) {
      expect(CSS).toContain(rule);
    }
  });

  // The old tracking line was replaced, not renamed around. A leftover rule
  // for a component nobody renders is how a stylesheet starts lying about
  // what the page is.
  it('has no rules left for the component that was removed', () => {
    expect(CSS).not.toContain('dp-track');
  });
});
