// Two tables, one bug: a column header aligned by a rule that resolves to a
// different edge than the values under it, in an RTL page.
//
//   · /dashboard/reports — `direction: ltr` and `text-align: end` sat on the
//     SAME span. The header's "end" was the left of its cell (page is RTL);
//     the number's "end" was the right (span was LTR for the digits' sake).
//     Measured offset: 61-84px, so every forecast sat under "actual".
//   · /dashboard/journal — the setup header used a PHYSICAL 'left', which in
//     an RTL grid is the far edge of the table, next to the expand caret. Its
//     value sits at the other end of the same 1fr column. Measured: 883px.
//
// Both were verified in a browser before and after, not reasoned about.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('the reports board', () => {
  const src = readFileSync('app/dashboard/reports/page.tsx', 'utf8');

  it('does not put direction and alignment on one element', () => {
    // The pair that disagreed. If `direction: 'ltr'` returns to a span that
    // also carries textAlign, the columns come apart again.
    expect(src).not.toMatch(/textAlign:[^}]*\n?\s*direction: 'ltr'/);
  });

  it('isolates the number instead, so the minus keeps its side', () => {
    // Without isolation an RTL run renders "-277.50" as "277.50-" — measured
    // in Chromium, both ways.
    expect(src).toContain('<bdi dir="ltr">{shown}</bdi>');
  });

  it('still aligns header and value by the same rule', () => {
    expect(src).toContain("textAlign: align === 'end' ? 'end' : 'start'");
  });
});

describe('the journal trade list', () => {
  const src = readFileSync('app/components/journal/TradeDetailsTable.tsx', 'utf8');

  it('does not strand the setup header at the far edge of the table', () => {
    expect(src).not.toContain("headCell('סטאפ', 'left')");
    expect(src).toContain("headCell('סטאפ')");
  });

  it('leaves every header on the column start, where its values begin', () => {
    // All eight headers now take the default. A physical 'left' reappearing
    // here is the same bug returning.
    expect(src).not.toMatch(/headCell\([^)]*'left'/);
  });
});
