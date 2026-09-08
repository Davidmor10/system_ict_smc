// ─────────────────────────────────────────────────────────────────────────────
// Turning reconstructed TradingView trades into journal entries.
//
// Everything the app can work out for itself is worked out here rather than
// asked for: the session from the hour, the result from entry against exit,
// the R and the dollars from the app's own calculators. Using those calculators
// rather than re-implementing them is the point — an imported trade and a
// hand-logged one have to produce the same number from the same prices, or the
// two halves of a journal disagree.
//
// Everything only the trader knows is left EMPTY. The setup, the
// confirmations, the bias, the emotional state, whether they kept their rules:
// absent, not defaulted. `model` is the one exception the schema forces — it
// is a required string — and it gets UNSPECIFIED_MODEL, which the app already
// renders as "not stated" everywhere.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { UNSPECIFIED_MODEL } from '../journal';
import { calcMultiExitPnL, calcMultiExitRealizedR, inferResult } from '../calc/trade';
import { INSTRUMENT_KEYS, type InstrumentKey } from '../instruments';
import { sessionForHour } from '../sessions';
import { parseWallClock, reinterpret, toDateISO, toHHMM } from '../time/convert';
import type { ParsedTrade } from './tradingview';

/** "CME_MINI:MNQ1!" → "MNQ". Also handles a bare "MNQ" and a dated contract
 *  like "MNQZ2026".
 *
 *  Returns null for anything the app has no specification for. That refusal is
 *  deliberate and must stay loud: without a tick size and tick value there is
 *  no dollar figure for the instrument, and importing it anyway would produce
 *  a journal of confident zeroes. */
export function mapSymbol(raw: string): InstrumentKey | null {
  const bare = (raw.split(':').pop() ?? '').trim().toUpperCase();
  if (!bare) return null;
  // Continuous-contract notation ("MNQ1!") first, then a dated month
  // ("MNQZ2026"). The order matters and the "!" is required: a pattern loose
  // enough to strip trailing digits on its own eats the year out of MNQZ2026
  // and leaves MNQZ, which matches no instrument.
  const root = bare
    .replace(/\d+!$/, '')
    .replace(/[FGHJKMNQUVXZ]\d{2,4}$/, '');
  return (INSTRUMENT_KEYS as string[]).includes(root) ? (root as InstrumentKey) : null;
}

export type SkipReason = 'unknown_symbol' | 'unreadable_time' | 'no_contracts';

export interface Skipped {
  externalId: string;
  rawSymbol: string;
  reason: SkipReason;
  detail: string;
}

export interface MapOptions {
  /** The zone the file's timestamps are wall-clock readings in. */
  fileZone: string;
  /** The zone the journal files trades under — the trader's own clock. */
  appZone: string;
  /** Which portfolio these belong to. */
  accountId: string;
  /** Injected so the mapping can be tested without a browser; the default is
   *  the trader's own session table. */
  sessionFor?: (hourFloat: number) => string | null;
}

export interface MapResult {
  trades: TradeEntry[];
  skipped: Skipped[];
}

export function toTradeEntries(parsed: readonly ParsedTrade[], opts: MapOptions): MapResult {
  const sessionFor = opts.sessionFor ?? ((h: number) => sessionForHour(h));
  const trades: TradeEntry[] = [];
  const skipped: Skipped[] = [];

  for (const p of parsed) {
    const symbol = mapSymbol(p.rawSymbol);
    if (!symbol) {
      skipped.push({
        externalId: p.externalId, rawSymbol: p.rawSymbol, reason: 'unknown_symbol',
        detail: `המערכת עובדת עם ES, MES, NQ ו-MNQ בלבד. ${p.rawSymbol} לא נתמך.`,
      });
      continue;
    }

    const openWall = parseWallClock(p.openedAt);
    if (!openWall) {
      skipped.push({
        externalId: p.externalId, rawSymbol: p.rawSymbol, reason: 'unreadable_time',
        detail: `זמן כניסה לא קריא: "${p.openedAt}"`,
      });
      continue;
    }
    if (!Number.isFinite(p.contracts) || p.contracts <= 0) {
      skipped.push({
        externalId: p.externalId, rawSymbol: p.rawSymbol, reason: 'no_contracts',
        detail: 'עסקה בלי חוזים',
      });
      continue;
    }

    const local = reinterpret(openWall, opts.fileZone, opts.appZone);
    const hourFloat = local.hour + local.minute / 60;

    const exits = p.exit === null ? [] : [{ price: p.exit, contracts: p.contracts }];
    const open = exits.length === 0;

    // The stop only counts as risk when it is a real distance from the entry.
    // A stop sitting on the entry is one that was moved to breakeven, and an R
    // computed from it is a division by nothing.
    const riskStop = p.stop !== null && !p.stopIsAtEntry ? p.stop : null;

    const result = open
      ? 'OPEN'
      : inferResult(p.entry, riskStop ?? p.entry, p.target, p.exit as number, p.direction);

    const tradeR = !open && riskStop !== null
      ? calcMultiExitRealizedR(p.entry, riskStop, exits, p.direction)
      : null;
    const pnlUsd = open ? null : calcMultiExitPnL(p.entry, exits, p.direction, symbol);

    trades.push({
      // The opening order's id, which is stable across exports and three
      // orders of magnitude below the Date.now() ids a manual trade gets — so
      // a re-import lands on the same row and cannot collide with a hand-
      // logged one.
      id: Number(p.externalId) || Date.now(),
      dateISO: toDateISO(local),
      time: toHHMM(local),
      symbol,
      contracts: p.contracts,
      direction: p.direction,
      entry: p.entry,
      // Zero, not the entry: the journal's stop field is required, and writing
      // the entry into it would invent a zero-risk plan. Zero reads as "not
      // recorded" to every caller that checks, and the completion form asks.
      stop: p.stop ?? 0,
      target: p.target ?? 0,
      session: sessionFor(hourFloat) ?? '',
      model: UNSPECIFIED_MODEL,
      result,
      notes: '',
      accountId: opts.accountId,
      ...(exits.length > 0 ? { exits } : {}),
      ...(tradeR !== null ? { tradeR } : {}),
      ...(pnlUsd !== null ? { pnlUsd } : {}),
      updatedAt: Date.now(),
    });
  }

  return { trades, skipped };
}

/** Which of these are already in the journal.
 *
 *  Re-importing the same export must never touch a trade that is already
 *  there: the trader may have spent an evening filling in setups and rules on
 *  it, and an "update" that overwrote those answers would be the most
 *  expensive bug in this feature. New rows only. */
export function splitAgainstExisting(
  candidates: readonly TradeEntry[], existing: readonly { id: number }[],
): { fresh: TradeEntry[]; duplicates: TradeEntry[] } {
  const known = new Set(existing.map(t => t.id));
  const fresh: TradeEntry[] = [];
  const duplicates: TradeEntry[] = [];
  for (const c of candidates) (known.has(c.id) ? duplicates : fresh).push(c);
  return { fresh, duplicates };
}
