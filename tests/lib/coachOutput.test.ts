import { describe, expect, it } from 'vitest';
import { extractResponse, stripInternalLabels } from '../../app/lib/ai/coachOutput';

describe('extractResponse', () => {
  it('returns only the <response> body, never the <thinking>', () => {
    const raw = '<thinking>category: ICT. facts: none. plan: define then example.</thinking>\n<response>FVG הוא חוסר איזון של שלוש נרות.</response>';
    expect(extractResponse(raw)).toBe('FVG הוא חוסר איזון של שלוש נרות.');
  });

  it('handles output truncated before the closing </response>', () => {
    const raw = '<thinking>…</thinking><response>התשובה נחתכה באמצע';
    expect(extractResponse(raw)).toBe('התשובה נחתכה באמצע');
  });

  it('strips a stray thinking block when the model skipped the response tag', () => {
    const raw = '<thinking>internal reasoning here</thinking>\nכאן התשובה למשתמש.';
    expect(extractResponse(raw)).toBe('כאן התשובה למשתמש.');
  });

  it('returns plain text unchanged when there are no tags at all (fallback model)', () => {
    expect(extractResponse('סתם תשובה בלי תגיות')).toBe('סתם תשובה בלי תגיות');
  });

  it('never leaks the thinking content into the answer', () => {
    const raw = '<thinking>SECRET-REASONING-TOKEN</thinking><response>clean answer</response>';
    expect(extractResponse(raw)).not.toContain('SECRET-REASONING-TOKEN');
  });

  it('scrubs a leaked internal label inside the <response> body', () => {
    // The exact real-world leak: the model cited the internal "ESTABLISHED
    // FACTS" section header mid-sentence, in English, inside a Hebrew answer.
    const raw = '<response>הסיבה לכך עלולה להיות שאתה מתקשה יותר עם MNQ, כפי שנרשם ב-ESTABLISHED FACTS.</response>';
    const out = extractResponse(raw);
    expect(out).not.toContain('ESTABLISHED FACTS');
    expect(out).not.toContain('כפי שנרשם ב-');
    expect(out).toBe('הסיבה לכך עלולה להיות שאתה מתקשה יותר עם MNQ.');
  });
});

describe('stripInternalLabels', () => {
  it('removes a bare label occurrence', () => {
    const out = stripInternalLabels('המכשיר החלש הוא MNQ. ESTABLISHED FACTS. תעקוב אחריו.');
    expect(out).not.toContain('ESTABLISHED FACTS');
    expect(out).toContain('המכשיר החלש הוא MNQ.');
    expect(out).toContain('תעקוב אחריו.');
  });

  it('removes every known internal label, English or Hebrew connector', () => {
    for (const label of [
      'ESTABLISHED FACTS', 'EDGE HYPOTHESIS', 'COMPUTED JOURNAL STATISTICS',
      'RECENT CONVERSATION', 'PERSONAL CONTEXT TO WEAVE IN', 'REAL SCHEDULED MACRO EVENTS',
    ]) {
      const he = stripInternalLabels(`המספרים ברורים, כפי שמופיע ב-${label}.`);
      expect(he).not.toContain(label);
      const en = stripInternalLabels(`The numbers are clear, as recorded in the ${label}.`);
      expect(en).not.toContain(label);
    }
  });

  it('leaves a clean answer untouched, including legitimate caps like FVG / MNQ / NFP', () => {
    const clean = 'ה-FVG שלך על MNQ עבד טוב, ו-NFP ביום שישי הזיז את השוק.';
    expect(stripInternalLabels(clean)).toBe(clean);
  });
});
