// Where customers send the money.
//
// This lived in two environment variables, so until they were set the payment
// page rendered a dash where the number belongs — the product was live and
// uncollectable — and changing the number meant a redeploy. It is a setting,
// not configuration.

import { describe, expect, it } from 'vitest';
import { normalizeBit, isPayable, EMPTY_BIT } from '../../app/lib/payments/settings';

describe('normalising what the owner typed', () => {
  it('trims', () => {
    expect(normalizeBit({ number: '  050-1234567 ', payee: ' דוד מור ' }))
      .toEqual({ number: '050-1234567', payee: 'דוד מור' });
  });

  // A form submits "" for a cleared field, and an empty string reaching the
  // checkout renders as a present-but-blank recipient — the same silent
  // misconfiguration the dash was.
  it('treats a blank field as absent, not as a value', () => {
    expect(normalizeBit({ number: '', payee: '   ' })).toEqual(EMPTY_BIT);
  });

  it('ignores anything that is not a string', () => {
    expect(normalizeBit({ number: 12345, payee: null })).toEqual(EMPTY_BIT);
    expect(normalizeBit({})).toEqual(EMPTY_BIT);
  });
});

describe('whether a customer can actually pay', () => {
  // The payee name is a courtesy. The number is what makes the page usable.
  it('turns on the number alone', () => {
    expect(isPayable({ number: '050-1234567', payee: null })).toBe(true);
  });

  it('stays off without one, however complete the rest is', () => {
    expect(isPayable({ number: null, payee: 'דוד מור' })).toBe(false);
    expect(isPayable(EMPTY_BIT)).toBe(false);
  });
});
