// Every class the dashboard renders has a rule behind it.
//
// This exists because of a specific accident, and the accident is the kind
// that ships: an edit to the old dp.css sliced from the middle of the file to
// a block that had been appended at the END of it, and took the 258 lines in
// between with it — the widget grid, the calendar, the macro panel, the AI
// card. Types passed. Lint passed. 1,613 tests passed. The build passed. The
// dashboard was a single unstyled column, and nothing said so until a person
// opened it.
//
// The screen was rebuilt against a design handoff since, and the stylesheets
// changed with it. The guard did not: a stylesheet has no compiler, and this
// is the compiler.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');

const DASH_CSS = read('components', 'dashboard.css');
const SB_CSS = read('components', 'sidebar.css');
const CSS = DASH_CSS + '\n' + SB_CSS;

const SOURCES: Array<[string, string]> = [
  ['DashboardView', read('components', 'DashboardView.tsx')],
  ['TraderSummary', read('components', 'TraderSummary.tsx')],
  ['InsightSection', read('components', 'dashboard', 'InsightSection.tsx')],
  ['Sidebar', read('components', 'Sidebar.tsx')],
];

/** Class names the markup actually renders.
 *
 *  Reads className="…", className={`…`} and the concatenated
 *  `'dsh-day' + (cond ? ' is-x' : '')` form the calendar builds cells with,
 *  so a modifier appended at runtime is still seen. */
function usedClasses(src: string): Set<string> {
  const found = new Set<string>();
  const add = (raw: string) => {
    for (const c of raw.split(/[\s${}?:'"`+()[\],]+/)) {
      const t = c.trim();
      if (/^(dsh|sb)-[\w-]+$/.test(t)) found.add(t);
    }
  };
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) {
    add(m[1] ?? m[2] ?? '');
  }
  return found;
}

describe('the dashboard stylesheets cover what the dashboard renders', () => {
  it('has a rule for every dsh- and sb- class in the markup', () => {
    const missing: string[] = [];
    for (const [name, src] of SOURCES) {
      for (const c of usedClasses(src)) {
        // Word boundary, so .dsh-day does not satisfy .dsh-days.
        if (!new RegExp(`\\.${c}(?![\\w-])`).test(CSS)) missing.push(`${name}: .${c}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds the classes at all, so an empty scan cannot pass as a clean one', () => {
    for (const [name, src] of SOURCES) {
      expect(usedClasses(src).size, name).toBeGreaterThan(3);
    }
  });

  // The rules whose loss produced the broken screen, named individually so a
  // failure says which part of the page went flat rather than only that a
  // count changed.
  it('keeps the structural rules the layout collapses without', () => {
    for (const rule of [
      '.dsh-main',        // the vertical rhythm of the whole page
      '.dsh-greet',       // greeting + clock
      '.dsh-split',       // balance | metrics
      '.dsh-metrics',     // the metric grid itself
      '.dsh-insight',     // the note + rail two-column panel
      '.dsh-rail',
      '.dsh-wide',        // journal | macro
      '.dsh-cal',         // the calendar grid
      '.dsh-panel',       // the summary
      '.sb',              // the rail's own frame
      '.sb-nav',
    ]) {
      expect(CSS, rule).toContain(rule);
    }
  });

  // Modifier classes are appended as strings rather than written whole, so the
  // scan above cannot see them.
  it('keeps the state rules the markup appends at runtime', () => {
    for (const rule of [
      '.dsh-day.is-profit',
      '.dsh-day.is-loss',
      '.dsh-day.is-out',
      '.dsh-card.is-win',
      '.dsh-card2.is-pair',
      '.dsh-chip.is-gold',
      '.dsh-chip.is-plain',
      '.dsh-bloom.is-greet',
      '.dsh-bloom.is-balance',
      '.dsh-bloom.is-insight',
      ".dsh-sess[aria-pressed='true']",
      ".dsh-unit[aria-pressed='true']",
      '.sb-item.is-active',
      '.sb-item.is-locked',
      '.sb-item.is-child',
    ]) {
      expect(CSS, rule).toContain(rule);
    }
  });

  // A number, a currency or a time inside the RTL tree has to be isolated or
  // the bidi algorithm reorders it: "+$242.50" renders as "$242.50+". The
  // class is the isolation, so it has to exist and it has to be used.
  it('isolates the runs of digits the RTL tree would otherwise reorder', () => {
    expect(CSS).toContain('.dsh-ltr');
    expect(CSS).toMatch(/\.dsh-ltr\s*\{[^}]*unicode-bidi:\s*isolate/);
    const view = SOURCES[0][1];
    for (const anchor of ['dsh-balance-v dsh-ltr', 'dsh-clock-v dsh-ltr', 'dsh-day-n dsh-ltr']) {
      expect(view, anchor).toContain(anchor);
    }
  });

  // The design is borderless by construction — depth is shadow only. A border
  // creeping in is the single change that would make it look like a different
  // page, and it is the sort of thing added while fixing something else.
  it('draws depth with shadow, never with a border', () => {
    const borders = [...DASH_CSS.matchAll(/^\s*border:\s*([^;]+);/gm)]
      .map(m => m[1].trim())
      .filter(v => v !== 'none');
    expect(borders).toEqual([]);
  });
});

// ── the preference that erased itself ───────────────────────────────────────
//
// The read and the write of the trader's chosen metric set are two effects in
// one mount flush. The read fires first and QUEUES its state; the write fires
// straight after with the default still in scope and puts it over the stored
// value, so the next mount reads back that default. Under React's development
// double-invoke the next mount is immediate, so it happened on every load:
// eleven cards chosen, eight after a refresh, and localStorage holding the
// eight it had just overwritten itself with. Measured, not reasoned about.
//
// A ref set at the end of the read effect does NOT fix it — it is already true
// when the write effect runs in that same flush. It has to be state, so the
// flip forces a render and the first write sees what the read installed.

describe('the dashboard does not overwrite the preference it is about to read', () => {
  const VIEW = read('components', 'DashboardView.tsx');

  it('gates both writes on a state flag, not a ref', () => {
    expect(VIEW).toContain('const [ready, setReady] = useState(false)');
    expect(VIEW).toContain('if (ready) writeOwned(UNIT_KEY, unit)');
    expect(VIEW).toContain('if (ready) writeOwned(CARDS_KEY, cards)');
    // A ref here is the same bug with an extra line.
    expect(VIEW).not.toMatch(/hydrated\.current/);
  });

  it('keeps the flag in the write effects\u2019 dependencies', () => {
    // Without `ready` in the deps the effect never re-runs when it flips, and
    // the first real write is skipped instead of merely delayed.
    expect(VIEW).toContain('}, [ready, unit]);');
    expect(VIEW).toContain('}, [ready, cards]);');
  });

  it('never lets the trader empty the metric column', () => {
    // An empty column has no affordance to bring anything back.
    expect(VIEW).toContain('cs.length > 1 ? cs.filter');
  });
});
