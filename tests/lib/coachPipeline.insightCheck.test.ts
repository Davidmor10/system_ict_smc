// ─────────────────────────────────────────────────────────────────────────────
// The output checks, against a corpus.
//
// Two halves, and the second is the one that keeps this useful:
//
//   the bad   — insights that break a rule. Written the way a model actually
//               breaks it, not as keyword bait
//   the good  — insights that don't. If these ever start failing, the checker
//               has become the problem: a false positive costs a retry, and a
//               second one publishes a worse note than the one it rejected
//
// Every generic-advice pattern here was written by asking what a coach says
// when they have nothing to say. That is the failure mode worth catching: not
// a wrong number, but a paragraph that is true of everyone and therefore
// about no one.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  checkInsight, hasHardViolation, buildCorrection,
} from '../../app/lib/coach-pipeline/quality/insightCheck';
import type { BehaviorBlock } from '../../app/lib/coach-pipeline/pipelines/analyzeBehavior';

// ── blocks ──────────────────────────────────────────────────────────────────

const EMPTY: BehaviorBlock = { primary: null, insufficientEvidence: true, watching: [] };

function withPrimary(over: Partial<NonNullable<BehaviorBlock['primary']>> = {}): BehaviorBlock {
  return {
    primary: {
      label: 'סגירה שיקולית — לא ביעד ולא בסטופ',
      status: 'confirmed',
      knownForDays: 21,
      relapses: 0,
      statements: [{ tier: 'observed', text: 'סגירה שיקולית: 8 מתוך 12.' }],
      question: 'מה שונה בהחלטה שלך ברגעים האלה?',
      traderAnswer: null,
      experiment: null,
      outcome: null,
      ...over,
    },
    insufficientEvidence: false,
    watching: [],
  };
}

const rules = (text: string, block: BehaviorBlock = EMPTY) =>
  checkInsight(text, block).map(v => v.rule);

// ═══════════════════════════════════════════════════════════════════════════
// The bad
// ═══════════════════════════════════════════════════════════════════════════

describe('generic advice', () => {
  it('catches the sentence a coach writes when they have nothing to say', () => {
    expect(rules('סיימת את היום באיזון. תהיה ממושמע וזה יסתדר.')).toContain('generic_advice');
    expect(rules('יום מאתגר. חשוב להישאר ממוקד ולהמשיך.')).toContain('generic_advice');
    expect(rules('שלוש עסקאות היום. הקפד על ניהול סיכונים.')).toContain('generic_advice');
    expect(rules('המסחר הוא מרתון, לא ספרינט.')).toContain('generic_advice');
  });

  it('treats it as hard — this is the failure that makes the product worthless', () => {
    expect(hasHardViolation(checkInsight('תהיה ממושמע.', EMPTY))).toBe(true);
  });
});

describe('causal claims', () => {
  it('catches the model explaining the trader to themselves', () => {
    const b = withPrimary();
    expect(rules('יצאת מוקדם בשמונה מתוך שתים עשרה. הסיבה לכך היא חוסר אמון בתוכנית.', b))
      .toContain('causal_claim');
    expect(rules('הפחד שלך מלהחזיר רווח הוא מה שסוגר את העסקאות האלה.', b))
      .toContain('causal_claim');
    expect(rules('זה נובע מחוסר סבלנות.', b)).toContain('causal_claim');
    expect(rules('סגרת מתוך פחד.', b)).toContain('causal_claim');
  });

  // "כי" is one of the most common words in Hebrew. A checker that fires on
  // it would flag most good insights.
  it('does not fire on ordinary uses of "כי"', () => {
    expect(rules('שמת לב לזה בעצמך, וכתבת כי חשבת שהמהלך נגמר.', withPrimary()))
      .not.toContain('causal_claim');
  });
});

describe('field names', () => {
  it('catches the internal vocabulary reaching the trader', () => {
    expect(rules('ה-streak_now שלך עומד על ארבע.')).toContain('field_name');
    expect(rules('ה-pf שלך נמוך.')).toContain('field_name');
    expect(rules('הזיהוי של discretionary_exit חזר שוב.')).toContain('field_name');
  });

  // "R" is the trader's own vocabulary and must survive.
  it('leaves R alone', () => {
    expect(rules('העסקה הזו החזירה 1.6R.')).toEqual([]);
  });

  // A two-letter pattern is the one most likely to fire inside a Hebrew word.
  it('does not fire on Hebrew text that happens to contain the letters', () => {
    expect(rules('הרווח נשמר.')).toEqual([]);
  });
});

describe('inventing a pattern out of nothing', () => {
  it('catches a pattern claim when the analysis found none', () => {
    expect(rules('נראה שיש לך נטייה לצאת מוקדם.', EMPTY)).toContain('invented_pattern');
    expect(rules('זה חוזר על עצמו.', EMPTY)).toContain('invented_pattern');
    expect(rules('אתה נוטה להיכנס מהר מדי.', EMPTY)).toContain('invented_pattern');
  });

  it('allows the same words once a pattern actually exists', () => {
    expect(rules('הדפוס הזה הופיע בשמונה מתוך שתים עשרה.', withPrimary()))
      .not.toContain('invented_pattern');
  });
});

describe('behaviours the model was not given', () => {
  it('catches something from the watching list', () => {
    const b: BehaviorBlock = { ...EMPTY, watching: ['size_spike'] };
    expect(rules('שים לב גם ל-size_spike.', b)).toContain('unlisted_behavior');
  });
});

describe('claims about a sequence of days', () => {
  it('catches a run the model cannot see', () => {
    expect(rules('זה היום השלישי ברצף שבו זה קורה.')).toContain('sequence_claim');
    expect(rules('בימים האחרונים המסחר שלך התהדק.')).toContain('sequence_claim');
  });
});

// The single most damaging sentence the system could publish.
describe('a broken guardrail reported as a win', () => {
  const block = withPrimary({
    outcome: {
      verdict: 'traded_one_problem_for_another',
      targetBefore: 0.5, targetAfter: 0.1,
      broken: ['trade_frequency'],
    },
  });

  it('catches an improvement reported without the damage', () => {
    const text = 'הניסוי עבד — היציאות המוקדמות ירדו מחצי לעשירית.';
    expect(rules(text, block)).toContain('unreported_guardrail');
    expect(hasHardViolation(checkInsight(text, block))).toBe(true);
  });

  it('passes when both halves are reported', () => {
    const text = 'היציאות המוקדמות ירדו מחצי לעשירית, אבל מספר העסקאות שלך ירד באותה תקופה.';
    expect(rules(text, block)).not.toContain('unreported_guardrail');
  });
});

describe('soft violations', () => {
  it('flags a duration the block cannot support', () => {
    const b = withPrimary({ knownForDays: null });
    expect(rules('זה נמשך כבר שבועות.', b)).toContain('invented_duration');
  });

  it('flags an unasked question and a doubled one', () => {
    expect(rules('שלוש עסקאות היום.', withPrimary())).toContain('missing_question');
    expect(rules('מה קרה שם? ומה תעשה מחר?', withPrimary())).toContain('two_questions');
  });

  it('flags an exclamation mark', () => {
    expect(rules('יום טוב!', withPrimary())).toContain('exclamation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The good — the half that stops the checker becoming the problem
// ═══════════════════════════════════════════════════════════════════════════

describe('insights that must pass untouched', () => {
  it('an evidence-first note with a question, on a confirmed finding', () => {
    const text = [
      'שלוש עסקאות היום, כולן ב-MNQ, וכולן נסגרו לפני היעד שהגדרת.',
      '',
      'סגירה שיקולית הופיעה בשמונה מתוך שתים עשרה העסקאות שבהן היה יעד וסטופ. זה מרוכז בסשן לונדון: שבעים אחוז מהמקרים שם, מול עשרים בשאר.',
      '',
      'מה שונה בהחלטה שלך ברגעים האלה?',
    ].join('\n');
    expect(checkInsight(text, withPrimary())).toEqual([]);
  });

  it('a short, honest note when there is nothing to say', () => {
    const text = [
      'שתי עסקאות היום, שתיהן נסגרו באיזון.',
      '',
      'עוד אין מספיק היסטוריה כדי לומר משהו על הרגלים. המספרים יתחילו לדבר אחרי עוד כמה עסקאות מתועדות.',
    ].join('\n');
    expect(checkInsight(text, EMPTY)).toEqual([]);
  });

  it('a possibility phrased as a possibility', () => {
    const text = 'ייתכן שהשעה משפיעה על ההחלטה הזו. הנתונים מראים את הקשר, לא את הסיבה. מה אתה חושב?';
    expect(checkInsight(text, withPrimary())).toEqual([]);
  });

  it('a reply that builds on what the trader wrote', () => {
    const b = withPrimary({ question: null, traderAnswer: 'הרגשתי שהמהלך נגמר' });
    const text = 'כתבת שהרגשת שהמהלך נגמר. בשמונה מתוך שתים עשרה העסקאות ההרגשה הזו הקדימה את היעד.';
    expect(checkInsight(text, b)).toEqual([]);
  });

  it('an experiment instruction', () => {
    const b = withPrimary({
      question: null,
      experiment: { instruction: 'ב-10 העסקאות הבאות: קבע יעד וסטופ לפני הכניסה, וצא רק באחד מהם.', windowTrades: 10 },
    });
    const text = 'ב-10 העסקאות הבאות: קבע יעד וסטופ לפני הכניסה, וצא רק באחד מהם. נמדוד את זה בסוף החלון.';
    expect(checkInsight(text, b)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The retry
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCorrection', () => {
  it('quotes what was written back at the model', () => {
    const v = checkInsight('תהיה ממושמע. הסיבה לכך היא חוסר סבלנות.', EMPTY);
    const c = buildCorrection(v);
    expect(c).toContain('תהיה ממושמע');
    expect(c).toContain('הסיבה ל');
    expect(c).toContain('true of every trader');
  });

  // A correction that re-sends the rulebook mostly produces the same output
  // with different adjectives.
  it('carries only the hard violations', () => {
    const c = buildCorrection(checkInsight('יום טוב!', withPrimary()));
    expect(c).not.toContain('exclamation');
  });
});
