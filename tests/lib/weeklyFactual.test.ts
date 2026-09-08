// The weekly report for a week too small to conclude anything.
//
// Before this, such a week produced nothing: the service returned null below
// five closed trades and no row was ever written. A trader who took four
// trades opened the report and found an explanation of why there was no
// report — their own restraint rendered back to them as a shortfall.
//
// The rules this file holds the line on:
//   1. Something is always written, at every count including zero.
//   2. What is written is the trader's own numbers, never an inference.
//   3. The report says out loud what it cannot conclude, and why.

import { describe, expect, it } from 'vitest';
import {
  factualWeeklyReport, daysIntoWeekFrom, weekdayHe, shortDateHe, signedRHe,
} from '../../app/lib/intelligence/weeklyFactual';
import { MIN_TRADES_FOR_WEEKLY_CLAIMS } from '../../app/lib/intelligence/weeklyRules';
import type { TradeEntry } from '../../app/lib/journal';

function trade(over: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id: Math.floor(Math.random() * 1e9),
    dateISO: '2026-09-02', time: '16:30', symbol: 'MNQ', contracts: 1,
    direction: 'LONG', entry: 29840, stop: 29810, target: 29930,
    session: 'nyam', bias: 'BULLISH', model: 'Silver Bullet',
    result: 'WIN', notes: '', tradeR: 2, pnlUsd: 120,
    ...over,
  } as TradeEntry;
}

const win  = (o: Partial<TradeEntry> = {}) => trade({ result: 'WIN',  tradeR: 2,  ...o });
const loss = (o: Partial<TradeEntry> = {}) => trade({ result: 'LOSS', tradeR: -1, ...o });
const open = (o: Partial<TradeEntry> = {}) => trade({ result: 'OPEN', tradeR: 0,  ...o });

function build(weekTrades: TradeEntry[], over: Partial<Parameters<typeof factualWeeklyReport>[0]> = {}) {
  return factualWeeklyReport({
    weekTrades,
    prevWeekTrades: [],
    journalTrades: weekTrades,
    daysIn: 4,
    claimFloor: MIN_TRADES_FOR_WEEKLY_CLAIMS,
    ...over,
  });
}

describe('daysIntoWeekFrom', () => {
  it('counts from the week start, today included', () => {
    expect(daysIntoWeekFrom('2026-08-31', '2026-08-31')).toBe(1);
    expect(daysIntoWeekFrom('2026-08-31', '2026-09-03')).toBe(4);
    expect(daysIntoWeekFrom('2026-08-31', '2026-09-06')).toBe(7);
  });

  it('never leaves the week, whatever it is handed', () => {
    // The server's clock is UTC and the trader's week is not; a stale or
    // skewed pair must not produce a day 0 or a day 9.
    expect(daysIntoWeekFrom('2026-08-31', '2026-08-29')).toBe(1);
    expect(daysIntoWeekFrom('2026-08-31', '2026-09-20')).toBe(7);
  });
});

describe('date wording', () => {
  it('reads the ISO date as a calendar day, not an instant', () => {
    // new Date('2026-09-03') is midnight UTC — the previous day in any
    // negative offset, which has renamed days in this codebase before.
    expect(weekdayHe('2026-09-03')).toBe('חמישי');
    expect(shortDateHe('2026-09-03')).toBe('3.9');
  });

  it('carries the sign of an R total in a word, not a glyph', () => {
    // A minus next to Hebrew is placed by the bidi algorithm, not the author,
    // and it lands on the wrong end often enough that a losing week can read
    // as a winning one.
    expect(signedRHe(3.5)).toBe('פלוס 3.5R');
    expect(signedRHe(-2)).toBe('מינוס 2.0R');
    expect(signedRHe(0)).toBe('אפס');
    expect(signedRHe(-2)).not.toContain('-');
  });
});

describe('a week with trades in it', () => {
  const week = [win(), loss({ dateISO: '2026-09-03' }), loss({ dateISO: '2026-09-03' }), win({ dateISO: '2026-09-04', symbol: 'MES' })];

  it('always writes something', () => {
    const r = build(week);
    expect(r.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(r.paragraphs.every(p => p.trim().length > 0)).toBe(true);
  });

  it('states the week the trader actually had', () => {
    const r = build(week).paragraphs.join('\n');
    expect(r).toContain('4 עסקאות');
    expect(r).toContain('2 ברווח');
    expect(r).toContain('2 בהפסד');
    // 2 + 2 - 1 - 1 = 2R.
    expect(r).toContain('פלוס 2.0R');
  });

  it('lists the trades themselves', () => {
    const r = build(week).paragraphs.join('\n');
    expect(r).toContain('MNQ לונג');
    expect(r).toContain('MES לונג');
    expect(r).toContain('חמישי, 3.9');
  });

  it('says outright what it cannot conclude, and names the floor', () => {
    const r = build(week).paragraphs.join('\n');
    expect(r).toContain('מקריות');
    expect(r).toContain(String(MIN_TRADES_FOR_WEEKLY_CLAIMS));
  });

  it('does not frame the week as a shortfall', () => {
    // The old copy: "זה מעט מכדי לכתוב על השבוע משהו שיחזיק. עוד עסקה אחת
    // והדוח ייכתב." Four trades is a week, not a deficit of one.
    const r = build(week).paragraphs.join('\n');
    expect(r).not.toContain('עוד עסקה אחת');
    expect(r).not.toContain('חסר');
  });

  it('never asserts a trend, a cause, or an edge', () => {
    const r = build(week).paragraphs.join('\n');
    for (const forbidden of ['מגמה של', 'בגלל ש', 'היתרון שלך', 'משתפר', 'מדרדר', 'כדאי לך']) {
      expect(r).not.toContain(forbidden);
    }
  });

  it('places the week inside the whole journal', () => {
    const journal = [...week, ...Array.from({ length: 30 }, () => win({ dateISO: '2026-07-01' }))];
    const r = build(week, { journalTrades: journal }).paragraphs.join('\n');
    expect(r).toContain('34 עסקאות');
    expect(r).toContain('4 מהן נסגרו השבוע');
  });

  it('counts last week without comparing to it', () => {
    const r = build(week, { prevWeekTrades: [win(), win(), loss()] }).paragraphs.join('\n');
    expect(r).toContain('בשבוע שעבר נסגרו 3 עסקאות');
    for (const comparative of ['יותר מ', 'פחות מ', 'לעומת']) {
      expect(r).not.toContain(comparative);
    }
  });

  it('counts open trades separately from closed ones', () => {
    const r = build([...week, open()]).paragraphs.join('\n');
    expect(r).toContain('4 עסקאות');
    expect(r).toContain('עסקה אחת נשארה פתוחה');
  });

  it('reads naturally at a single trade', () => {
    const r = build([loss()]).paragraphs.join('\n');
    expect(r).toContain('עסקה אחת');
    expect(r).toContain('הפסד אחד');
    expect(r).toContain('עסקה אחת שהוכרעה');
    expect(r).not.toContain('1 עסקאות');
  });

  it('does not count a break-even as decided', () => {
    const r = build([win(), trade({ result: 'BE', tradeR: 0 })]);
    expect(r.facts.decided).toBe(1);
    expect(r.facts.breakEven).toBe(1);
    expect(r.paragraphs.join('\n')).toContain('עסקה אחת שהוכרעה');
  });
});

describe('a week the trader sat out', () => {
  it('writes a report rather than an empty state', () => {
    const r = build([], { journalTrades: [win({ dateISO: '2026-07-01' })] });
    expect(r.paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it('calls it a decision, not a gap', () => {
    // The point: a week with no setup that met the trader's own conditions is
    // a week they did exactly what they should have. A journal that cannot
    // say so quietly rewards overtrading.
    const r = build([]).paragraphs.join('\n');
    expect(r).toContain('סבלנות');
    expect(r).toContain('זו לא ביקורת');
  });

  it('does not call a week empty before it has happened', () => {
    const r = build([], { daysIn: 1 }).paragraphs.join('\n');
    expect(r).toContain('השבוע רק התחיל');
  });

  it('separates "nothing closed" from "nothing happened"', () => {
    const r = build([open(), open()], { daysIn: 5 }).paragraphs.join('\n');
    expect(r).toContain('2 עסקאות פתוחות');
    expect(r).not.toContain('לא נפתחה אף עסקה');
  });
});

describe('the stored facts', () => {
  it('are counts, with nothing to interpret', () => {
    const r = build([win(), loss(), open()], { prevWeekTrades: [win()] });
    expect(r.facts).toMatchObject({
      kind: 'factual', closedThisWeek: 2, openThisWeek: 1,
      wins: 1, losses: 1, breakEven: 0, decided: 2,
      netR: 1, prevWeekClosed: 1,
    });
  });
});
