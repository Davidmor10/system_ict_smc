// ─────────────────────────────────────────────────────────────────────────────
// The entry gate — the screen behind the sign-in.
//
// Two things here are load-bearing and neither is obvious from reading the UI:
//
//   1. The bias declared on this screen has to land in the SAME record the
//      dashboard's daily plan writes, under a LOCAL-time key. A key that is off
//      by a timezone means the trade form cannot find the direction the trader
//      declared ten minutes earlier, and every trade that day is stamped with
//      no alignment at all.
//   2. Writing that record must not flatten it. The plan object holds fields
//      this screen never renders; a plain `setItem(key, {bias})` would erase
//      the trader's plan to save a two-letter string.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from 'vitest';
import {
  BIAS_META, countdownTo, humanizeMinutes, isNewYorkOpen, nextMacro,
  planStorageKey, readDeclaredBias, ruleOfTheDay, writeDeclaredBias,
  type MacroLike,
} from '../../app/lib/entryGate';
import type { Rule } from '../../app/lib/rules/types';

const AT = new Date(2026, 7, 21, 14, 27, 0);       // local, 21 Aug 2026 14:27

// The suite runs on `node`, which has no window. Rather than pull in jsdom for
// one file, this is the smallest store the module actually uses.
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage };

beforeEach(() => { store.clear(); });

describe('the plan record this screen shares with the dashboard', () => {
  it('keys by the LOCAL date, matching dailyBias.ts', () => {
    // Late evening in Israel is already "tomorrow" in UTC. If this key were
    // built from toISOString() the bias would vanish mid-session.
    expect(planStorageKey(new Date(2026, 7, 21, 23, 30))).toBe('onyx_dash_planobj_2026-08-21');
    expect(planStorageKey(new Date(2026, 0, 3, 0, 5))).toBe('onyx_dash_planobj_2026-01-03');
  });

  it('round-trips a declaration', () => {
    writeDeclaredBias('bull', AT);
    expect(readDeclaredBias(AT)).toEqual({ bias: 'bull', at: AT.getTime() });
  });

  it('keeps every other field of the plan', () => {
    localStorage.setItem(
      planStorageKey(AT),
      JSON.stringify({ notes: 'לחכות לסוויפ של אסיה', target: 3, bias: 'bear' }),
    );
    writeDeclaredBias('bull', AT);
    const doc = JSON.parse(localStorage.getItem(planStorageKey(AT))!);
    expect(doc.notes).toBe('לחכות לסוויפ של אסיה');
    expect(doc.target).toBe(3);
    expect(doc.bias).toBe('bull');
  });

  it('survives a corrupt or non-object record instead of throwing', () => {
    localStorage.setItem(planStorageKey(AT), '}{not json');
    expect(readDeclaredBias(AT)).toBeNull();
    expect(() => writeDeclaredBias('neutral', AT)).not.toThrow();
    expect(readDeclaredBias(AT)?.bias).toBe('neutral');

    localStorage.setItem(planStorageKey(AT), '[1,2,3]');
    expect(() => writeDeclaredBias('bull', AT)).not.toThrow();
    expect(readDeclaredBias(AT)?.bias).toBe('bull');
  });

  it('reads nothing when today has no record, and ignores a junk bias', () => {
    expect(readDeclaredBias(AT)).toBeNull();
    localStorage.setItem(planStorageKey(AT), JSON.stringify({ bias: 'sideways' }));
    expect(readDeclaredBias(AT)).toBeNull();
  });

  it('offers exactly the three directions the journal understands', () => {
    expect(Object.keys(BIAS_META)).toEqual(['bull', 'bear', 'neutral']);
    expect(BIAS_META.neutral.en).toBe('INDECISIVE');
  });
});

describe('countdowns', () => {
  it('counts to a target later today', () => {
    expect(countdownTo(16.5, 14)).toBe('02:30:00');
    expect(countdownTo(23, 22.5)).toBe('00:30:00');
  });

  it('wraps past midnight rather than going negative', () => {
    // 23:30 now, New York opens 16:30 — seventeen hours, not minus seven.
    expect(countdownTo(16.5, 23.5)).toBe('17:00:00');
  });

  it('knows when New York is open', () => {
    expect(isNewYorkOpen(16.4)).toBe(false);
    expect(isNewYorkOpen(16.5)).toBe(true);
    expect(isNewYorkOpen(22.99)).toBe(true);
    expect(isNewYorkOpen(23)).toBe(false);
  });
});

describe('rule of the day', () => {
  const mk = (id: string, isActive = true, deleted = false): Rule =>
    ({ id, title: id, category: 'risk', isActive, deleted }) as Rule;

  it('returns null when there is nothing active — a new account has no rules', () => {
    expect(ruleOfTheDay([], AT)).toBeNull();
    expect(ruleOfTheDay([mk('a', false)], AT)).toBeNull();
    expect(ruleOfTheDay([mk('a', true, true)], AT)).toBeNull();
  });

  it('is stable within a day and moves across days', () => {
    const rules = [mk('a'), mk('b'), mk('c')];
    const first = ruleOfTheDay(rules, new Date(2026, 7, 21, 8, 0));
    const later = ruleOfTheDay(rules, new Date(2026, 7, 21, 23, 0));
    expect(later).toBe(first);

    const days = new Set(
      [21, 22, 23].map(d => ruleOfTheDay(rules, new Date(2026, 7, d))?.id),
    );
    expect(days.size).toBe(3);
  });

  it('never picks a rule that was switched off', () => {
    const rules = [mk('off', false), mk('on')];
    for (let d = 1; d <= 28; d++) {
      expect(ruleOfTheDay(rules, new Date(2026, 7, d))?.id).toBe('on');
    }
  });
});

describe('next macro event', () => {
  const ev = (dateIsrael: string, timeIsrael: string, title = 'CPI'): MacroLike =>
    ({ title, impact: 'High', dateIsrael, timeIsrael });

  it('picks the soonest event still ahead', () => {
    const got = nextMacro(
      [ev('2026-08-21', '15:30'), ev('2026-08-21', '21:00'), ev('2026-08-22', '09:30')],
      '2026-08-21',
      14 * 60 + 27,
    );
    expect(got?.event.timeIsrael).toBe('15:30');
    expect(got?.minutes).toBe(63);
  });

  it('skips what already happened, including earlier today', () => {
    const got = nextMacro(
      [ev('2026-08-20', '15:30'), ev('2026-08-21', '09:30'), ev('2026-08-21', '21:00')],
      '2026-08-21',
      14 * 60 + 27,
    );
    expect(got?.event.timeIsrael).toBe('21:00');
  });

  it('crosses into tomorrow when nothing is left today', () => {
    const got = nextMacro([ev('2026-08-22', '09:30')], '2026-08-21', 23 * 60);
    expect(got?.minutes).toBe(10 * 60 + 30);
  });

  it('skips all-day rows, which have no clock to count down to', () => {
    expect(nextMacro([ev('2026-08-21', '')], '2026-08-21', 60)).toBeNull();
    expect(nextMacro([ev('2026-08-21', 'all-day')], '2026-08-21', 60)).toBeNull();
  });

  it('returns null on an empty or unusable feed instead of inventing an event', () => {
    expect(nextMacro([], '2026-08-21', 600)).toBeNull();
    expect(nextMacro([ev('not-a-date', '15:30')], '2026-08-21', 600)).toBeNull();
  });
});

describe('humanizeMinutes', () => {
  it('stays in minutes up to an hour and a half', () => {
    expect(humanizeMinutes(43)).toBe('43 דק׳');
    expect(humanizeMinutes(90)).toBe('90 דק׳');
  });

  it('switches to hours past that, zero-padding the minutes', () => {
    expect(humanizeMinutes(91)).toBe('1 שע׳ 31 דק׳');
    expect(humanizeMinutes(125)).toBe('2 שע׳ 05 דק׳');
  });

  it('never shows zero', () => {
    expect(humanizeMinutes(0)).toBe('1 דק׳');
  });
});
