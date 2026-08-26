// The three answers only the trader can give.
//
// Every price on the trade form was already required, so the numeric side of
// a trade was complete by construction. The human side was optional — and it
// is the side the behaviour layer is built on, with a cost that is easy to
// miss: an unanswered rule verdict or stop question does not make a trade look
// clean, it removes the trade from the measurement entirely. Three behaviours
// sat at low confidence because their denominators were half the journal.
//
// The one that must never join the list is confirmations, and these tests pin
// that too — the detector that reads it measures its EMPTINESS, so requiring
// the field would silence it permanently.

import { describe, it, expect } from 'vitest';
import { missingAnswers } from '../../app/lib/journal';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000 + (seq++),
  dateISO: '2026-08-10',
  time: '17:00',
  symbol: 'MNQ',
  direction: 'LONG',
  session: 'ny_am',
  entry: 20000,
  stop: 19980,
  target: 20060,
  result: 'WIN',
  pnlUsd: 200,
  tradeR: 2,
  contracts: 1,
  bias: 'BULLISH',
  model: '',
  notes: '',
  ...(over as object),
} as TradeEntry);

/** Everything answered. */
const complete = (over: Partial<TradeEntry> = {}) => trade({
  followedRules: true,
  stopMoved: 'none',
  emotionalState: 'CALM',
  ...over,
});

describe('missingAnswers', () => {
  it('finds nothing on a fully answered trade', () => {
    expect(missingAnswers(complete())).toEqual([]);
  });

  it('names all three on a trade that answered none', () => {
    const m = missingAnswers(trade({}));
    expect(m.map(x => x.key).sort()).toEqual(['emotionalState', 'followedRules', 'stopMoved']);
  });

  it('counts "I kept my rules" and "I broke them" both as answers', () => {
    expect(missingAnswers(complete({ followedRules: true }))).toEqual([]);
    expect(missingAnswers(complete({ followedRules: false }))).toEqual([]);
  });

  it('counts "I did not touch it" as an answer', () => {
    // The whole design rests on this. Every question has a reply that means
    // nothing happened, so the trader is pushed to ANSWER, never to report.
    expect(missingAnswers(complete({ stopMoved: 'none' }))).toEqual([]);
  });

  it('treats an unanswered rule verdict as missing, not as a clean trade', () => {
    // Silence used to read as "kept the rules" in any surface that counted a
    // boolean. It is a third state and stays one.
    expect(missingAnswers(complete({ followedRules: undefined })).map(x => x.key)).toEqual(['followedRules']);
  });

  it('asks nothing of a position that is still open', () => {
    // Its stop may yet move. Asking how it went is asking about something that
    // has not happened.
    expect(missingAnswers(trade({ result: 'OPEN', tradeR: undefined, pnlUsd: undefined }))).toEqual([]);
  });

  it('asks the same of a break-even trade as of a win', () => {
    expect(missingAnswers(trade({ result: 'BE', tradeR: 0 })).map(x => x.key).sort())
      .toEqual(['emotionalState', 'followedRules', 'stopMoved']);
  });

  it('never asks for confirmations', () => {
    // THE ONE THAT MUST NOT BE ON THE LIST. detectNoConfirmation measures the
    // emptiness of this field; require it and the detector can never fire.
    const bare = trade({ followedRules: true, stopMoved: 'none', emotionalState: 'CALM', confirmations: undefined });
    expect(missingAnswers(bare)).toEqual([]);
  });

  it('never asks for notes, a screenshot or a model', () => {
    const bare = complete({ notes: '', screenshots: undefined, model: '' });
    expect(missingAnswers(bare)).toEqual([]);
  });

  it('carries a Hebrew label for each gap, for the journal to print', () => {
    const m = missingAnswers(trade({}));
    expect(m.every(x => x.label.length > 0 && /[֐-׿]/.test(x.label))).toBe(true);
  });
});
