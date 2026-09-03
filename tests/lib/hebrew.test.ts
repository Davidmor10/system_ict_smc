// Number-noun agreement.
//
// "1 עסקאות סגורות" is what a template produces and what no person writes. It
// is the single detail that makes generated prose read as generated, and it
// appeared across two new summary screens before this helper existed.

import { describe, expect, it } from 'vitest';
import { q, feminine, heNum } from '../../app/lib/hebrew';

describe('q', () => {
  it('uses the singular form for one', () => {
    expect(q(1, 'עסקה סגורה אחת', 'עסקאות סגורות')).toBe('עסקה סגורה אחת');
  });

  it('prefixes the count for anything else', () => {
    expect(q(4, 'עסקה סגורה אחת', 'עסקאות סגורות')).toBe('4 עסקאות סגורות');
    expect(q(0, 'עסקה סגורה אחת', 'עסקאות סגורות')).toBe('0 עסקאות סגורות');
  });

  it('never emits a bare "1" in front of a plural', () => {
    expect(q(1, 'התנהגות אחת', 'התנהגויות')).not.toMatch(/^1 /);
  });

  it('groups thousands the way Hebrew does', () => {
    expect(q(1200, 'x', 'עסקאות')).toBe('1,200 עסקאות');
    expect(heNum(50000)).toBe('50,000');
  });
});

describe('feminine', () => {
  it('reads as a word for one and a number otherwise', () => {
    expect(feminine(1)).toBe('אחת');
    expect(feminine(9)).toBe('9');
    expect(feminine(0)).toBe('0');
  });
});

// ── the screens that got this wrong ─────────────────────────────────────────
//
// Every one of these strings shipped with a bare "1" in front of a plural.
// The helper above exists because doing it inline is how it gets forgotten on
// the next sentence, so this scans the sources rather than trusting review.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');

describe('the summary screens agree with their numbers', () => {
  const sources = [
    ['lib/progress/rows.ts', read('lib', 'progress', 'rows.ts')],
    ['lib/progress/traderSummary.ts', read('lib', 'progress', 'traderSummary.ts')],
    ['components/ProgressView.tsx', read('components', 'ProgressView.tsx')],
  ] as const;

  // A count interpolated straight in front of a plural Hebrew noun — the exact
  // shape that produced "1 עסקאות סגורות".
  //
  // A line carrying its own `=== 1` branch, or the helper, has already handled
  // it. Skipping those is not a loophole: it is the difference between finding
  // the bug and flagging every sentence that mentions a number.
  //
  // Two constructions are excluded because they are correct at any number:
  // "X מתוך Y הזדמנויות" is a ratio, not a count-noun, and a line whose
  // singular branch sits just above it is already handled. Excluding them is
  // the difference between finding the bug and flagging every sentence that
  // mentions a number.
  const RAW_PLURAL = /(?<!מתוך )\$\{[^}]*\}\s+(?:ה)?(?:עסקאות|התנהגויות|הזדמנויות|הפרות|רשומות|ימים)/;
  const GUARDED = /=== 1\b|\bq\(|feminine\(/;

  for (const [name, src] of sources) {
    it(`${name} does not interpolate a count in front of a plural noun`, () => {
      const lines = src.split('\n');
      const hits = lines.filter((l, i) =>
        RAW_PLURAL.test(l) && !lines.slice(Math.max(0, i - 2), i + 1).some(w => GUARDED.test(w)));
      expect(hits).toEqual([]);
    });
  }

  // Proves the scan can still fail — a check that cannot fail is decoration.
  it('catches the shape it was written for', () => {
    const bad = 'lines.push(`${num(facts.closed)} עסקאות סגורות`);';
    expect(RAW_PLURAL.test(bad) && !GUARDED.test(bad)).toBe(true);
  });

  it('the helper is what they use', () => {
    for (const [, src] of sources) expect(src).toMatch(/\bq\(|feminine\(/);
  });
});
