import { describe, expect, it } from 'vitest';
import {
  countTokens,
  countJsonTokens,
  checkProfileCap,
  assertProfileWithinCap,
  ProfileOverCapError,
  PROFILE_TOKEN_CAP,
  PROFILE_TOKEN_WARN,
} from '../../app/lib/coach-pipeline/tokens';

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns at least 1 for a single character', () => {
    expect(countTokens('a')).toBeGreaterThanOrEqual(1);
  });

  it('overcounts (never undercounts) English text vs. ~3.5 chars-per-token', () => {
    // 100 English chars → real token count ~28-32. Our estimator must be >=.
    const text = 'the quick brown fox jumps over the lazy dog '.repeat(3).slice(0, 100);
    expect(countTokens(text)).toBeGreaterThanOrEqual(28);
  });

  it('overcounts Hebrew (dense tokens) more than English of same length', () => {
    const englishTokens = countTokens('a'.repeat(100));
    const hebrewTokens  = countTokens('א'.repeat(100));
    expect(hebrewTokens).toBeGreaterThan(englishTokens);
  });

  it('treats JSON punctuation as its own tokens', () => {
    const withPunct    = countTokens('{"a":1,"b":2}');
    const withoutPunct = countTokens('a1b2');
    expect(withPunct).toBeGreaterThan(withoutPunct);
  });
});

describe('countJsonTokens', () => {
  it('returns 0 for null/undefined', () => {
    expect(countJsonTokens(null)).toBe(0);
    expect(countJsonTokens(undefined)).toBe(0);
  });

  it('serializes and counts objects', () => {
    expect(countJsonTokens({ a: 1, b: 'two' })).toBeGreaterThan(0);
  });
});

describe('checkProfileCap', () => {
  const tiny = { statistical: {}, behavioral: {}, narrative_summary: '' };

  it('flags a tiny profile as safe', () => {
    const c = checkProfileCap(tiny);
    expect(c.ok).toBe(true);
    expect(c.level).toBe('safe');
    expect(c.tokens).toBeLessThan(PROFILE_TOKEN_WARN);
  });

  it('flags a mid-sized profile as warn (between warn and cap)', () => {
    // Build a ~400-token narrative.
    const narrative = 'a '.repeat(750);   // ~430 tokens under English ratio
    const c = checkProfileCap({ ...tiny, narrative_summary: narrative });
    expect(c.ok).toBe(true);
    expect(c.level).toBe('warn');
  });

  it('flags an over-cap profile as over and ok=false', () => {
    const huge = 'a '.repeat(2000);   // ~1140 tokens
    const c = checkProfileCap({ ...tiny, narrative_summary: huge });
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.tokens).toBeGreaterThanOrEqual(PROFILE_TOKEN_CAP);
      expect(c.cap).toBe(PROFILE_TOKEN_CAP);
    }
  });
});

describe('assertProfileWithinCap', () => {
  it('returns token count when under cap', () => {
    expect(assertProfileWithinCap({
      statistical: { n: 5 },
      behavioral:  {},
      narrative_summary: 'short',
    })).toBeGreaterThan(0);
  });

  it('throws ProfileOverCapError when over', () => {
    const huge = 'a '.repeat(2000);
    expect(() => assertProfileWithinCap({
      statistical: {},
      behavioral:  {},
      narrative_summary: huge,
    })).toThrow(ProfileOverCapError);
  });
});
