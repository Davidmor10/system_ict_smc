import { describe, expect, it } from 'vitest';
import type { FullAnalysis } from '../../app/lib/analytics';
import {
  toIsraelParts, normalizeEvents, sessionKeyForTime, buildMacroBlock, computeMacroOverlap,
  type MacroEvent,
} from '../../app/lib/ai/macroCalendar';

describe('toIsraelParts', () => {
  it('converts an absolute ISO timestamp to Israel date + clock time', () => {
    // 10:00 EDT (-04:00) = 14:00 UTC = 17:00 in Israel (IDT, UTC+3) in July.
    expect(toIsraelParts('2026-07-06T10:00:00-04:00')).toEqual({ dateIsrael: '2026-07-06', timeIsrael: '17:00' });
  });
  it('rejects an unparseable date', () => {
    expect(toIsraelParts('not-a-date')).toBeNull();
  });
});

describe('normalizeEvents', () => {
  it('maps feed rows to Israel-time events and drops invalid ones', () => {
    const raw = [
      { title: 'ISM Services PMI', country: 'USD', date: '2026-07-06T10:00:00-04:00', impact: 'High' },
      { title: '', country: 'USD', date: '2026-07-06T10:00:00-04:00', impact: 'High' }, // no title → dropped
      { title: 'Bank Holiday', country: 'EUR', date: '2026-07-07T00:00:00-04:00', impact: 'Holiday' },
    ];
    const events = normalizeEvents(raw);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ title: 'ISM Services PMI', currency: 'USD', impact: 'High', dateIsrael: '2026-07-06', timeIsrael: '17:00' });
    expect(events[1].impact).toBe('Holiday');
  });
  it('returns [] for non-array input', () => {
    expect(normalizeEvents(null)).toEqual([]);
    expect(normalizeEvents({})).toEqual([]);
  });
});

describe('sessionKeyForTime', () => {
  it('maps Israel clock times to the right session window', () => {
    expect(sessionKeyForTime('17:00')).toBe('nyam');   // 16-18
    expect(sessionKeyForTime('21:00')).toBe('nypm');   // 20-23
    expect(sessionKeyForTime('13:00')).toBeNull();     // gap between sessions
  });
});

describe('buildMacroBlock', () => {
  const today = '2026-07-09';
  const events: MacroEvent[] = [
    { title: 'CPI m/m', currency: 'USD', impact: 'High', dateIsrael: today, timeIsrael: '15:30' },
    { title: 'FOMC Minutes', currency: 'USD', impact: 'High', dateIsrael: '2026-07-10', timeIsrael: '21:00' },
  ];
  it('lists today’s events and later high-impact ones, with real titles', () => {
    const block = buildMacroBlock(events, today);
    expect(block).toContain('TODAY (2026-07-09, Israel time)');
    expect(block).toContain('CPI m/m');
    expect(block).toContain('USD');
    expect(block).toContain('LATER THIS WEEK');
    expect(block).toContain('FOMC Minutes');
  });
  it('returns empty string when there are no events', () => {
    expect(buildMacroBlock([], today)).toBe('');
  });
});

describe('computeMacroOverlap', () => {
  const today = '2026-07-09';
  // A high-impact event at 21:00 Israel → NY PM session.
  const events: MacroEvent[] = [{ title: 'FOMC', currency: 'USD', impact: 'High', dateIsrael: today, timeIsrael: '21:00' }];
  const analysis = { sessions: [
    { label: 'NY PM', winRate: 35, confidence: { sampleSize: 12, level: 'medium' } },
    { label: 'NY AM', winRate: 62, confidence: { sampleSize: 20, level: 'high' } },
  ] } as unknown as FullAnalysis;

  it('flags overlap when a high-impact event lands in the weakest session', () => {
    const hint = computeMacroOverlap(events, analysis, today);
    expect(hint).toContain('NY PM');
    expect(hint).toContain('35%');
    expect(hint).toContain('never');   // guardrail language present
  });

  it('stays silent when the event lands in a strong session', () => {
    const strongOnly = { sessions: [
      { label: 'NY PM', winRate: 70, confidence: { sampleSize: 12, level: 'medium' } },
      { label: 'NY AM', winRate: 40, confidence: { sampleSize: 20, level: 'high' } }, // weakest, but no event lands here
    ] } as unknown as FullAnalysis;
    expect(computeMacroOverlap(events, strongOnly, today)).toBe('');
  });

  it('stays silent when sample sizes are too small to trust', () => {
    const thin = { sessions: [{ label: 'NY PM', winRate: 10, confidence: { sampleSize: 3, level: 'low' } }] } as unknown as FullAnalysis;
    expect(computeMacroOverlap(events, thin, today)).toBe('');
  });
});
