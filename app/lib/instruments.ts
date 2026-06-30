/** Centralized futures instrument specs. Add a new instrument here — and nowhere else —
 * to support it across the journal, calculators, and analytics. */
export interface InstrumentSpec {
  /** Ticker symbol, also the storage key for TradeEntry.symbol. */
  symbol: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Smallest price increment the instrument trades in. */
  tickSize: number;
  /** Dollar value of one tick, per contract. */
  tickValue: number;
}

export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  MNQ: { symbol: 'MNQ', label: 'Micro Nasdaq',   tickSize: 0.25, tickValue: 0.5  },
  NQ:  { symbol: 'NQ',  label: 'E-mini Nasdaq',  tickSize: 0.25, tickValue: 5    },
  MES: { symbol: 'MES', label: 'Micro S&P 500',  tickSize: 0.25, tickValue: 1.25 },
  ES:  { symbol: 'ES',  label: 'E-mini S&P 500', tickSize: 0.25, tickValue: 12.5 },
};

export type InstrumentKey = keyof typeof INSTRUMENTS;
export const INSTRUMENT_KEYS = Object.keys(INSTRUMENTS) as InstrumentKey[];

/** Dollar value of a full 1.00-point move, per contract. Derived — never hardcode this elsewhere. */
export function pointValue(symbol: string): number {
  const spec = INSTRUMENTS[symbol];
  if (!spec) return INSTRUMENTS.ES.tickValue / INSTRUMENTS.ES.tickSize; // safe fallback
  return spec.tickValue / spec.tickSize;
}

export function isKnownInstrument(symbol: string): symbol is InstrumentKey {
  return symbol in INSTRUMENTS;
}
