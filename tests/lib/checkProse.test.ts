// The rules that hold for every piece of prose this product publishes.
//
// The daily insight has checked its own output since it shipped. The coach's
// chat answers and the weekly report ran nothing — they went from the model to
// the trader with no gate at all. So the same model, publishing the same two
// failures, was caught in the morning note and waved through everywhere else:
// a coaching platitude that is true of every trader on every day, and a claim
// about the trader's own psychology that no sample size can support.
//
// These tests pin the shared core, and pin what stays OUT of it — a rule that
// is only a violation relative to a specific evidence block cannot be applied
// to a chat reply, and applying it anyway would reject good answers.

import { describe, it, expect } from 'vitest';
import {
  checkProse, checkInsight, hasHardViolation, buildCorrection,
} from '../../app/lib/coach-pipeline/quality/insightCheck';
import { EMPTY_BLOCK } from '../../app/lib/coach-pipeline/pipelines/analyzeBehavior';

const rules = (text: string, lang: 'he' | 'en' = 'he') =>
  checkProse(text, lang).map(v => v.rule);

describe('checkProse', () => {
  it('passes an ordinary specific answer', () => {
    expect(rules('בשבוע הזה סגרת 12 עסקאות, 7 מהן ברווח.')).toEqual([]);
  });

  it('catches advice true of every trader on every day', () => {
    expect(rules('תהיה ממושמע ותמשיך לעקוב אחרי התוכנית.')).toContain('generic_advice');
  });

  it('catches a claim about the trader’s psychology', () => {
    // The move the data cannot support at any sample size.
    expect(rules('הסיבה לזה היא חוסר סבלנות.')).toContain('causal_claim');
    expect(rules('יצאת מוקדם בגלל הפחד להפסיד.')).toContain('causal_claim');
  });

  it('leaves an ordinary Hebrew "because" alone', () => {
    // "כי" is one of the most common words in the language. A checker that
    // fires on it costs a retry and, twice, a worse answer than the one it
    // rejected.
    expect(rules('סגרת מוקדם כי הגעת ליעד שקבעת.')).toEqual([]);
  });

  it('catches an internal field name', () => {
    expect(rules('ה-win_rate שלך עלה.')).toContain('field_name');
    expect(rules('ה-pf שלך 1.4.')).toContain('field_name');
  });

  it('catches an answer that came back in English', () => {
    expect(rules('Your win rate improved this week and your average loss got smaller.'))
      .toContain('latin_output');
  });

  it('catches English metric labels inside Hebrew prose', () => {
    // The case that actually shipped. Four Latin tokens never outweigh a
    // Hebrew paragraph, so the first guard cannot see this one.
    expect(rules('ה-winRate שלך עלה השבוע ל-58 אחוז, וה-avgRR נשאר יציב.'))
      .toContain('latin_metric_label');
  });

  it('leaves tickers and units alone', () => {
    // "MNQ", "NY AM", "+1.31R" belong in Hebrew prose.
    expect(rules('ב-MNQ בסשן NY AM החזרת 1.31R בממוצע.')).toEqual([]);
  });

  it('does not apply the Hebrew guards to an English answer', () => {
    // An English answer to an English question is not a language failure.
    expect(rules('Your win rate improved this week and your average loss got smaller.', 'en'))
      .toEqual([]);
  });

  it('marks an exclamation as clumsy rather than untrue', () => {
    const v = checkProse('סגרת 12 עסקאות!');
    expect(v.map(x => x.rule)).toEqual(['exclamation']);
    expect(hasHardViolation(v)).toBe(false);
  });

  it('reports what it found, verbatim', () => {
    // A violation you cannot see in the text is indistinguishable from a bug
    // in the checker.
    const v = checkProse('הסיבה לזה היא חוסר סבלנות.');
    expect(v[0].detail).toBe('הסיבה ל');
  });
});

describe('what stays out of the shared core', () => {
  it('does not police a pattern claim, which needs the evidence block', () => {
    // "דפוס" is only a violation when the analysis found none. A chat reply
    // has no block to be judged against, and rejecting the word outright would
    // throw away good answers.
    expect(rules('הדפוס הזה חוזר אצלך')).toEqual([]);
  });

  it('does not police a claim about a run of days', () => {
    // The daily insight receives one day and cannot see a sequence. A weekly
    // report is a sequence.
    expect(rules('בימים האחרונים הקצב ירד')).toEqual([]);
  });

  it('still policies both inside the daily insight', () => {
    const v = checkInsight('הדפוס הזה חוזר אצלך בימים האחרונים', EMPTY_BLOCK);
    expect(v.map(x => x.rule)).toContain('invented_pattern');
    expect(v.map(x => x.rule)).toContain('sequence_claim');
  });

  it('applies the shared core inside the daily insight too', () => {
    // One definition, not two. A platitude is a platitude in either place.
    expect(checkInsight('תהיה ממושמע.', EMPTY_BLOCK).map(v => v.rule)).toContain('generic_advice');
  });

  it('does not report the exclamation twice', () => {
    const v = checkInsight('סגרת 12 עסקאות!', EMPTY_BLOCK);
    expect(v.filter(x => x.rule === 'exclamation')).toHaveLength(1);
  });
});

describe('buildCorrection', () => {
  it('names what was written and which rule it broke', () => {
    const text = buildCorrection(checkProse('הסיבה לזה היא חוסר סבלנות.'));
    expect(text).toContain('הסיבה ל');
    expect(text).toContain('cannot know why');
  });

  it('has something to say about each new rule', () => {
    expect(buildCorrection(checkProse('Your win rate improved a lot this week overall.')))
      .toContain('Hebrew');
    expect(buildCorrection(checkProse('ה-winRate שלך עלה ל-58 אחוז וה-avgRR יציב.')))
      .toContain('אחוז הצלחה');
  });

  it('asks only about hard violations', () => {
    // A retry spent on an exclamation mark buys a worse answer.
    expect(buildCorrection(checkProse('סגרת 12 עסקאות!'))).not.toContain('!');
  });
});
