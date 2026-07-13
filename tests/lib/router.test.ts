import { describe, expect, it } from 'vitest';
import { classifyQuestion } from '../../app/lib/ai/router';

describe('classifyQuestion — deterministic pre-flight router', () => {
  it('flags SMC_TECHNICAL for ICT/SMC concepts (English + Hebrew)', () => {
    expect(classifyQuestion('What is an FVG?')).toContain('SMC_TECHNICAL');
    expect(classifyQuestion('מה ההבדל בין BOS ל-CHoCH?')).toContain('SMC_TECHNICAL');
    expect(classifyQuestion('מתי סוויפ נזילות נחשב אמין?')).toContain('SMC_TECHNICAL');
  });

  it('flags MACRO_NEWS for reports / rates / geopolitics / calendar (English + Hebrew)', () => {
    expect(classifyQuestion('How does NFP move the Nasdaq?')).toContain('MACRO_NEWS');
    expect(classifyQuestion('מה קורה עם הריבית והאינפלציה?')).toContain('MACRO_NEWS');
    expect(classifyQuestion('אילו דוחות חשובים היום?')).toContain('MACRO_NEWS');
  });

  it('flags TRADER_DISCRETION for judgment / rule-bending / edge questions', () => {
    expect(classifyQuestion('Should I break a rule when my gut says so?')).toContain('TRADER_DISCRETION');
    expect(classifyQuestion('מתי כדאי לי לשבור כלל בגלל שיקול דעת?')).toContain('TRADER_DISCRETION');
  });

  it('flags GENERAL_PSYCHOLOGY for emotion / discipline questions', () => {
    expect(classifyQuestion('How do I handle FOMO and fear?')).toContain('GENERAL_PSYCHOLOGY');
    expect(classifyQuestion('איך מתמודדים עם לחץ ופחד אחרי הפסד?')).toContain('GENERAL_PSYCHOLOGY');
  });

  it('is multi-label when a question spans categories', () => {
    const cats = classifyQuestion('כדאי לי לשבור את הכלל ולסחור על NFP היום?');
    expect(cats).toContain('MACRO_NEWS');
    expect(cats).toContain('TRADER_DISCRETION');
  });

  it('returns no categories for a generic/personal question — base prompt only', () => {
    expect(classifyQuestion('מה הסשן הכי טוב שלי?')).toEqual([]);
    expect(classifyQuestion('כמה עסקאות עשיתי החודש?')).toEqual([]);
  });

  it('boundary-guards short ASCII acronyms so they do not fire inside other words', () => {
    // "fed" must not match "defined"; "oil" must not match "boiling"; "war" not "warranty"
    expect(classifyQuestion('this is a clearly defined process')).toEqual([]);
    expect(classifyQuestion('the water is boiling')).toEqual([]);
    // but the real acronym still fires
    expect(classifyQuestion('what will the Fed do?')).toContain('MACRO_NEWS');
  });
});
