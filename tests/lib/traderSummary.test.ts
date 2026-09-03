// The dashboard's opening paragraph.
//
// One sentence in it compares one group of trades against another, and
// AGENTS.md makes that a rule rather than a preference: the comparison goes
// through lib/stats/fisher.ts, is corrected for the comparisons made, and
// takes its sample floor from lib/stats/evidence.ts. A win rate that moved
// from 44% to 52% over seventeen trades a side is a coin, and calling it
// improvement is how a system earns a trader's trust and then loses it.

import { describe, expect, it } from 'vitest';
import {
  winRateShift, splitHalves, summarizeTrader,
  type TradingFacts, type BehaviourFacts,
} from '../../app/lib/progress/traderSummary';
import { MIN_DECIDED_FOR_CLAIM } from '../../app/lib/stats/evidence';

const facts = (o: Partial<TradingFacts> = {}): TradingFacts => ({
  closed: 34, wins: 16, losses: 15, bes: 3, decided: 31,
  winRate: 16 / 31, profitFactor: 1.28, avgR: 0.18,
  netPnl: 242, startingBalance: 50000, tradingDays: 17,
  missingExit: 0, missingRules: 0, ...o,
});

const behaviour = (o: Partial<BehaviourFacts> = {}): BehaviourFacts => ({
  watched: 5, detected: 5, open: null, changed: 0, relapsed: 0, insufficientEvidence: false, ...o,
});

describe('the win-rate shift', () => {
  // The floor is shared, not invented here.
  it('refuses to compare when either half is below the shared floor', () => {
    const thin = MIN_DECIDED_FOR_CLAIM - 1;
    expect(winRateShift({
      earlier: { wins: thin, losses: 0 }, later: { wins: 0, losses: 10 },
    }).kind).toBe('insufficient');
    expect(winRateShift({
      earlier: { wins: 5, losses: 10 }, later: { wins: thin, losses: 0 },
    }).kind).toBe('insufficient');
  });

  // The case this test file exists for.
  it('does not call an ordinary wobble a change', () => {
    // 44% then 52% over seventeen a side — the shape of his own journal.
    const s = winRateShift({ earlier: { wins: 7, losses: 9 }, later: { wins: 9, losses: 8 } });
    expect(s.kind).toBe('flat');
    if (s.kind === 'flat') {
      expect(Math.round(s.earlier * 100)).toBe(44);
      expect(Math.round(s.later * 100)).toBe(53);
    }
  });

  it('reports a direction only when a difference that large is not chance', () => {
    const s = winRateShift({ earlier: { wins: 2, losses: 24 }, later: { wins: 22, losses: 4 } });
    expect(s.kind).toBe('moved');
    if (s.kind === 'moved') expect(s.direction).toBe('up');
  });

  it('names a fall as a fall', () => {
    const s = winRateShift({ earlier: { wins: 22, losses: 4 }, later: { wins: 2, losses: 24 } });
    expect(s.kind).toBe('moved');
    if (s.kind === 'moved') expect(s.direction).toBe('down');
  });

  it('splits a chronological history down the middle', () => {
    const h = splitHalves(['WIN', 'WIN', 'LOSS', 'LOSS', 'WIN', 'WIN']);
    expect(h.earlier).toEqual({ wins: 2, losses: 1 });
    expect(h.later).toEqual({ wins: 2, losses: 1 });
  });

  it('survives an empty history', () => {
    expect(winRateShift(splitHalves([])).kind).toBe('insufficient');
  });
});

describe('the paragraph', () => {
  it('states the rate over the trades that decided, not over all of them', () => {
    const text = summarizeTrader(facts(), { kind: 'insufficient' }, null).join(' ');
    expect(text).toContain('31 עסקאות שהוכרעו');
    expect(text).toContain('34 עסקאות סגורות');
  });

  it('names break-even trades rather than folding them into either side', () => {
    expect(summarizeTrader(facts(), { kind: 'insufficient' }, null).join(' ')).toContain('3 בתיקו');
  });

  it('shows a loss as a loss', () => {
    const text = summarizeTrader(facts({ netPnl: -1240 }), { kind: 'insufficient' }, null).join(' ');
    expect(text).toContain('−$1,240');
  });

  it('says outright when there is nothing to compare yet', () => {
    const text = summarizeTrader(facts(), { kind: 'insufficient' }, null).join(' ');
    expect(text).toContain('עוד אין מספיק עסקאות כדי להשוות');
  });

  // A tested difference that failed the test is reported as such, with both
  // numbers, rather than hidden — hiding it invites the reader to find it
  // elsewhere and conclude the summary was spinning.
  it('shows both rates even when the difference did not survive the test', () => {
    const text = summarizeTrader(facts(), { kind: 'flat', earlier: 0.44, later: 0.53 }, null).join(' ');
    expect(text).toContain('44%');
    expect(text).toContain('53%');
    expect(text).toContain('קטן מדי מכדי לדעת');
  });

  it('carries the open window and how far it has to go', () => {
    const text = summarizeTrader(
      facts(), { kind: 'insufficient' },
      behaviour({ open: { label: 'הרחקת הסטופ', done: 6, of: 10 } }),
    ).join(' ');
    expect(text).toContain('הרחקת הסטופ');
    expect(text).toContain('עוד 4');
  });

  it('names the gaps in the journal, and what they cost', () => {
    const text = summarizeTrader(facts({ missingExit: 4, missingRules: 7 }), { kind: 'insufficient' }, null).join(' ');
    expect(text).toContain('4 בלי מחיר יציאה');
    expect(text).toContain('7 בלי תשובה על החוקים');
    expect(text).toContain('לא נכנס לאף חישוב');
  });

  it('has something to say on an account with no closed trade', () => {
    const text = summarizeTrader(
      facts({ closed: 0, wins: 0, losses: 0, bes: 0, decided: 0, winRate: null, profitFactor: null, avgR: null, netPnl: 0, tradingDays: 0 }),
      { kind: 'insufficient' }, behaviour({ detected: 0, insufficientEvidence: true }),
    ).join(' ');
    expect(text).toContain('עוד לא נסגרה עסקה');
    // No trend sentence when there is no history to have a trend in.
    expect(text).not.toContain('להשוות תקופה לתקופה');
  });

  // The line that keeps this paragraph from contradicting the analytics
  // stack on the screen next door — see docs/ai-architecture.md.
  it('never names an edge, a cause, or an action', () => {
    const text = summarizeTrader(
      facts({ missingExit: 2 }),
      { kind: 'moved', direction: 'up', earlier: 0.3, later: 0.6 },
      behaviour({ open: { label: 'x', done: 1, of: 10 }, changed: 2 }),
    ).join(' ');
    for (const forbidden of ['היתרון שלך', 'עובד לך', 'בגלל', 'כי אתה', 'מומלץ', 'כדאי', 'אתה צריך']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// The one claim that would make this paragraph worth less than nothing.
describe('a relapse', () => {
  it('is said alongside the successes, never inside them', () => {
    const text = summarizeTrader(facts(), { kind: 'insufficient' }, behaviour({ changed: 3, relapsed: 1 })).join(' ');
    expect(text).toContain('3 התנהגויות כבר שינית, והשינוי החזיק');
    expect(text).toContain('ואחת חזרה אחרי שנסגרה');
    expect(text).not.toContain('ו-אחת');
  });

  it('is said even when nothing has held yet', () => {
    const text = summarizeTrader(facts(), { kind: 'insufficient' }, behaviour({ changed: 0, relapsed: 2 })).join(' ');
    expect(text).toContain('2 התנהגויות חזרו');
    expect(summarizeTrader(facts(), { kind: 'insufficient' }, behaviour({ changed: 0, relapsed: 1 })).join(' '))
      .toContain('התנהגות אחת חזרה אחרי שנסגרה');
  });
});

// A template writes "1 עסקאות סגורות". Nobody does, and a paragraph whose
// whole purpose is to read like language cannot afford it.
describe('Hebrew agreement', () => {
  const single = facts({
    closed: 1, wins: 1, losses: 0, bes: 0, decided: 1, winRate: 1,
    profitFactor: null, avgR: 3, netPnl: 60, tradingDays: 1,
  });

  it('does not say "1 עסקאות"', () => {
    const text = summarizeTrader(single, { kind: 'insufficient' }, null).join(' ');
    expect(text).toContain('עסקה סגורה אחת');
    expect(text).toContain('ביום מסחר אחד');
    expect(text).toContain('אחת מנצחת');
    expect(text).not.toMatch(/\b1 עסקאות/);
    expect(text).not.toMatch(/\b1 ימי/);
  });

  it('leaves out an outcome that did not happen', () => {
    const text = summarizeTrader(single, { kind: 'insufficient' }, null).join(' ');
    expect(text).not.toContain('0 מפסידות');
    expect(text).not.toContain('0 בתיקו');
  });

  it('agrees on the decided count too', () => {
    expect(summarizeTrader(single, { kind: 'insufficient' }, null).join(' '))
      .toContain('על עסקה אחת שהוכרעה');
  });

  it('agrees in the behaviour and journal sentences', () => {
    const text = summarizeTrader(
      facts({ missingExit: 1, missingRules: 1 }),
      { kind: 'insufficient' },
      behaviour({ open: { label: 'x', done: 1, of: 10 }, changed: 1 }),
    ).join(' ');
    expect(text).toContain('נספרה הזדמנות אחת');
    expect(text).toContain('התנהגות אחת כבר שינית, והשינוי החזיק');
    expect(text).toContain('אחת בלי מחיר יציאה');
    expect(text).not.toMatch(/\b1 בלי/);
  });
});

// The sentence renders inside a right-to-left page. "מ-44% ל-53%" puts two
// left-to-right runs either side of a hyphen, and the browser reorders them —
// on screen the two rates appeared to have swapped places.
describe('the trend sentence survives RTL', () => {
  it('never puts both rates in one hyphenated clause', () => {
    for (const shift of [
      { kind: 'flat' as const, earlier: 0.44, later: 0.53 },
      { kind: 'moved' as const, direction: 'up' as const, earlier: 0.3, later: 0.6 },
    ]) {
      const line = summarizeTrader(facts(), shift, null).find(l => l.includes('%'))!;
      expect(line).not.toMatch(/מ-\d+% ל-/);
      // One number per clause, so nothing can be reordered into a lie.
      for (const clause of line.split('.')) {
        expect((clause.match(/%/g) ?? []).length).toBeLessThanOrEqual(1);
      }
    }
  });
});
