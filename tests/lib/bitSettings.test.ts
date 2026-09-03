// Where customers send the money.
//
// This lived in two environment variables, so until they were set the payment
// page rendered a dash where the number belongs — the product was live and
// uncollectable — and changing the number meant a redeploy. It is a setting,
// not configuration.

import { describe, expect, it } from 'vitest';
import {
  normalizeBit, isPayable, isPayableFor, isValidQr, EMPTY_BIT, EMPTY_QR, MAX_QR_CHARS,
} from '../../app/lib/payments/settings';

const PNG = `data:image/png;base64,${'A'.repeat(64)}`;

describe('normalising what the owner typed', () => {
  it('trims', () => {
    expect(normalizeBit({ number: '  050-1234567 ', payee: ' דוד מור ' }))
      .toEqual({ number: '050-1234567', payee: 'דוד מור', qr: EMPTY_QR });
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

// ── what may be rendered into an <img src> on a public page ─────────────────
//
// This string reaches a customer's browser. An svg+xml data URI can carry
// script and a remote URL would let whoever wrote the row make the checkout
// fetch from anywhere, so the accepted shape is narrow on purpose.

describe('validating an uploaded code', () => {
  it('accepts a raster image data URI', () => {
    expect(isValidQr(PNG)).toBe(true);
    expect(isValidQr(`data:image/jpeg;base64,${'A'.repeat(20)}`)).toBe(true);
    expect(isValidQr(`data:image/webp;base64,${'A'.repeat(20)}`)).toBe(true);
  });

  it('refuses svg, which can carry script', () => {
    expect(isValidQr('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
  });

  it('refuses a remote url', () => {
    expect(isValidQr('https://example.com/qr.png')).toBe(false);
    expect(isValidQr('//example.com/qr.png')).toBe(false);
  });

  it('refuses anything past the size cap', () => {
    expect(isValidQr(`data:image/png;base64,${'A'.repeat(MAX_QR_CHARS)}`)).toBe(false);
  });

  it('refuses what is not a string at all', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(isValidQr(v)).toBe(false);
  });

  // A rejected code must be dropped, never stored half-validated.
  it('drops an invalid code instead of keeping it', () => {
    const out = normalizeBit({ qr: { pro: 'javascript:alert(1)', deluxe: PNG } });
    expect(out.qr.pro).toBeNull();
    expect(out.qr.deluxe).toBe(PNG);
  });
});

describe('whether a customer can actually pay', () => {
  // Per plan, because the code encodes the amount: a PRO code does not let a
  // DELUXE customer pay the right sum.
  it('turns a plan on with its own code', () => {
    const s = normalizeBit({ qr: { pro: PNG } });
    expect(isPayableFor(s, 'pro')).toBe(true);
    expect(isPayableFor(s, 'deluxe')).toBe(false);
  });

  // The number is the owner's personal one and publishing it is their choice,
  // so it is a route and not a requirement.
  it('turns every plan on with a number, for an owner who wants it shown', () => {
    const s = normalizeBit({ number: '050-1234567' });
    expect(isPayableFor(s, 'starter')).toBe(true);
    expect(isPayableFor(s, 'deluxe')).toBe(true);
  });

  it('stays off with neither, however complete the rest is', () => {
    expect(isPayableFor(normalizeBit({ payee: 'דוד מור' }), 'pro')).toBe(false);
    expect(isPayable(EMPTY_BIT)).toBe(false);
  });

  it('reports the account as payable once any single plan is', () => {
    expect(isPayable(normalizeBit({ qr: { starter: PNG } }))).toBe(true);
  });
});
