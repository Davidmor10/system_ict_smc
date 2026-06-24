// Receives bar-close alerts from TradingView (Pine Script webhooks)
// POST: stores candle; GET: returns last 20 per TF for client polling

export const runtime = 'nodejs';

interface TVCandle {
  tf:    string;   // '1m' | '2m' | '3m' | '5m'
  o:     number;
  h:     number;
  l:     number;
  c:     number;
  t:     number;   // bar open-time (ms UTC)
}

// Maps TradingView interval strings to engine TF keys
const TF_MAP: Record<string, string> = {
  '1': '1m', '2': '2m', '3': '3m', '5': '5m',
  '1m': '1m', '2m': '2m', '3m': '3m', '5m': '5m',
};

// Module-level cache (warm while serverless fn is alive)
const store = new Map<string, TVCandle[]>();

function addCandle(raw: Record<string, unknown>): void {
  const rawTf = String(raw['tf'] ?? raw['interval'] ?? '');
  const tf    = TF_MAP[rawTf] ?? rawTf;
  if (!tf) return;

  // TradingView sends time in ms; guard against seconds
  let t = Number(raw['t'] ?? raw['time'] ?? 0);
  if (t < 1e12) t *= 1000;   // seconds → ms

  const candle: TVCandle = {
    tf,
    o: Number(raw['o'] ?? raw['open']  ?? 0),
    h: Number(raw['h'] ?? raw['high']  ?? 0),
    l: Number(raw['l'] ?? raw['low']   ?? 0),
    c: Number(raw['c'] ?? raw['close'] ?? 0),
    t,
  };

  if (!candle.o || !candle.c) return;

  const existing = store.get(tf) ?? [];
  const updated  = [
    ...existing.filter(x => x.t !== candle.t),
    candle,
  ].sort((a, b) => a.t - b.t).slice(-20);

  store.set(tf, updated);
}

// ── POST — called by TradingView ──────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  // Optional secret validation
  const secret = process.env.TV_WEBHOOK_SECRET;
  if (secret) {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('key') !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    addCandle(body);
    return Response.json({ ok: true });
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
}

// ── GET — polled by client every 2s ──────────────────────────────────────────

export async function GET(): Promise<Response> {
  const result: TVCandle[] = [];
  for (const candles of store.values()) {
    result.push(...candles);   // return full history (client filters by lastSeen)
  }
  // Sort oldest first so client processes in order
  result.sort((a, b) => a.t - b.t);
  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
