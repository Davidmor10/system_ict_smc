// Which portfolio the night spends a model call on.
//
// A daily insight costs one. Generating one per portfolio per night multiplies
// that by however many accounts a trader keeps, every night, forever — and
// most of them are not being traded. The rule chosen: the ACTIVE portfolio
// only, and only if it has traded in the last thirty days.

import { describe, expect, it } from 'vitest';
import {
  nightlyPortfolio, tradedRecently, RECENT_TRADE_DAYS,
} from '../../app/lib/portfolio/nightly';

const TODAY = '2026-09-09';
const c = (accountId: string, lastTradeDate: string | null) => ({ accountId, lastTradeDate });

describe('tradedRecently', () => {
  it('counts an account traded today and one traded thirty days ago', () => {
    expect(tradedRecently('2026-09-09', TODAY)).toBe(true);
    expect(tradedRecently('2026-08-10', TODAY)).toBe(true);   // exactly 30
  });

  it('drops one that has gone quiet', () => {
    expect(tradedRecently('2026-08-09', TODAY)).toBe(false);  // 31
    expect(tradedRecently(null, TODAY)).toBe(false);
  });

  it('does not treat a future-dated trade as a stale account', () => {
    // A clock disagreement between the export and the app, not an idle
    // portfolio — and skipping the night over it would be the wrong call.
    expect(tradedRecently('2026-09-20', TODAY)).toBe(true);
  });

  it('uses the shared floor rather than a number typed here', () => {
    expect(RECENT_TRADE_DAYS).toBe(30);
  });
});

describe('nightlyPortfolio', () => {
  const live = c('A', '2026-09-08'), quiet = c('B', '2026-01-01');

  it('runs on the portfolio the trader is looking at', () => {
    expect(nightlyPortfolio([live, quiet], 'A', TODAY)).toBe('A');
  });

  it('spends nothing when that portfolio has gone quiet', () => {
    expect(nightlyPortfolio([live, quiet], 'B', TODAY)).toBeNull();
  });

  it('does NOT quietly run on a different account instead', () => {
    // A note about a portfolio the trader was not thinking about is worse
    // than no note: they did not ask for it and cannot tell why it appeared.
    expect(nightlyPortfolio([live, quiet], 'B', TODAY)).not.toBe('A');
  });

  it('falls back to the most recently traded one when nothing is selected', () => {
    // A trader who has never touched the switcher still gets a note.
    expect(nightlyPortfolio([c('A', '2026-09-01'), c('B', '2026-09-08')], null, TODAY)).toBe('B');
  });

  it('spends nothing when every portfolio is idle', () => {
    expect(nightlyPortfolio([quiet, c('C', null)], null, TODAY)).toBeNull();
  });

  it('spends nothing when there are no portfolios at all', () => {
    expect(nightlyPortfolio([], 'A', TODAY)).toBeNull();
  });

  it('ignores a selection pointing at a portfolio that no longer exists', () => {
    expect(nightlyPortfolio([live], 'deleted', TODAY)).toBe('A');
  });
});
