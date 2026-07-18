import { describe, expect, it } from 'vitest';
import { translateMacroTitle } from '../../app/lib/ai/macroTitles';

describe('translateMacroTitle', () => {
  it('translates a recognized recurring event title', () => {
    const r = translateMacroTitle('Non-Farm Employment Change');
    expect(r.hasTranslation).toBe(true);
    expect(r.he).toBe('שינוי תעסוקה (NFP)');
  });

  it('falls back to the original English title, untranslated, for an unrecognized event', () => {
    const r = translateMacroTitle('Some Obscure One-Off Report');
    expect(r.hasTranslation).toBe(false);
    expect(r.he).toBe('Some Obscure One-Off Report');
  });

  it('is an exact-match lookup, not case-insensitive or fuzzy', () => {
    expect(translateMacroTitle('cpi m/m').hasTranslation).toBe(false);
    expect(translateMacroTitle('CPI m/m').hasTranslation).toBe(true);
  });
});
