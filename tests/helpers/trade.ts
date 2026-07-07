import type { TradeEntry } from '../../app/lib/journal';

let seq = 1;

/** Builds a minimal, valid TradeEntry for tests. Every field has a sane
    default so a test only needs to specify what it actually cares about. */
export function makeTrade(overrides: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id: seq++,
    dateISO: '2026-07-06',
    time: '09:30',
    symbol: 'ES',
    contracts: 1,
    direction: 'LONG',
    entry: 100,
    stop: 99,
    target: 102,
    session: 'nyam',
    bias: 'BULLISH',
    model: 'FVG',
    result: 'WIN',
    notes: '',
    ...overrides,
  };
}
