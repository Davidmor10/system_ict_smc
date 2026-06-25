// Receives typed event alerts from TradingView (Pine Script webhooks)
// Event types: candle | fvg | manip
// POST: processes event; GET: returns recent candles for client polling

export const runtime = 'nodejs';

interface TVCandle {
  tf:   string;
  o:    number;
  h:    number;
  l:    number;
  c:    number;
  sess: string;   // 'asia' | 'london' | 'ny_am' | 'ny_pm' | 'off'
  t:    number;   // bar open-time ms UTC
}

interface TVFvg {
  dir:  'bull' | 'bear';
  top:  number;
  bot:  number;
  tf:   string;
  sess: string;
  t:    number;
}

interface TVManip {
  dir:  'bull' | 'bear';
  tf:   string;
  sess: string;
  t:    number;
}

export interface TVEvent {
  type:   'candle' | 'fvg' | 'manip';
  candle?: TVCandle;
  fvg?:    TVFvg;
  manip?:  TVManip;
  receivedAt: number;
}

const TF_MAP: Record<string, string> = {
  '1': '1m', '2': '2m', '3': '3m', '5': '5m',
  '1m': '1m', '2m': '2m', '3m': '3m', '5m': '5m',
  '15': '15m', '60': '1h', '240': '4h',
};

// Candle store per TF (last 30 bars)
const candleStore = new Map<string, TVCandle[]>();

// Event queue — last 50 non-candle events (FVG / MANIP)
const eventQueue: TVEvent[] = [];
const MAX_EVENTS = 50;

function normalizeTime(raw: unknown): number {
  let t = Number(raw ?? 0);
  if (t < 1e12) t *= 1000;
  return t;
}

function handleCandle(raw: Record<string, unknown>): void {
  const rawTf = String(raw['tf'] ?? '');
  const tf    = TF_MAP[rawTf] ?? rawTf;
  if (!tf) return;

  const candle: TVCandle = {
    tf,
    o:    Number(raw['o'] ?? 0),
    h:    Number(raw['h'] ?? 0),
    l:    Number(raw['l'] ?? 0),
    c:    Number(raw['c'] ?? 0),
    sess: String(raw['sess'] ?? 'off'),
    t:    normalizeTime(raw['t']),
  };

  if (!candle.o || !candle.c) return;

  const existing = candleStore.get(tf) ?? [];
  candleStore.set(tf, [
    ...existing.filter(x => x.t !== candle.t),
    candle,
  ].sort((a, b) => a.t - b.t).slice(-30));
}

function handleFvg(raw: Record<string, unknown>): void {
  const fvg: TVFvg = {
    dir:  (raw['dir'] as 'bull' | 'bear') ?? 'bull',
    top:  Number(raw['top'] ?? 0),
    bot:  Number(raw['bot'] ?? 0),
    tf:   TF_MAP[String(raw['tf'] ?? '')] ?? String(raw['tf'] ?? ''),
    sess: String(raw['sess'] ?? 'off'),
    t:    normalizeTime(raw['t']),
  };
  pushEvent({ type: 'fvg', fvg, receivedAt: Date.now() });
}

function handleManip(raw: Record<string, unknown>): void {
  const manip: TVManip = {
    dir:  (raw['dir'] as 'bull' | 'bear') ?? 'bull',
    tf:   TF_MAP[String(raw['tf'] ?? '')] ?? String(raw['tf'] ?? ''),
    sess: String(raw['sess'] ?? 'off'),
    t:    normalizeTime(raw['t']),
  };
  pushEvent({ type: 'manip', manip, receivedAt: Date.now() });
}

function pushEvent(ev: TVEvent): void {
  eventQueue.push(ev);
  if (eventQueue.length > MAX_EVENTS) eventQueue.shift();
}

// ── POST — called by TradingView on each bar close ────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TV_WEBHOOK_SECRET;
  if (secret) {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('key') !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const type = String(body['type'] ?? 'candle');

    if (type === 'candle') handleCandle(body);
    else if (type === 'fvg')   handleFvg(body);
    else if (type === 'manip') handleManip(body);

    return Response.json({ ok: true, type });
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
}

// ── GET — polled by client ─────────────────────────────────────────────────────
// Returns { candles: TVCandle[], events: TVEvent[] }

export async function GET(): Promise<Response> {
  const candles: TVCandle[] = [];
  for (const arr of candleStore.values()) candles.push(...arr);
  candles.sort((a, b) => a.t - b.t);

  return Response.json(
    { candles, events: [...eventQueue] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
