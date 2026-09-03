// The journey's row model.
//
// The page shows one row per behaviour, always — including the kinds that
// never fired, because "the system looked and found nothing" is information
// and it is the only thing that tells a trader what is being watched.
//
// The rules the trader wrote themselves arrive as rows of the same shape.
// They are deliberately given no lifecycle stage: the stages mean something
// specific (confirmed on a sample that could have said no, an experiment with
// guardrails) and none of it has run on a self-reported breach.

import { describe, expect, it } from 'vitest';
import {
  trendOf, sortRows, stageFor, undetectedNote, TREND_LABELS, type JourneyRow,
} from '../../app/lib/progress/rows';

function row(over: Partial<JourneyRow> = {}): JourneyRow {
  return {
    kind: 'k', label: 'l', source: 'builtin', status: 'detected', stage: 'watching',
    occurrences: 1, opportunities: 10, rate: 0.1, trend: 'unknown',
    historicalRate: 0.1, rollingRate: 0.1, isPrimary: false, relapses: 0,
    window: null, result: null, firstDetectedAt: null, lastSeenAt: null, events: [],
    ...over,
  };
}

describe('the trend', () => {
  // The rate is of a mistake, so falling is improving. Getting this backwards
  // would congratulate a trader for getting worse.
  it('calls a falling rate an improvement', () => {
    expect(trendOf(0.30, 0.10, 20)).toBe('improving');
  });

  it('calls a rising rate a worsening', () => {
    expect(trendOf(0.10, 0.30, 20)).toBe('worsening');
  });

  // A row that flickers between improving and worsening every night is a row
  // a trader stops reading.
  it('treats a difference inside the noise as steady', () => {
    expect(trendOf(0.20, 0.22, 20)).toBe('steady');
    expect(trendOf(0.20, 0.18, 20)).toBe('steady');
  });

  it('refuses to call a direction from an almost-empty recent window', () => {
    expect(trendOf(0.30, 0.00, 3)).toBe('unknown');
    expect(trendOf(0.30, 0.00, 0)).toBe('unknown');
  });

  it('is unknown rather than steady when a rate is missing', () => {
    expect(trendOf(null, 0.2, 20)).toBe('unknown');
    expect(trendOf(0.2, null, 20)).toBe('unknown');
    expect(trendOf(undefined, undefined, undefined)).toBe('unknown');
  });

  // "unknown" must not read as a clean record.
  it('never labels an unknown trend as an improvement', () => {
    expect(TREND_LABELS.unknown).not.toContain('פוחת');
    expect(TREND_LABELS.unknown).not.toContain('השתפר');
  });
});

describe('the stage of a row', () => {
  it('is outside the process, not early in it, when nothing was detected', () => {
    expect(stageFor(null)).toBe('undetected');
  });

  it('follows the lifecycle otherwise', () => {
    expect(stageFor('experiment')).toBe('working');
    expect(stageFor('resolved')).toBe('changed');
    expect(stageFor('investigating')).toBe('watching');
  });
});

describe('the order', () => {
  it('puts the open window first', () => {
    const out = sortRows([
      row({ kind: 'a', status: 'resolved' }),
      row({ kind: 'b', status: 'monitoring', window: { what: 'w', done: 3, of: 10 } }),
    ]);
    expect(out[0].kind).toBe('b');
  });

  it('sinks the kinds that were never detected', () => {
    const out = sortRows([
      row({ kind: 'never', status: null }),
      row({ kind: 'seen', status: 'detected' }),
    ]);
    expect(out.map(r => r.kind)).toEqual(['seen', 'never']);
  });

  it('ranks a behaviour closer to a verdict above one just noticed', () => {
    const out = sortRows([
      row({ kind: 'new', status: 'detected' }),
      row({ kind: 'firm', status: 'confirmed' }),
    ]);
    expect(out.map(r => r.kind)).toEqual(['firm', 'new']);
  });

  // The detectors carry evidence a self-reported breach does not, so they are
  // not interleaved with it.
  it('keeps the trader’s own rules after the detectors', () => {
    const out = sortRows([
      row({ kind: 'myrule', source: 'rule', status: null }),
      row({ kind: 'builtin', source: 'builtin', status: null }),
    ]);
    expect(out.map(r => r.source)).toEqual(['builtin', 'rule']);
  });

  it('does not mutate the array it was given', () => {
    const input = [row({ kind: 'a', status: null }), row({ kind: 'b', status: 'confirmed' })];
    sortRows(input);
    expect(input.map(r => r.kind)).toEqual(['a', 'b']);
  });
});

describe('a row with nothing detected', () => {
  // "Nothing found" and "nothing to look at" are different facts, and only one
  // of them is about the trader.
  it('separates a clean look from an empty denominator', () => {
    expect(undetectedNote(24)).toContain('24');
    expect(undetectedNote(0)).toContain('עוד לא היו עסקאות');
  });

  it('never claims the trader does not do it', () => {
    for (const n of [0, 5, 40]) {
      expect(undetectedNote(n)).not.toContain('אף פעם');
      expect(undetectedNote(n)).not.toContain('מצוין');
    }
  });
});
