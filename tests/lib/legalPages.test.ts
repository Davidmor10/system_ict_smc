// Both /privacy and /terms were linked from the footer and from /performance,
// and both were 404s. A paid service that links to terms it does not have is
// worse than one that links to nothing.
//
// These tests guard the two things that rot first: a link that goes nowhere,
// and a terms page whose commercial promises drift from the page that takes
// the money.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = (...p: string[]) => join(__dirname, '..', '..', 'app', ...p);
const read = (...p: string[]) => readFileSync(app(...p), 'utf8');

const FOOTER = read('(marketing)', 'components', 'MarketingFooter.tsx');
const PRICING = read('(marketing)', 'pricing', 'page.tsx');
const TERMS = read('(marketing)', 'terms', 'page.tsx');
const PRIVACY = read('(marketing)', 'privacy', 'page.tsx');

describe('the pages the footer promises exist', () => {
  it('has a page behind every legal link in the footer', () => {
    const linked = [...FOOTER.matchAll(/href:\s*'\/([a-z-]+)'/g)].map(m => m[1]);
    for (const route of linked) {
      if (!['terms', 'privacy'].includes(route)) continue;
      expect(existsSync(app('(marketing)', route, 'page.tsx'))).toBe(true);
    }
  });
});

describe('the terms match the page that takes the money', () => {
  // Three plans, and the terms must name the same three prices /pricing does.
  it('quotes the same prices as /pricing', () => {
    const prices = [...PRICING.matchAll(/amount:\s*'(\d+)'/g)].map(m => m[1]);
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) expect(TERMS).toContain(`₪${p}`);
  });

  it('repeats that there is no free trial, which /pricing states twice', () => {
    expect(PRICING).toContain('ללא ניסיון חינם');
    expect(TERMS).toContain('אין תקופת ניסיון חינם');
  });

  it('keeps the cancellation promise /pricing makes', () => {
    expect(PRICING).toContain('ביטול בכל עת');
    expect(TERMS).toContain('אפשר לבטל בכל רגע');
  });
});

describe('the disclaimers this product cannot ship without', () => {
  it('says plainly that it is not investment advice', () => {
    expect(TERMS).toContain('אינו ייעוץ השקעות');
  });

  it('states the risk of loss', () => {
    expect(TERMS).toContain('אובדן מלוא הכספים');
  });

  it('says past performance does not predict future results', () => {
    expect(TERMS).toContain('ביצועי עבר');
  });
});

describe('the privacy page names every processor the code actually uses', () => {
  // Written from the code, not from a template. A privacy page describing a
  // different system than the one running is a promise nobody is keeping.
  it.each(['Clerk', 'Supabase', 'Stripe', 'Anthropic', 'Google', 'Vercel'])(
    'names %s',
    processor => { expect(PRIVACY).toContain(processor); },
  );

  it('tells the trader their notebook text leaves the system', () => {
    expect(PRIVACY).toContain('הטקסט שלך נשלח אליהם לעיבוד');
  });

  it('promises deletion, which the webhook actually implements', () => {
    expect(PRIVACY).toContain('נמחק כל מה שכתבת');
    expect(read('api', 'webhooks', 'clerk', 'route.ts')).toContain('user.deleted');
  });
});
