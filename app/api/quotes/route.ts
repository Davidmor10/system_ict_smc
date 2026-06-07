interface Quote {
  price:  number;
  change: number;
  pct:    number;
  high:   number;
  low:    number;
}

async function fetchYahoo(symbol: string): Promise<Quote | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         'https://finance.yahoo.com/',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const body = await res.json() as { chart?: { result?: Array<{ meta?: Record<string, number> }> } };
    const meta = body?.chart?.result?.[0]?.meta;
    if (!meta || !meta['regularMarketPrice']) return null;

    const price  = meta['regularMarketPrice'];
    const prev   = meta['chartPreviousClose'] ?? meta['previousClose'] ?? price;
    const change = price - prev;
    const pct    = prev ? (change / prev) * 100 : 0;

    return {
      price,
      change,
      pct,
      high: meta['regularMarketDayHigh'] ?? price,
      low:  meta['regularMarketDayLow']  ?? price,
    };
  } catch {
    return null;
  }
}

// Try each symbol in order, return first success
async function resolve(symbols: string[]): Promise<Quote | null> {
  for (const sym of symbols) {
    const q = await fetchYahoo(sym);
    if (q) return q;
  }
  return null;
}

export async function GET() {
  const [esData, nqData] = await Promise.all([
    resolve(['ES=F', '^GSPC']),   // ES futures → S&P 500 index fallback
    resolve(['NQ=F', '^NDX']),    // NQ futures → Nasdaq-100 index fallback
  ]);

  const result = [];
  if (esData) result.push({ symbol: 'ES=F', ...esData });
  if (nqData) result.push({ symbol: 'NQ=F', ...nqData });

  return Response.json(result);
}
