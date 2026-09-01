// A direction the trader never gave must not come back as one they did.
//
// `bias` was required and defaulted to INDECISIVE whenever the field was left
// blank. So a trader who never answered was stored as having answered "no
// directional view", and on reopening the trade that chip came back SELECTED.
// Proven in a browser: the same chip carried the unselected classes on a fresh
// form and the selected ones on a trade saved blank.
//
// Same failure as `setup` defaulting to REVERSAL and followedRules defaulting
// to true. Absent is its own answer.

import { describe, expect, it } from 'vitest';
import { rowToTrade, tradeToRow, type TradeRow } from '../../app/lib/journalRow';
import { tradeEntrySchema } from '../../app/lib/validation';
import { migrateTrade } from '../../app/lib/journal';
import { makeTrade } from '../helpers/trade';

const row = (over: Partial<TradeRow>): TradeRow =>
  ({ ...tradeToRow('user_test', makeTrade()), ...over } as TradeRow);

describe('a trade with no recorded direction', () => {
  it('survives the round trip to the cloud as absent, not as INDECISIVE', () => {
    const saved = tradeToRow('user_test', makeTrade({ bias: undefined }));
    expect(saved.bias).toBeNull();
    expect(rowToTrade(saved).bias).toBeUndefined();
  });

  it('keeps a direction the trader did choose', () => {
    for (const bias of ['BULLISH', 'BEARISH', 'INDECISIVE'] as const) {
      const saved = tradeToRow('user_test', makeTrade({ bias }));
      expect(saved.bias).toBe(bias);
      expect(rowToTrade(saved).bias).toBe(bias);
    }
  });

  // Rows written before the column allowed null still hold 'INDECISIVE'. That
  // is a real answer as far as anything can now tell, and is kept as one.
  it('reads a pre-migration row as the answer it holds', () => {
    expect(rowToTrade(row({ bias: 'INDECISIVE' })).bias).toBe('INDECISIVE');
  });

  it('reads a null column as absent', () => {
    expect(rowToTrade(row({ bias: null })).bias).toBeUndefined();
  });

  // The API accepts a trade that never answered the question.
  it('passes validation without a direction', () => {
    const { bias: _dropped, ...noBias } = makeTrade();
    expect(tradeEntrySchema.safeParse(noBias).success).toBe(true);
  });

  it('still rejects a direction that is not one of the three', () => {
    expect(tradeEntrySchema.safeParse({ ...makeTrade(), bias: 'SIDEWAYS' }).success).toBe(false);
  });

  // The local path, which is the one the journal actually paints from.
  it('does not invent a direction when loading from the device', () => {
    const { bias: _dropped, ...noBias } = makeTrade();
    expect(migrateTrade(noBias)?.bias).toBeUndefined();
  });

  it('ignores a stored value that is not a direction', () => {
    expect(migrateTrade({ ...makeTrade(), bias: 'SIDEWAYS' })?.bias).toBeUndefined();
  });
});
