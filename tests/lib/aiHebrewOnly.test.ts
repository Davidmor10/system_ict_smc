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
import { evidenceSpec, HEBREW_MENTOR_STYLE } from '../../app/lib/ai/styleGuide';

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
