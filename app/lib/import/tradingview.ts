// ─────────────────────────────────────────────────────────────────────────────
// Reading a TradingView Paper Trading "Order History" export.
//
// WHAT THE FILE ACTUALLY IS, AND WHY THAT MATTERS
//
// It is a list of ORDERS, not of trades. One trade appears as several rows:
// the market order that opened it, the protective stop, the take-profit limit,
// and — when the trader scaled in — several more fills. The rows are not
// grouped, not ordered by trade, and carry no trade id.
//
//   Sell,Limit,2,29614.25,,,Cancelled,...      <- the take profit
//   Sell,Stop,2,,29465.75,29465.5,Filled,...   <- the stop, which filled
//   Buy,Market,2,,,29525.25,Filled,...         <- the entry
//
// So trades are RECONSTRUCTED: filled orders are replayed oldest-first and a
// running net position is tracked per symbol. A trade opens when the position
// leaves zero and closes when it returns to it. That is the only method that
// survives the messy cases in a real file, and the trader's own has two:
// three sells building one 12-contract short, and two separate trades on the
// same symbol seven seconds apart.
//
// WHAT THE FILE DOES NOT CONTAIN
//
// The highest and lowest price reached during a trade, and therefore the
// maximum profit and loss it ran through. Those need candle data. Nothing here
// invents them.
//
// AND ONE THING IT CONTAINS THAT IS EASY TO MISREAD
//
// The stop price is the stop AS IT STOOD AT THE END. Several of the trader's
// own trades carry a stop sitting exactly on the entry, which is a stop moved
// to breakeven, not a plan to risk nothing. `stopIsAtEntry` flags those so the
// completion form can ask instead of the analysis assuming.
//
// Pure: string in, structures out. No app types, no storage, no clock.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawOrder {
  /** 1-based row number in the file, so a rejection can be pointed at. */
  line: number;
  symbol: string;
  side: 'Buy' | 'Sell';
  type: string;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  fillPrice: number | null;
  status: string;
  commission: number | null;
  placedAt: string;
  closedAt: string;
  orderId: string;
}

export interface ParsedTrade {
  /** The opening order's id. Stable across exports, which is what makes a
   *  re-import able to tell an already-imported trade from a new one. */
  externalId: string;
  /** As written in the file, e.g. "CME_MINI:MNQ1!". Mapping it to an
   *  instrument the app knows is a separate decision — see mapSymbol. */
  rawSymbol: string;
  direction: 'LONG' | 'SHORT';
  contracts: number;
  /** Weighted average of the opening fills. On a scaled-in trade this is the
   *  number the P&L actually comes from — TradingView's own detail panel shows
   *  the FIRST fill here while computing from the average, so the two disagree
   *  on screen. */
  entry: number;
  /** Weighted average of the closing fills. Null while the position is open. */
  exit: number | null;
  stop: number | null;
  target: number | null;
  /** True when the stop sits within a tick of the entry — a stop moved to
   *  breakeven, not a plan. */
  stopIsAtEntry: boolean;
  openedAt: string;
  closedAt: string | null;
  commissionUsd: number | null;
  /** How many fills built the trade, and whether it was scaled into. */
  fills: number;
  scaledIn: boolean;
}

export interface Rejection {
  line: number;
  detail: string;
  reason:
    | 'unreadable_row'
    | 'unreadable_time'
    | 'unreadable_quantity'
    | 'unreadable_price';
}

export interface ParseResult {
  trades: ParsedTrade[];
  rejected: Rejection[];
  /** Every filled order the file held, whether or not it formed a trade. */
  filledOrders: number;
  /** Symbols seen, in the file's own notation. The caller decides which of
   *  them the app can represent. */
  symbols: string[];
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** A CSV reader that handles the one thing this file needs: a quoted field
 *  containing a comma, which the Margin column always does ("5,905.05 USD"). */
export function readCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Digits out of a field that may carry thousands separators or a currency. */
function num(v: string): number | null {
  const t = v.replace(/[,\s]/g, '').replace(/[A-Za-z$]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const REQUIRED_HEADERS = ['Symbol', 'Side', 'Quantity', 'Status', 'Placing time'] as const;

export class UnrecognisedExport extends Error {
  constructor(public missing: string[]) {
    super(`missing columns: ${missing.join(', ')}`);
    this.name = 'UnrecognisedExport';
  }
}

// ── Reconstruction ───────────────────────────────────────────────────────────

/** Prices are quoted in quarter points; anything under half a tick apart is
 *  the same level. Used only to recognise a stop sitting on the entry. */
const TICK = 0.25;

export function parseTradingViewOrders(csv: string): ParseResult {
  const rows = readCsvRows(csv).filter(r => r.some(c => c.trim() !== ''));
  if (rows.length === 0) throw new UnrecognisedExport([...REQUIRED_HEADERS]);

  const header = rows[0].map(h => h.trim());
  const missing = REQUIRED_HEADERS.filter(h => !header.includes(h));
  if (missing.length > 0) throw new UnrecognisedExport(missing);

  const at = (r: string[], name: string): string => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };

  const rejected: Rejection[] = [];
  const orders: RawOrder[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const side = at(r, 'Side');
    if (side !== 'Buy' && side !== 'Sell') {
      rejected.push({ line, reason: 'unreadable_row', detail: `כיוון פקודה לא מוכר: "${side}"` });
      continue;
    }
    const quantity = num(at(r, 'Quantity'));
    if (quantity === null || quantity <= 0) {
      rejected.push({ line, reason: 'unreadable_quantity', detail: `כמות לא קריאה: "${at(r, 'Quantity')}"` });
      continue;
    }
    orders.push({
      line, side, quantity,
      symbol: at(r, 'Symbol'),
      type: at(r, 'Type'),
      limitPrice: num(at(r, 'Limit price')),
      stopPrice: num(at(r, 'Stop price')),
      fillPrice: num(at(r, 'Fill price')),
      status: at(r, 'Status'),
      commission: num(at(r, 'Commission')),
      placedAt: at(r, 'Placing time'),
      closedAt: at(r, 'Closing time') || at(r, 'Placing time'),
      orderId: at(r, 'Order ID'),
    });
  }

  const filled = orders.filter(o => o.status === 'Filled');
  for (const o of filled) {
    if (o.fillPrice === null) {
      rejected.push({ line: o.line, reason: 'unreadable_price', detail: 'פקודה שבוצעה בלי מחיר ביצוע' });
    }
    if (!o.closedAt) {
      rejected.push({ line: o.line, reason: 'unreadable_time', detail: 'פקודה בלי חותמת זמן' });
    }
  }

  const usable = filled.filter(o => o.fillPrice !== null && !!o.closedAt);
  // Oldest first. Order id breaks a tie, because several fills genuinely share
  // a timestamp to the second and the position replay depends on their order.
  usable.sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.orderId.localeCompare(b.orderId));

  const cancelled = orders.filter(o => o.status !== 'Filled');
  const open = new Map<string, { qty: number; legs: RawOrder[]; openedAt: string }>();
  const trades: ParsedTrade[] = [];

  const flush = (symbol: string, legs: RawOrder[], openedAt: string, closedAt: string | null) => {
    trades.push(buildTrade(symbol, legs, openedAt, closedAt, cancelled));
  };

  for (const o of usable) {
    const signed = (o.side === 'Buy' ? 1 : -1) * o.quantity;
    let pos = open.get(o.symbol);
    if (!pos || pos.qty === 0) {
      pos = { qty: 0, legs: [], openedAt: o.closedAt };
      open.set(o.symbol, pos);
    }
    pos.legs.push(o);
    pos.qty += signed;
    if (pos.qty === 0) {
      flush(o.symbol, pos.legs, pos.openedAt, o.closedAt);
      open.set(o.symbol, { qty: 0, legs: [], openedAt: '' });
    }
  }

  // Whatever is still open when the file ends is a real position the trader
  // holds. It is imported as an open trade rather than dropped — a journal
  // that silently omits the trade you are in is worse than one that shows it
  // unfinished.
  for (const [symbol, pos] of open) {
    if (pos.qty !== 0 && pos.legs.length > 0) flush(symbol, pos.legs, pos.openedAt, null);
  }

  trades.sort((a, b) => a.openedAt.localeCompare(b.openedAt));

  return {
    trades,
    rejected,
    filledOrders: filled.length,
    symbols: [...new Set(orders.map(o => o.symbol).filter(Boolean))],
  };
}

function buildTrade(
  symbol: string, legs: RawOrder[], openedAt: string, closedAt: string | null, cancelled: RawOrder[],
): ParsedTrade {
  const first = legs[0];
  const long = first.side === 'Buy';
  const opens = legs.filter(l => (l.side === 'Buy') === long);
  const closes = legs.filter(l => (l.side === 'Buy') !== long);

  const avg = (of: RawOrder[]): number => {
    const q = of.reduce((s, l) => s + l.quantity, 0);
    return q > 0 ? of.reduce((s, l) => s + (l.fillPrice ?? 0) * l.quantity, 0) / q : 0;
  };

  const contracts = opens.reduce((s, l) => s + l.quantity, 0);
  const entry = avg(opens);
  const exit = closes.length > 0 ? avg(closes) : null;

  // The protective orders: same symbol, opposite side, alive during the
  // trade's window. A cancelled stop is still the stop that was on.
  const opposite = (o: RawOrder) => (o.side === 'Buy') !== long;
  const inWindow = (o: RawOrder) =>
    o.symbol === symbol && o.placedAt <= (closedAt ?? '9999') && o.closedAt >= openedAt;
  const bracket = [...cancelled, ...legs].filter(o => opposite(o) && inWindow(o));

  const stop = bracket.find(o => o.type === 'Stop' && o.stopPrice !== null)?.stopPrice ?? null;
  const target = bracket.find(o => o.type === 'Limit' && o.limitPrice !== null)?.limitPrice ?? null;

  const commissions = legs.map(l => l.commission).filter((c): c is number => c !== null);

  return {
    externalId: first.orderId || `${symbol}:${openedAt}`,
    rawSymbol: symbol,
    direction: long ? 'LONG' : 'SHORT',
    contracts,
    entry,
    exit,
    stop,
    target,
    stopIsAtEntry: stop !== null && Math.abs(stop - entry) < TICK,
    openedAt,
    closedAt,
    commissionUsd: commissions.length > 0 ? commissions.reduce((s, c) => s + c, 0) : null,
    fills: legs.length,
    scaledIn: opens.length > 1,
  };
}
