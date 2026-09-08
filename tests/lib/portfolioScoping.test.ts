// Every screen reads one portfolio, and the ones that must not are named.
//
// WHY THIS IS A SOURCE-LEVEL TEST
//
// A screen that forgets to scope does not break. It silently averages two
// accounts into one win rate — the exact failure the whole feature exists to
// prevent — and nothing on screen says so. Scoping eight screens by hand works
// until the ninth is written, so the check is that no screen loads trades for
// itself at all.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Screens that legitimately read the WHOLE journal, and why. */
const UNSCOPED = new Map<string, string>([
  // An order id is unique across every portfolio, so a duplicate must be
  // looked for everywhere — and the importer writes the whole journal back.
  ['app/components/ImportWizard.tsx', 'duplicate check spans portfolios'],
  // Asks whether this account has ever logged anything at all.
  ['app/components/FirstRunGate.tsx', 'has this account any trades'],
  // Performs the one-time adoption when the first portfolio is created.
  ['app/components/PortfoliosView.tsx', 'backfills unassigned trades'],
  // The hook itself.
  ['app/components/useScopedTrades.ts', 'this is the scoping'],
]);

/** Comments are not calls. A file that only MENTIONS loadTrades in a note
 *  about why something is ordered the way it is has not read the journal. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|ts)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk('app').filter(f => f !== 'app/lib/journal.ts');

describe('no screen loads trades for itself', () => {
  it('leaves loadTrades and hydrateTradesFromCloud to the hook', () => {
    const offenders = files.filter(f => {
      if (UNSCOPED.has(f)) return false;
      const src = code(readFileSync(f, 'utf8'));
      return /\bloadTrades\(\)|\bhydrateTradesFromCloud\(\)/.test(src);
    });
    expect(offenders, `these read the journal unscoped: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every exception is a named one', () => {
    for (const [file, why] of UNSCOPED) {
      expect(why.length, file).toBeGreaterThan(10);
      expect(() => readFileSync(file, 'utf8')).not.toThrow();
    }
  });
});

describe('the screens that show trades', () => {
  const screens = [
    'app/components/DashboardView.tsx',
    'app/components/StatsView.tsx',
    'app/components/NotebookView.tsx',
    'app/(marketing)/components/MemberHome.tsx',
    'app/dashboard/journal/page.tsx',
    'app/dashboard/rules/page.tsx',
    'app/dashboard/playbook/page.tsx',
    'app/dashboard/ai-analytics/page.tsx',
  ];
  for (const s of screens) {
    it(`${s.split('/').pop()} asks the hook`, () => {
      expect(readFileSync(s, 'utf8')).toContain('useScopedTrades()');
    });
  }
});

describe('writing back', () => {
  const hook = readFileSync('app/components/useScopedTrades.ts', 'utf8');
  const journal = readFileSync('app/dashboard/journal/page.tsx', 'utf8');

  it('the journal saves and deletes from the WHOLE list', () => {
    // saveTrades replaces the journal wholesale and softDelete calls it
    // internally. Handing either the scoped subset persists one portfolio's
    // trades as the entire journal and deletes every other portfolio's without
    // a word. The type system caught exactly that during this conversion.
    expect(journal).toContain('const idx = all.findIndex');
    expect(journal).toContain('softDelete(all, id)');
    expect(journal).not.toContain('softDelete(trades, id)');
    expect(journal).not.toContain('saveTrades(');
  });

  it('the hook is the only writer a screen is offered', () => {
    expect(hook).toContain('saveAll');
    expect(hook).toContain('adoptAll');
    expect(hook).toContain('WRITE FROM THIS ONE, NEVER FROM `trades`');
  });
});

describe('nothing lands unassigned', () => {
  it('the form stamps the selected portfolio on a new trade', () => {
    const form = readFileSync('app/components/TradeForm.tsx', 'utf8');
    expect(form).toContain('portfolioId ? { accountId: portfolioId }');
  });

  it('the form never moves an existing trade between accounts', () => {
    const form = readFileSync('app/components/TradeForm.tsx', 'utf8');
    expect(form).toContain('initial?.accountId ? { accountId: initial.accountId }');
  });

  it('the first portfolio adopts the journal that predates it', () => {
    const view = readFileSync('app/components/PortfoliosView.tsx', 'utf8');
    expect(view).toContain('backfillAccountId(existing, p.id)');
    expect(view).toContain('portfolios.length === 0');
  });
});

describe('the home page counts one portfolio too', () => {
  it('mounts the provider, since it lives outside the dashboard shell', () => {
    // Without it this page would be the one place still averaging every
    // portfolio together.
    expect(readFileSync('app/(home)/page.tsx', 'utf8')).toContain('<PortfolioProvider>');
  });
});
