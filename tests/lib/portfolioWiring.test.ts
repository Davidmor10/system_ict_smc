// Where the portfolio is read from, and where the limit is actually enforced.
//
// The entity is tested in portfolioTypes.test.ts. This file covers the wiring
// that a pure test cannot see: that the switcher scopes every screen, that the
// balance now comes from the portfolio rather than a global setting, and that
// the plan limit is enforced somewhere a browser cannot reach.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const layout    = readFileSync('app/dashboard/layout.tsx', 'utf8');
const sidebar   = readFileSync('app/components/Sidebar.tsx', 'utf8');
const switcher  = readFileSync('app/components/PortfolioSwitcher.tsx', 'utf8');
const provider  = readFileSync('app/components/PortfolioProvider.tsx', 'utf8');
const view      = readFileSync('app/components/PortfoliosView.tsx', 'utf8');
const store     = readFileSync('app/lib/portfolio/store.ts', 'utf8');
const api       = readFileSync('app/api/collections/route.ts', 'utf8');
const dashboard = readFileSync('app/components/DashboardView.tsx', 'utf8');
const stats     = readFileSync('app/components/StatsView.tsx', 'utf8');

describe('the shell', () => {
  it('hydrates the list once, above every screen', () => {
    expect(layout).toContain('<PortfolioProvider>');
    expect(layout).toContain('</PortfolioProvider>');
  });

  it('puts the switcher above the nav, not inside a settings page', () => {
    // It changes the meaning of every number below it.
    expect(sidebar).toContain('<PortfolioSwitcher />');
    expect(sidebar.indexOf('<PortfolioSwitcher />')).toBeLessThan(sidebar.indexOf('sb-nav'));
  });

  it('carries its own styles rather than a sibling\'s import', () => {
    expect(switcher).toContain("import './sidebar.css'");
  });
});

describe('the balance', () => {
  // The number that is wrong for everyone when it is a default, and wrong for
  // one account when it is shared. Two portfolios of different sizes do not
  // share an equity curve.
  it('comes from the portfolio on the dashboard, falling back to the setting', () => {
    expect(dashboard).toContain('portfolio?.startingBalanceUsd');
    expect(dashboard).toContain('settings.accountStartUsd');
  });

  it('comes from the portfolio on the stats page too', () => {
    expect(stats).toContain('portfolio?.startingBalanceUsd');
  });
});

describe('the limit', () => {
  it('is enforced on the server, not only in the button', () => {
    // /api/collections takes an arbitrary list from the browser. A cap the
    // client alone applies is not a cap.
    expect(api).toContain('portfolioLimit(role)');
    expect(api).toContain("kind === PORTFOLIOS_KIND");
    expect(api).toContain('status: 403');
  });

  it('does not count tombstones against the limit', () => {
    // A deleted portfolio stays in the stored array so the delete propagates.
    // Counting it would lock a Starter out of ever creating another one.
    expect(api).toContain("!== true");
    expect(api).toContain('deleted');
  });
});

describe('the selection', () => {
  it('is per device, not synced', () => {
    // A phone and a desktop may sit on different portfolios without fighting.
    expect(store).toContain('SELECTED_PORTFOLIO_KEY');
    expect(store).toContain('readOwned');
    expect(store).not.toContain('commitList(SELECTED');
  });

  it('reaches the rest of the tab without a reload', () => {
    expect(store).toContain('PORTFOLIO_CHANGED');
    expect(provider).toContain("window.addEventListener(PORTFOLIO_CHANGED");
  });
});

describe('what the screens refuse to do', () => {
  it('never offers to connect a portfolio before the list has answered', () => {
    // Offering that to someone who already has one is the worst thing here.
    expect(provider).toContain('ready');
    expect(switcher).toContain('if (!ready)');
    expect(view).toContain('!ready ?');
  });

  it('never proposes a name', () => {
    // "תיק 1" tells a trader nothing at the moment they have to pick one out
    // of a list, and a name they did not choose is one they will not recognise.
    expect(view).toContain("useState(initial?.name ?? '')");
  });

  it('never deletes on one click', () => {
    expect(view).toContain('typed.trim() === portfolio.name.trim()');
    expect(view).toContain('disabled={!matches}');
  });

  it('names what a delete takes with it', () => {
    // A confirmation that says only "are you sure" asks the trader to guess
    // the consequence.
    expect(view).toContain('העסקאות שלו, הסטטיסטיקות, הדפוסים, הדוחות והתובנות');
  });
});

describe('the three defects found by driving it', () => {
  const header = readFileSync('app/components/MobileHeader.tsx', 'utf8');

  it('does not seed state from localStorage in a useState initializer', () => {
    // Client components are server-rendered. The initializer ran once on the
    // server with no localStorage and again during hydration with it, so a
    // consumer rendering a number off the list produced different text on the
    // two passes. Measured in Chromium: React error #418, "the server rendered
    // text didn't match". The read moved into the effect.
    expect(provider).toContain('useState<Portfolio[]>([])');
    expect(provider).not.toContain('useState<Portfolio[]>(() => loadPortfoliosLocal())');
    expect(provider).toContain('setPortfolios(loadPortfoliosLocal())');
  });

  it('does not compute a plan limit from a role it could not resolve', () => {
    // free → limit 0 → every portfolio write answered "limit exceeded". The
    // silent-downgrade bug from getUserRole, re-created one layer up.
    expect(api).toContain('resolved: roleResolved');
    expect(api).toContain('if (!roleResolved)');
    expect(api).toContain("status: 503");
    expect(api).not.toContain('await getUserRole()');
  });

  it('gives a phone a way to see and change the portfolio', () => {
    // The rail is hidden below 880px, and the switcher with it — on the screen
    // size where a trader is most likely to be checking.
    expect(header).toContain('usePortfolios()');
    expect(header).toContain('/dashboard/portfolios');
    // The hardcoded "PRO" badge went with it: it said PRO to every account,
    // including a Starter's.
    expect(header).not.toContain('>\n          PRO\n        </span>');
  });
});
