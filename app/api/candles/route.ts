// Fetches real 1m OHLCV candles from Yahoo Finance for ES=F and NQ=F
// Aggregates into 2m, 3m, 5m on the server
// Client polls every 30s

interface Raw { symbol: string; t: number; o: number; h: number; l: number; c: number; tf: string; }

async function fetchRaw1m(symbol: string): Promise<Raw[]> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept':          'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer':         'https://finance.yahoo.com/',
    },
    cache: 'no-store',
  });
  if (!res.ok) return [];

  const body = await res.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[] }> };
      }>;
    };
  };

  const result = body?.chart?.result?.[0];
  if (!result?.timestamp) return [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];

  const candles: Raw[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (!o || !h || !l || !c) continue;
    candles.push({ symbol, t: result.timestamp[i] * 1000, o, h, l, c, tf: '1m' });
  }
  return candles;
}

function aggregate(candles1m: Raw[], periodMs: number, tf: string): Raw[] {
  const groups = new Map<number, Raw[]>();
  for (const c of candles1m) {
    const slot = Math.floor(c.t / periodMs) * periodMs;
    const g = groups.get(slot) ?? [];
    g.push(c);
    groups.set(slot, g);
  }

  const result: Raw[] = [];
  for (const [slot, group] of groups) {
    if (group.length === 0) continue;
    result.push({
      symbol: group[0].symbol,
      tf,
      t: slot,
      o: group[0].o,
      h: Math.max(...group.map(x => x.h)),
      l: Math.min(...group.map(x => x.l)),
      c: group[group.length - 1].c,
    });
  }
  return result.sort((a, b) => a.t - b.t);
}

async function fetchSymbol(ticker: string, fallback: string): Promise<Raw[]> {
  let candles = await fetchRaw1m(ticker);
  if (candles.length === 0) candles = await fetchRaw1m(fallback);
  return candles;
}

export async function GET(): Promise<Response> {
  const [esRaw, nqRaw] = await Promise.all([
    fetchSymbol('ES=F', '^GSPC'),
    fetchSymbol('NQ=F', '^IXIC'),
  ]);

  const all: Raw[] = [];

  for (const [candles1m, sym] of [[esRaw, 'ES'], [nqRaw, 'NQ']] as [Raw[], string][]) {
    if (candles1m.length === 0) continue;
    const last30 = candles1m.slice(-30);
    all.push(
      ...last30,
      ...aggregate(candles1m, 2 * 60_000, '2m').slice(-20),
      ...aggregate(candles1m, 3 * 60_000, '3m').slice(-20),
      ...aggregate(candles1m, 5 * 60_000, '5m').slice(-20),
    );
    void sym;
  }

  if (all.length === 0) {
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }

  return Response.json(all, { headers: { 'Cache-Control': 'no-store' } });
}
