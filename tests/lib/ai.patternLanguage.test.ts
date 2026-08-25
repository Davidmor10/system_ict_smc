// Hebrew that stays Hebrew.
//
// What shipped: the prompt described each candidate in English —
// "winRate 50%, PnL $520, avgRR 0.23, PF 1.87" — and asked for a Hebrew
// sentence citing those numbers. The model did exactly that, and copied the
// labels across with them. The page then showed a Hebrew sentence with four
// English tokens wedged into it.
//
// isMostlyLatin could not catch it, and that is the point of these tests: it
// fires only when Latin OUTWEIGHS Hebrew, and four tokens inside a Hebrew
// sentence never do.

import { describe, it, expect } from 'vitest';
import { isMostlyLatin, hasLatinMetricLabel } from '../../app/lib/ai/patternInsights';

const REAL_LEAK = 'בלי צילום מסך: 30 עסקאות, winRate 50%, PnL $520, avgRR 0.23, PF 1.87. המדגם גדול מספיק כדי להסיק מסקנות.';

describe('hasLatinMetricLabel', () => {
  it('catches the sentence that actually shipped', () => {
    expect(hasLatinMetricLabel(REAL_LEAK)).toBe(true);
  });

  it('catches each label on its own', () => {
    for (const t of ['winRate 50%', 'avgRR 0.23', 'PnL $520', 'PF 1.87']) {
      expect(hasLatinMetricLabel(`משפט בעברית עם ${t} בתוכו`), t).toBe(true);
    }
  });

  it('leaves an instrument symbol alone', () => {
    // MNQ and ES belong in Hebrew prose. Dropping a card over a ticker would
    // trade one failure for a worse one.
    expect(hasLatinMetricLabel('MNQ בסשן לונדון: 27% הצלחה מול 48% בממוצע הכללי')).toBe(false);
  });

  it('leaves a tag name alone', () => {
    expect(hasLatinMetricLabel('הסטאפ Silver Bullet מניב 73% הצלחה על 15 עסקאות')).toBe(false);
  });

  it('leaves clean Hebrew alone', () => {
    expect(hasLatinMetricLabel('אחוז הצלחה 50%, יחס סיכון־סיכוי ממוצע 0.23, פרופיט פקטור 1.87')).toBe(false);
  });
});

describe('the two guards catch different things', () => {
  it('isMostlyLatin does NOT catch the leak — which is why the second guard exists', () => {
    expect(isMostlyLatin(REAL_LEAK)).toBe(false);
    expect(hasLatinMetricLabel(REAL_LEAK)).toBe(true);
  });

  it('isMostlyLatin still catches a fully English title', () => {
    expect(isMostlyLatin('Your London session shows a materially lower win rate than the rest')).toBe(true);
  });
});
