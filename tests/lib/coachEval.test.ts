import { describe, expect, it } from 'vitest';
import { COACH_EVAL_CASES, scoreAnswer, hasHeavyRepetition, type EvalCase } from '../../app/lib/ai/coachEval';

const caseById = (id: string): EvalCase => {
  const c = COACH_EVAL_CASES.find(x => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

describe('COACH_EVAL_CASES', () => {
  it('has at least 10 cases spanning the key categories', () => {
    expect(COACH_EVAL_CASES.length).toBeGreaterThanOrEqual(10);
    const cats = new Set(COACH_EVAL_CASES.map(c => c.category));
    for (const cat of ['ict', 'macro', 'geopolitics', 'strategy', 'user']) expect(cats.has(cat as EvalCase['category'])).toBe(true);
  });
});

describe('scoreAnswer', () => {
  it('passes a proper NFP answer (rates → yields → rate-sensitive growth)', () => {
    const good = 'NFP חזק מעלה את ציפיות הריבית, וזה דוחף למעלה את תשואות האג"ח. מניות צמיחה כמו הנאסד"ק רגישות מאוד לריבית, ולכן הן נוטות לרדת.';
    expect(scoreAnswer(good, caseById('nfp-nasdaq')).ok).toBe(true);
  });

  it('fails a shallow NFP answer and reports why', () => {
    const bad = 'NFP חזק אומר שהכלכלה חזקה תמיד, ולכן המניות עולות.';
    const r = scoreAnswer(bad, caseById('nfp-nasdaq'));
    expect(r.ok).toBe(false);
    expect(r.forbiddenHits).toContain('כלכלה חזקה תמיד');
    expect(r.missingConcepts.length).toBeGreaterThan(0);
  });

  it('fails a shallow CHoCH answer that calls it just a slowdown', () => {
    const bad = 'CHoCH זה בעצם רק האטה בקצב התנועה של המחיר.';
    expect(scoreAnswer(bad, caseById('bos-choch')).forbiddenHits).toContain('רק האטה');
  });

  it('fails a volume-only FVG answer', () => {
    const bad = 'FVG איכותי נמדד רק לפי volume גבוה.';
    expect(scoreAnswer(bad, caseById('fvg-quality')).ok).toBe(false);
  });

  it('fails an RR answer that gives worthless advice', () => {
    const bad = 'ה-RR ירד — תנסה להרוויח יותר ותפסיד פחות.';
    expect(scoreAnswer(bad, caseById('rr-personal')).forbiddenHits.length).toBeGreaterThan(0);
  });
});

describe('hasHeavyRepetition', () => {
  it('flags a duplicated sentence', () => {
    expect(hasHeavyRepetition('הנתון שינה את ציפיות הריבית. הנתון שינה את ציפיות הריבית.')).toBe(true);
  });
  it('does not flag normal varied prose', () => {
    expect(hasHeavyRepetition('CHoCH היא שבירה נגד המבנה הקודם. BOS מאשרת המשך של המגמה. ההבדל הוא כיוון השבירה.')).toBe(false);
  });
});
