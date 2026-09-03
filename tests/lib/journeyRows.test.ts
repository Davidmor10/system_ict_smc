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
  trendOf, sortRows, stageFor, undetectedNote, presentedStatus, TREND_LABELS, type JourneyRow,
} from '../../app/lib/progress/rows';

function row(over: Partial<JourneyRow> = {}): JourneyRow {
  return {
    kind: 'k', label: 'l', source: 'builtin', status: 'detected', stage: 'watching',
    occurrences: 1, opportunities: 10, rate: 0.1, trend: 'unknown',
    historicalRate: 0.1, rollingRate: 0.1, isPrimary: false, relapses: 0,
    window: null, result: null, firstDetectedAt: null, lastSeenAt: null, events: [], overlap: null,
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
    expect(undetectedNote(24)).toContain('ב-24 הזדמנויות');
    expect(undetectedNote(1)).toContain('בהזדמנות אחת');
    expect(undetectedNote(1)).not.toMatch(/\b1 /);
    expect(undetectedNote(0)).toContain('עוד לא היו עסקאות');
  });

  it('never claims the trader does not do it', () => {
    for (const n of [0, 5, 40]) {
      expect(undetectedNote(n)).not.toContain('אף פעם');
      expect(undetectedNote(n)).not.toContain('מצוין');
    }
  });
});

// ── the summary ─────────────────────────────────────────────────────────────
//
// The page was a table of rates: every row a percentage and a pair of
// percentages, and not one sentence a person would read aloud. These tests
// hold the summary to being derived — assembled from the rows' own counts, so
// it cannot drift from what is underneath it, cannot invent a claim, and
// cannot quietly start giving advice.

import { summarizeJourney } from '../../app/lib/progress/rows';

const win = (done: number, of: number) => ({ what: 'x', done, of });
const res = (verdict: string) => ({
  verdict, before: 30, after: 10, historicalImproved: true, rollingImproved: true, broken: [] as string[],
});

describe('the summary', () => {
  it('opens with the denominator of the whole screen', () => {
    const s = summarizeJourney([
      row({ kind: 'a', status: 'confirmed' }), row({ kind: 'b', status: null }),
      row({ kind: 'c', status: null }),
    ]);
    expect(s.lines[0]).toContain('מתוך 3');
    expect(s.lines[0]).toContain('אחת זוהתה');
  });

  it('says plainly when nothing has been detected at all', () => {
    const s = summarizeJourney([row({ status: null }), row({ kind: 'b', status: null })]);
    expect(s.lines[0]).toContain('אף אחת מהן לא זוהתה');
  });

  it('leads with the open window and how far it has to go', () => {
    const s = summarizeJourney([
      row({ kind: 'a', label: 'סגירה מוקדמת', status: 'monitoring', window: win(6, 10) }),
    ]);
    expect(s.focus).toBe('סגירה מוקדמת');
    expect(s.lines.join(' ')).toContain('6');
    expect(s.lines.join(' ')).toContain('10');
    expect(s.lines.join(' ')).toContain('עוד 4');
  });

  it('does not promise a verdict once the window is full', () => {
    const s = summarizeJourney([row({ status: 'monitoring', window: win(10, 10) })]);
    expect(s.lines.join(' ')).toContain('הספירה הושלמה');
    expect(s.lines.join(' ')).not.toContain('עוד 0');
  });

  // The state his own screen was in: two behaviours established and nothing
  // running on either.
  it('reports what is confirmed and has no window open', () => {
    const s = summarizeJourney([
      row({ kind: 'a', status: 'confirmed' }), row({ kind: 'b', status: 'confirmed' }),
    ]);
    expect(s.lines.join(' ')).toContain('2 חוזרות על עצמן');
    expect(s.lines.join(' ')).toContain('לא התחלנו לנסות לשנות');
  });

  // An absent line here would read as a quiet yes.
  it('says outright when no experiment has ever been settled', () => {
    const s = summarizeJourney([row({ status: 'confirmed' })]);
    expect(s.lines.join(' ')).toContain('אי אפשר להגיד שמשהו כבר השתפר');
  });

  it('counts only the experiments that actually improved', () => {
    const s = summarizeJourney([
      row({ kind: 'a', status: 'resolved', result: res('improved') }),
      row({ kind: 'b', status: 'improved', result: res('traded_one_problem_for_another') }),
    ]);
    expect(s.lines.join(' ')).toContain('התנהגות אחת כבר שינית, והשינוי החזיק');
  });

  // A window that closed without a real improvement must not be summarised as
  // one — the guardrails exist to catch exactly that.
  it('does not call a traded-off problem a success', () => {
    const s = summarizeJourney([row({ status: 'improved', result: res('traded_one_problem_for_another') })]);
    const text = s.lines.join(' ');
    expect(text).toContain('אף שינוי לא החזיק');
  });

  it('names a rate that is climbing, because a fall would be named too', () => {
    const s = summarizeJourney([row({ label: 'סטייה מהחוקים', status: 'confirmed', trend: 'worsening' })]);
    expect(s.lines.join(' ')).toContain('סטייה מהחוקים');
    expect(s.lines.join(' ')).toContain('קורית לאחרונה יותר מבעבר');
  });

  it('counts the trader’s own rules separately from the detectors', () => {
    const s = summarizeJourney([
      row({ kind: 'a', status: 'confirmed' }),
      row({ kind: 'rule:1', label: 'לא להיכנס לפני 16:30', source: 'rule', status: null, occurrences: 7 }),
      row({ kind: 'rule:2', label: 'שתי עסקאות ביום', source: 'rule', status: null, occurrences: 3 }),
    ]);
    const text = s.lines.join(' ');
    expect(text).toContain('10 הפרות');
    expect(text).toContain('לא להיכנס לפני 16:30');
    // The rules are not folded into the detector denominator.
    expect(s.lines[0]).toContain('מתוך 1');
  });

  // The line every other rule in this codebase exists to protect.
  it('never says why, and never says what to do', () => {
    const s = summarizeJourney([
      row({ kind: 'a', status: 'monitoring', window: win(3, 10), trend: 'worsening' }),
      row({ kind: 'b', status: 'confirmed' }),
      row({ kind: 'rule:1', source: 'rule', status: null, occurrences: 4 }),
    ]);
    const text = s.lines.join(' ');
    for (const forbidden of ['כי אתה', 'בגלל ש', 'מומלץ', 'כדאי', 'אתה צריך', 'נסה ל']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('is never empty', () => {
    expect(summarizeJourney([]).lines.length).toBeGreaterThan(0);
  });
});

// ── the same act, counted twice ─────────────────────────────────────────────
//
// Two rows on the live journal read 6/34 and 6/34 with identical rates, which
// looked like a bug. It was not — the detectors are independent and their
// denominators match because both questions sit on the same form. But nothing
// on the screen could say whether the two rows were about the same TRADES, and
// only the trade ids can answer that.

import { findOverlap } from '../../app/lib/progress/rows';

const other = (kind: string, label: string, ids: string[]) => ({ kind, label, occurrenceIds: ids });

describe('overlapping occurrences', () => {
  it('names the behaviour firing on the same trades', () => {
    const o = findOverlap(
      { kind: 'stop_widened', occurrenceIds: ['t1', 't2', 't3'] },
      [other('rule_violation', 'סטייה מהחוקים', ['t1', 't2', 't3'])],
    );
    expect(o?.label).toBe('סטייה מהחוקים');
    expect(o?.shared).toBe(3);
  });

  // Same count, different trades — the exact case that proves a matching
  // count says nothing at all.
  it('says nothing when the counts match but the trades do not', () => {
    expect(findOverlap(
      { kind: 'a', occurrenceIds: ['t1', 't2', 't3'] },
      [other('b', 'B', ['t7', 't8', 't9'])],
    )).toBeNull();
  });

  it('ignores a single shared trade, which any pair will have', () => {
    expect(findOverlap(
      { kind: 'a', occurrenceIds: ['t1', 't2', 't3', 't4'] },
      [other('b', 'B', ['t1'])],
    )).toBeNull();
  });

  it('ignores incidental co-occurrence below the share floor', () => {
    // 2 of 9 shared: they overlap sometimes, which is ordinary.
    expect(findOverlap(
      { kind: 'a', occurrenceIds: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'] },
      [other('b', 'B', ['t1', 't2'])],
    )).toBeNull();
  });

  // Asymmetric on purpose: the rare behaviour is fully explained by the common
  // one, the common one is not explained by the rare one.
  it('reports on the contained row and not on the containing one', () => {
    const rare = ['t1', 't2'];
    const common = ['t1', 't2', 't3', 't4', 't5', 't6'];
    expect(findOverlap({ kind: 'rare', occurrenceIds: rare }, [other('common', 'C', common)])?.shared).toBe(2);
    expect(findOverlap({ kind: 'common', occurrenceIds: common }, [other('rare', 'R', rare)])).toBeNull();
  });

  it('picks the strongest overlap when there are several', () => {
    const o = findOverlap(
      { kind: 'a', occurrenceIds: ['t1', 't2', 't3'] },
      [other('b', 'B', ['t1', 't2']), other('c', 'C', ['t1', 't2', 't3'])],
    );
    expect(o?.kind).toBe('c');
  });

  it('never compares a row against itself', () => {
    expect(findOverlap(
      { kind: 'a', occurrenceIds: ['t1', 't2', 't3'] },
      [other('a', 'A', ['t1', 't2', 't3'])],
    )).toBeNull();
  });

  it('is null for a behaviour that never occurred', () => {
    expect(findOverlap({ kind: 'a', occurrenceIds: [] }, [other('b', 'B', ['t1', 't2'])])).toBeNull();
  });
});

// ── a kind that never happened ──────────────────────────────────────────────
//
// deriveStatus falls through to 'detected' for any kind it tallied, and a kind
// can be tallied with zero occurrences — it had opportunities and simply never
// happened. The row then read "זוהתה · 0 / 34 · 0%": a behaviour that was
// noticed and never observed, on the same line.

describe('the status a row shows', () => {
  it('is not "detected" when the behaviour never occurred', () => {
    expect(presentedStatus('detected', 0)).toBeNull();
  });

  it('keeps the stored status once it has happened at all', () => {
    expect(presentedStatus('detected', 1)).toBe('detected');
    expect(presentedStatus('confirmed', 6)).toBe('confirmed');
  });

  it('passes an absent status through unchanged', () => {
    expect(presentedStatus(null, 5)).toBeNull();
    expect(presentedStatus(undefined, 5)).toBeNull();
  });

  // Undetected is outside the process, so the row falls to the bottom and
  // renders its "we looked and did not find it" note.
  it('lands the row outside the lifecycle', () => {
    expect(stageFor(presentedStatus('detected', 0))).toBe('undetected');
  });
});

// ── the words a trader reads ────────────────────────────────────────────────

describe('the labels are readable without a statistics book', () => {
  it('has dropped the jargon that was on screen', () => {
    const all = Object.values(TREND_LABELS).join(' ');
    expect(all).not.toContain('מובהק');
  });

  it('still separates the three directions', () => {
    expect(TREND_LABELS.improving).not.toBe(TREND_LABELS.worsening);
    expect(TREND_LABELS.steady).not.toBe(TREND_LABELS.unknown);
  });

  // "no information" must never read as "nothing is wrong".
  it('does not let an unknown trend sound like good news', () => {
    expect(TREND_LABELS.unknown).not.toContain('פחות');
    expect(TREND_LABELS.unknown).not.toContain('אותו דבר');
  });
});
