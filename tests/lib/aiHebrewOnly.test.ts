// ─────────────────────────────────────────────────────────────────────────────
// The pages are Hebrew. So is everything the model writes on them.
//
// The pattern cards used to print a Hebrew title with an English sentence under
// it — "Based on 11 trades, the win rate is 82%…" — because the JSON schema in
// the prompt literally said «one sentence starting with 'Based on'». A general
// "write in Hebrew" higher up the prompt lost to that concrete example, every
// time. Two things guard it now: the schema names the Hebrew opening, and a
// Latin-heavy answer is replaced rather than printed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { isMostlyLatin } from '../../app/lib/ai/patternInsights';
import { groupEvidence, metricsEvidence } from '../../app/lib/ai/insightPhrasing';
import { evidenceSpec, HEBREW_MENTOR_STYLE } from '../../app/lib/ai/styleGuide';
import type { GroupPerformance } from '../../app/lib/analytics/types';

const G = (over: Partial<GroupPerformance> = {}): GroupPerformance => ({
  key: 'k', label: 'l', trades: 11, wins: 9, losses: 2, winRate: 82,
  totalPnl: 1516, avgRR: 0.65, avgWinner: 200, avgLoser: -100,
  profitFactor: 3.02, expectancy: 0, ...over,
} as GroupPerformance);

describe('isMostlyLatin', () => {
  it('catches the sentence this was written for', () => {
    expect(isMostlyLatin('Based on 11 trades, the win rate is 82% with a profit factor of 3.02.')).toBe(true);
  });

  it('passes ordinary Hebrew evidence', () => {
    expect(isMostlyLatin('מבוסס על 11 עסקאות, עם 82% הצלחה מול 61% בממוצע הכללי.')).toBe(false);
  });

  it('does not trip on the tickers and tags that belong inside Hebrew prose', () => {
    // These are the trader's own words and must survive: a rule that flags them
    // would replace perfectly good sentences.
    expect(isMostlyLatin('מבוסס על 9 עסקאות MNQ בסשן NY AM עם אישור FVG.')).toBe(false);
    expect(isMostlyLatin('הדפוס של FVG חוזר ב-19 עסקאות, עם 82% הצלחה.')).toBe(false);
  });

  it('ignores digits and punctuation, which belong to neither script', () => {
    expect(isMostlyLatin('82% · 3.02 · +1.31R')).toBe(false);
    expect(isMostlyLatin('')).toBe(false);
  });
});

describe('the evidence field spec', () => {
  it('names the Hebrew opening, not the English one', () => {
    const he = evidenceSpec(true);
    expect(he).toContain('מבוסס על');
    expect(he).not.toContain('Based on');
  });

  it('still asks for English when the answer is English', () => {
    expect(evidenceSpec(false)).toContain('Based on');
  });

  it('carries whatever the caller wants cited', () => {
    expect(evidenceSpec(true, 'גודל המדגם המדויק')).toContain('גודל המדגם המדויק');
  });
});

describe('the Hebrew style guide', () => {
  it('says the language rule applies to every field, schema descriptions included', () => {
    // The loophole that produced the English sentences: the model read the
    // English field description as an instruction about language.
    expect(HEBREW_MENTOR_STYLE).toContain('EVERY string you output is Hebrew');
    expect(HEBREW_MENTOR_STYLE).toContain('מבוסס על');
  });
});

describe('the evidence line is computed, not generated', () => {
  it('writes the sentence that used to come back in English', () => {
    // The exact card from the bug report: 11 trades, 82%, R/R 0.65, PF 3.02.
    const line = groupEvidence(G(), 61, true);
    expect(line).toContain('11 עסקאות');
    expect(line).toContain('82% הצלחה');
    expect(line).toContain('61% בשאר היומן');
    expect(line).toContain('0.65');
    expect(line).toContain('3.02');
    expect(isMostlyLatin(line)).toBe(false);
  });

  it('leaves out the comparison when there is no baseline to compare to', () => {
    expect(groupEvidence(G(), null, true)).not.toContain('בממוצע');
  });

  it('still writes English for an English answer', () => {
    expect(groupEvidence(G(), 61, false)).toContain('Based on 11 trades');
  });

  it('cannot drift from the numbers — it prints them, it does not describe them', () => {
    const line = groupEvidence(G({ trades: 3, winRate: 100, avgRR: 1.31 }), null, true);
    expect(line).toContain('3 עסקאות');
    expect(line).toContain('100% הצלחה');
  });

  it('sums a hypothesis cluster without printing its internal ids', () => {
    // Keyed by pattern id ("session:nyam"); those are internals, not words a
    // trader uses.
    const line = metricsEvidence({ 'session:nyam': G(), 'instrument:MNQ': G({ trades: 6 }) }, true);
    expect(line).toContain('11 עסקאות');
    expect(line).toContain('ועוד 1 צירוף תומך');
    expect(line).not.toContain('session:');
  });

  it('says nothing at all when there are no metrics', () => {
    expect(metricsEvidence({}, true)).toBe('');
  });
});
