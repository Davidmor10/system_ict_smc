// The portfolio entity and the rules around it.
//
// `TradeEntry.accountId` had existed since launch as an optional string with
// "Prop Firm Mode" named in the comments around it, and neither was ever
// built. It becomes load-bearing now: a trader with a $50,000 account and a
// $25,000 account does not have one journal with two labels — they have two
// records that must never be averaged together.

import { describe, expect, it } from 'vitest';
import {
  PORTFOLIO_LIMIT, STAGED_PORTFOLIO_CAP, portfolioLimit, canAddPortfolio,
  normalizePortfolio, newPortfolio, validatePortfolio, resolveSelected,
  MIN_BALANCE_USD, balanceFromName, type Portfolio,
} from '../../app/lib/portfolio/types';

const pf = (over: Partial<Portfolio> = {}): Portfolio => ({
  id: 'pf_1', name: 'DEMO', source: 'tradingview', timezone: 'Asia/Jerusalem',
  startingBalanceUsd: 50_000, createdAt: 1_000, ...over,
});

describe('plan limits', () => {
  it('ranks the plans the way the product does', () => {
    expect(PORTFOLIO_LIMIT.free).toBe(0);
    expect(PORTFOLIO_LIMIT.starter).toBe(1);
    expect(PORTFOLIO_LIMIT.pro).toBe(3);
    expect(PORTFOLIO_LIMIT.deluxe).toBe(Number.POSITIVE_INFINITY);
  });

  it('is no longer capped, now that both halves are scoped', () => {
    // Held at 1 while the analysis still read every trade — main deploys on
    // every push, so the entity and the importer went live before the split
    // and a second portfolio would have been the same mixed journal with a
    // label on it. Every screen and the server now read one account.
    expect(STAGED_PORTFOLIO_CAP).toBe(Number.POSITIVE_INFINITY);
    expect(portfolioLimit('deluxe')).toBe(Number.POSITIVE_INFINITY);
    expect(portfolioLimit('pro')).toBe(3);
    expect(portfolioLimit('starter')).toBe(1);
  });

  it('still refuses a free account outright', () => {
    expect(portfolioLimit('free')).toBe(0);
    expect(canAddPortfolio(0, 'free').ok).toBe(false);
  });

  it('separates "your plan says one" from "only one is supported yet"', () => {
    // Different facts. Telling a Deluxe subscriber to upgrade would be
    // nonsense, and telling a Starter the feature is not ready would be false.
    const starter = canAddPortfolio(1, 'starter');
    expect(starter.ok).toBe(false);
    if (!starter.ok) {
      expect(starter.reason).toBe('plan');
      expect(starter.message).toContain('מסלול');
    }
    // Deluxe is unlimited, so it is never refused at all.
    expect(canAddPortfolio(50, 'deluxe').ok).toBe(true);
    // Pro stops at three, and stops for a plan reason rather than a staged one.
    const pro = canAddPortfolio(3, 'pro');
    expect(pro.ok).toBe(false);
    if (!pro.ok) expect(pro.reason).toBe('plan');
  });

  it('lets the first one through on every paid plan', () => {
    for (const role of ['starter', 'pro', 'deluxe'] as const) {
      expect(canAddPortfolio(0, role).ok).toBe(true);
    }
  });
});

describe('normalizePortfolio', () => {
  it('rejects anything without an id', () => {
    expect(normalizePortfolio(null)).toBeNull();
    expect(normalizePortfolio({})).toBeNull();
    expect(normalizePortfolio({ id: '  ' })).toBeNull();
  });

  it('never invents an account size', () => {
    // A silent 25,000 here is the exact bug the first-run setup exists to
    // prevent, reintroduced one layer down: a balance nobody chose, anchoring
    // an equity curve and a drawdown.
    expect(normalizePortfolio({ id: 'a' })!.startingBalanceUsd).toBe(0);
    expect(normalizePortfolio({ id: 'a', startingBalanceUsd: 'lots' })!.startingBalanceUsd).toBe(0);
    expect(normalizePortfolio({ id: 'a', startingBalanceUsd: -5 })!.startingBalanceUsd).toBe(0);
    expect(normalizePortfolio({ id: 'a', startingBalanceUsd: 50000 })!.startingBalanceUsd).toBe(50_000);
  });

  it('keeps a tombstone a tombstone', () => {
    expect(normalizePortfolio({ id: 'a', deleted: true })!.deleted).toBe(true);
    expect(normalizePortfolio({ id: 'a' })!.deleted).toBeUndefined();
  });

  it('falls back to the app clock when the zone is missing', () => {
    expect(normalizePortfolio({ id: 'a' })!.timezone).toBe('Asia/Jerusalem');
    expect(normalizePortfolio({ id: 'a', timezone: 'America/New_York' })!.timezone).toBe('America/New_York');
  });
});

describe('validatePortfolio', () => {
  it('requires a name the trader chose', () => {
    const [problem] = validatePortfolio('   ', 50_000, []);
    expect(problem.field).toBe('name');
  });

  it('refuses a duplicate name, ignoring case and space', () => {
    const problems = validatePortfolio(' demo ', 50_000, [pf({ name: 'DEMO' })]);
    expect(problems.some(p => p.field === 'name')).toBe(true);
  });

  it('lets a portfolio keep its own name while being renamed', () => {
    expect(validatePortfolio('DEMO', 50_000, [pf({ id: 'pf_1', name: 'DEMO' })], 'pf_1')).toEqual([]);
  });

  it('ignores a deleted portfolio when checking for a clash', () => {
    expect(validatePortfolio('DEMO', 50_000, [pf({ name: 'DEMO', deleted: true })])).toEqual([]);
  });

  it('refuses a balance that is a typo rather than an account', () => {
    expect(validatePortfolio('A', MIN_BALANCE_USD - 1, []).some(p => p.field === 'balance')).toBe(true);
    expect(validatePortfolio('A', 0, []).some(p => p.field === 'balance')).toBe(true);
    expect(validatePortfolio('A', MIN_BALANCE_USD, [])).toEqual([]);
  });

  it('reports every problem at once, not the first', () => {
    // A form that reveals its objections one at a time is filled in twice.
    expect(validatePortfolio('', 0, [])).toHaveLength(2);
  });
});

describe('resolveSelected', () => {
  const a = pf({ id: 'a', createdAt: 1 }), b = pf({ id: 'b', name: 'B', createdAt: 2 });

  it('returns null only when there is genuinely nothing', () => {
    expect(resolveSelected([], null)).toBeNull();
    expect(resolveSelected([pf({ deleted: true })], null)).toBeNull();
  });

  it('honours the selection', () => {
    expect(resolveSelected([a, b], 'b')!.id).toBe('b');
  });

  it('falls back to the oldest rather than leaving the app with no context', () => {
    // A selection can point at a portfolio deleted on another device. Showing
    // nothing then is worse than showing the first one.
    expect(resolveSelected([a, b], 'gone')!.id).toBe('a');
    expect(resolveSelected([a, b], null)!.id).toBe('a');
  });

  it('never returns a deleted portfolio, even when selected', () => {
    expect(resolveSelected([pf({ id: 'a', deleted: true }), b], 'a')!.id).toBe('b');
  });
});

describe('newPortfolio', () => {
  it('carries what the trader typed and nothing invented', () => {
    const p = newPortfolio('  DAVID 50000 DEMO  ', 50_000, 'Asia/Jerusalem');
    expect(p.name).toBe('DAVID 50000 DEMO');
    expect(p.startingBalanceUsd).toBe(50_000);
    expect(p.source).toBe('tradingview');
    expect(p.deleted).toBeUndefined();
  });

  it('gives every portfolio a distinct id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPortfolio('x', 1000, 'UTC').id));
    expect(ids.size).toBe(200);
  });
});

// ── Where the account size comes from ───────────────────────────────────────
//
// Not from the file. A TradingView order-history export holds the orders that
// were placed; the same fifteen trades belong to a $2,000 account and a
// $200,000 one alike. It comes from the name, because that is where traders
// already write it — and because a grid of common sizes gave one account a
// $2,100 balance on a wrong tap, which every drawdown figure was then measured
// against.

describe('balanceFromName', () => {
  it('reads a bare figure', () => {
    expect(balanceFromName('DAVID 50000 DEMO')).toBe(50_000);
  });

  it('reads thousands separators and a dollar sign', () => {
    expect(balanceFromName('Eval $25,000')).toBe(25_000);
  });

  it('reads the K and M traders write', () => {
    expect(balanceFromName('APEX 150K')).toBe(150_000);
    expect(balanceFromName('apex 150k')).toBe(150_000);
    expect(balanceFromName('Big 1.5M')).toBe(1_500_000);
  });

  it('takes the largest, so a sequence number cannot win', () => {
    expect(balanceFromName('Account 2 — 50000')).toBe(50_000);
  });

  it('reads nothing when there is nothing to read', () => {
    // Silence, not a common size. A wrong balance is worse than none.
    expect(balanceFromName('התיק הראשי')).toBeNull();
    expect(balanceFromName('Main')).toBeNull();
  });

  it('does not read a small number as an account', () => {
    // "Account 2" is a sequence number, "Eval 3" an attempt. Reading either as
    // a balance would be worse than reading nothing at all.
    expect(balanceFromName('Account 2')).toBeNull();
    expect(balanceFromName('Eval 3')).toBeNull();
  });

  it('does not read a contract month as a balance', () => {
    expect(balanceFromName('MNQZ2026')).toBeNull();
  });
});
