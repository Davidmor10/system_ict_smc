import { describe, expect, it } from 'vitest';
import { extractResponse } from '../../app/lib/ai/coachOutput';

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
});
