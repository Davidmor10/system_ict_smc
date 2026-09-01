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
  clearDeclaredBias, planStorageKey, readDeclaredBias, ruleOfTheDay, writeBiasNote, writeDeclaredBias,
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
// The document is rendered for an account; the browser is signed in as one.
// They are different things — see lib/sync/owned — so a test that seeds only
// the shared stamp is describing a tab that has gone stale.
(globalThis as any).window = { localStorage, __ONYX_OWNER__: 'user_test' };

// Local storage is scoped to the signed-in account — see lib/sync/owned.
beforeEach(() => { store.clear(); store.set('onyx_local_owner', 'user_test'); });

// The plan record is stored under the signed-in account — see lib/sync/owned.
// These two helpers keep that contract in one place rather than open-coding
// the envelope in every test that seeds or inspects a plan.
const seedPlan = (key: string, doc: unknown) =>
  localStorage.setItem(key, JSON.stringify({ o: 'user_test', v: doc }));
const readPlan = (key: string) =>
  JSON.parse(localStorage.getItem(key)!).v;

describe('the plan record this screen shares with the dashboard', () => {
  // The key is built in the TRADER'S CONFIGURED ZONE — the same clock the
  // trade's own date comes from (journal.todayISO). Three clocks were in play
  // here historically and each fixed the previous one's failure:
  //
  //   UTC       the key rolled over at 21:00 or 22:00 Israel time, so the
  //             morning's direction vanished during the New York PM session
  //   browser   right only while the browser and the settings agree; a laptop
  //             on UTC, or a trip, wrote the direction under one date while
  //             the trade looked for it under another
  //   settings  what it is now, and what the trade date already used
  //
  // The suite runs on UTC, so these instants fall on a different day in
  // Asia/Jerusalem — which is the point being asserted.
  it('keys by the date in the trader\'s zone, matching dailyBias.ts', () => {
    // 23:30 UTC on the 21st is already 02:30 on the 22nd in Israel.
    expect(planStorageKey(new Date(Date.UTC(2026, 7, 21, 23, 30)))).toBe('onyx_dash_planobj_2026-08-22');
    // Mid-afternoon UTC is the same day everywhere that matters here.
    expect(planStorageKey(new Date(Date.UTC(2026, 7, 21, 12, 0)))).toBe('onyx_dash_planobj_2026-08-21');
    expect(planStorageKey(new Date(Date.UTC(2026, 0, 3, 9, 5)))).toBe('onyx_dash_planobj_2026-01-03');
  });

  // The whole point of one clock: the module that WRITES the record and the
  // module that READS it must build the same string for the same instant.
  it('agrees with the reader in dailyBias for the same instant', async () => {
    const { getDeclaredBiasForDate } = await import('../../app/lib/dailyBias');
    const at = new Date(Date.UTC(2026, 7, 21, 23, 30));   // the 22nd in Israel
    writeDeclaredBias('bear', '', at);
    const dayInZone = planStorageKey(at).replace('onyx_dash_planobj_', '');
    expect(getDeclaredBiasForDate(dayInZone)).toBe('BEARISH');
  });

  it('round-trips a declaration', () => {
    writeDeclaredBias('bull', '', AT);
    expect(readDeclaredBias(AT)).toEqual({
      bias: 'bull', at: AT.getTime(), note: '', history: [{ bias: 'bull', at: AT.getTime() }],
    });
  });

  it('carries the reason, and keeps the stamp when only the reason changes', () => {
    // The timestamp answers "how early did they make the call". Typing a
    // sentence an hour later is not making the call again.
    writeDeclaredBias('bear', 'סוויפ של הגבוה של אסיה', AT);
    expect(readDeclaredBias(AT)).toMatchObject({ bias: 'bear', at: AT.getTime(), note: 'סוויפ של הגבוה של אסיה' });

    writeBiasNote('שיניתי דעה אחרי הפתיחה', AT);
    const after = readDeclaredBias(AT);
    expect(after?.note).toBe('שיניתי דעה אחרי הפתיחה');
    expect(after?.bias).toBe('bear');
    expect(after?.at).toBe(AT.getTime());
  });

  // A trader who opens bullish and turns bearish at noon has not corrected a
  // mistake, they have changed their read — and a trade taken at ten was
  // graded against the direction that stood at ten, not the one that came
  // later. Keeping only the latest threw the first half of the day away.
  it('keeps every change of mind, with the hour of each', () => {
    const morning = new Date(2026, 7, 21, 9, 5, 0);
    const noon    = new Date(2026, 7, 21, 13, 42, 0);
    writeDeclaredBias('bull', '', morning);
    writeDeclaredBias('bear', '', noon);

    const d = readDeclaredBias(noon)!;
    expect(d.bias).toBe('bear');
    expect(d.history).toEqual([
      { bias: 'bull', at: morning.getTime() },
      { bias: 'bear', at: noon.getTime() },
    ]);
  });

  it('does not record re-saving the same direction as a change', () => {
    const morning = new Date(2026, 7, 21, 9, 5, 0);
    writeDeclaredBias('bull', '', morning);
    writeDeclaredBias('bull', '', new Date(2026, 7, 21, 10, 0, 0));
    expect(readDeclaredBias(AT)!.history).toHaveLength(1);
  });

  it('reads a day recorded before the history existed as one declaration', () => {
    seedPlan(planStorageKey(AT), { bias: 'bear', biasAt: AT.getTime() });
    expect(readDeclaredBias(AT)!.history).toEqual([{ bias: 'bear', at: AT.getTime() }]);
  });

  // Withdrawing is not the same as declaring 'neutral'. Neutral is a read —
  // "I looked and I have no view" — and it grades trades against itself. This
  // is the trader saying they never made the call.
  it('withdrawing leaves nothing for the trade form to align against', () => {
    writeDeclaredBias('bull', '', AT);
    clearDeclaredBias(AT);
    expect(readDeclaredBias(AT)).toBeNull();
    const doc = readPlan(planStorageKey(AT));
    expect(doc.biasHistory).toBeUndefined();
  });

  it('withdrawing keeps the rest of the plan', () => {
    seedPlan(planStorageKey(AT), { notes: 'לחכות לסוויפ', bias: 'bull', biasAt: 1 });
    clearDeclaredBias(AT);
    expect(readPlan(planStorageKey(AT)).notes).toBe('לחכות לסוויפ');
  });

  it('will not write a reason onto a day with no declaration', () => {
    writeBiasNote('אין לי כיוון', AT);
    expect(readDeclaredBias(AT)).toBeNull();
  });

  it('keeps every other field of the plan', () => {
    seedPlan(planStorageKey(AT), { notes: 'לחכות לסוויפ של אסיה', target: 3, bias: 'bear' });
    writeDeclaredBias('bull', '', AT);
    const doc = readPlan(planStorageKey(AT));
    expect(doc.notes).toBe('לחכות לסוויפ של אסיה');
    expect(doc.target).toBe(3);
    expect(doc.bias).toBe('bull');
  });

  it('survives a corrupt or non-object record instead of throwing', () => {
    localStorage.setItem(planStorageKey(AT), '}{not json');
    expect(readDeclaredBias(AT)).toBeNull();
    expect(() => writeDeclaredBias('neutral', '', AT)).not.toThrow();
    expect(readDeclaredBias(AT)?.bias).toBe('neutral');

    localStorage.setItem(planStorageKey(AT), '[1,2,3]');
    expect(() => writeDeclaredBias('bull', '', AT)).not.toThrow();
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
