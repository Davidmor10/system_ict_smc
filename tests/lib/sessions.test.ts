import { describe, expect, it } from 'vitest';
import { sessionForHour } from '../../app/lib/sessions';

describe('sessionForHour', () => {
  it('maps an hour inside a window to that session', () => {
    expect(sessionForHour(3)).toBe('asia');
    expect(sessionForHour(10)).toBe('london');
    expect(sessionForHour(17)).toBe('nyam');
    expect(sessionForHour(21.5)).toBe('nypm');
  });

  it('respects the exact start boundary (inclusive) and end boundary (exclusive)', () => {
    expect(sessionForHour(16)).toBe('nyam');   // start, inclusive
    expect(sessionForHour(17.99)).toBe('nyam');
    expect(sessionForHour(18)).not.toBe('nyam'); // end, exclusive
  });

  it('returns null outside every tracked window', () => {
    expect(sessionForHour(0)).toBeNull();
    expect(sessionForHour(13.5)).toBeNull();
    expect(sessionForHour(23.5)).toBeNull();
  });
});
