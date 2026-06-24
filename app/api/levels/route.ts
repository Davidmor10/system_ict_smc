// Auto-calculates liquidity levels from Yahoo Finance:
//   Session H/L (Asia/London/NY AM/NY PM)
//   4H / 1H / 15m structural H/L
//   Previous day H/L
//   Previous week H/L

import type { LiquidityLevel, LiqType } from '../../lib/engine/types';

// ── Yahoo Finance fetcher ─────────────────────────────────────────────────────

interface Bar { t: number; o: number; h: number; l: number; c: number; }

async function fetchBars(symbol: string, interval: string, range: string): Promise<Bar[]> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
              `?interval=${interval}&range=${range}`;
  try {
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
      chart?: { result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[] }> };
      }> };
    };
    const r = body?.chart?.result?.[0];
    if (!r?.timestamp) return [];
    const q = r.indicators?.quote?.[0];
    if (!q) return [];
    const bars: Bar[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const h = q.high?.[i], l = q.low?.[i], o = q.open?.[i], c = q.close?.[i];
      if (!h || !l || !o || !c) continue;
      bars.push({ t: r.timestamp[i] * 1000, o, h, l, c });
    }
    return bars;
  } catch { return []; }
}

// ── Israel timezone helpers ───────────────────────────────────────────────────

function israelOffsetMs(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const iH = parseInt(parts.find(p => p.type === 'hour')!.value);
  const iM = parseInt(parts.find(p => p.type === 'minute')!.value);
  const uH = now.getUTCHours();
  const uM = now.getUTCMinutes();
  let diff = (iH * 60 + iM) - (uH * 60 + uM);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff * 60_000;   // ms, positive = Israel ahead of UTC
}

/** UTC timestamp of Israel's local midnight (00:00 today Israel) */
function israelMidnightUTC(): number {
  const offset = israelOffsetMs();
  const now    = new Date();
  // Israel time = UTC + offset → Israel midnight = UTC midnight of (Israel's today) - offset
  const israelDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })
    .format(now); // 'YYYY-MM-DD'
  const [y, m, d] = israelDateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - offset;
}

// ── Sessions (Israel minutes from midnight → UTC ms today) ───────────────────

const SESS = [
  { id: 'ASIA',   type_h: 'asia_high'   as LiqType, type_l: 'asia_low'   as LiqType, label_h: 'Asia High',    label_l: 'Asia Low',    start: 2*60,      end: 7*60     },
  { id: 'LONDON', type_h: 'london_high' as LiqType, type_l: 'london_low' as LiqType, label_h: 'London High',  label_l: 'London Low',  start: 9*60,      end: 12*60    },
  { id: 'NY_AM',  type_h: 'ny_am_high'  as LiqType, type_l: 'ny_am_low'  as LiqType, label_h: 'NY AM High',   label_l: 'NY AM Low',   start: 16*60,     end: 18*60+30 },
  { id: 'NY_PM',  type_h: 'ny_pm_high'  as LiqType, type_l: 'ny_pm_low'  as LiqType, label_h: 'NY PM High',   label_l: 'NY PM Low',   start: 20*60+30,  end: 23*60    },
];

function sessionLevels(bars15m: Bar[], midnightUTC: number): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  const nowUTC = Date.now();

  for (const sess of SESS) {
    const startUTC = midnightUTC + sess.start * 60_000;
    const endUTC   = midnightUTC + sess.end   * 60_000;
    if (startUTC >= nowUTC) continue;   // session hasn't started yet today

    const inSession = bars15m.filter(b => b.t >= startUTC && b.t < endUTC);
    if (inSession.length === 0) continue;

    const high = Math.max(...inSession.map(b => b.h));
    const low  = Math.min(...inSession.map(b => b.l));

    levels.push({ price: high, side: 'high', type: sess.type_h, swept: false, label: sess.label_h });
    levels.push({ price: low,  side: 'low',  type: sess.type_l, swept: false, label: sess.label_l });
  }
  return levels;
}

// ── Aggregate bars into larger TF ─────────────────────────────────────────────

function aggregate(bars: Bar[], periodMs: number): Bar[] {
  const groups = new Map<number, Bar[]>();
  for (const b of bars) {
    const slot = Math.floor(b.t / periodMs) * periodMs;
    const g = groups.get(slot) ?? [];
    g.push(b);
    groups.set(slot, g);
  }
  return [...groups.entries()]
    .map(([t, g]) => ({
      t,
      o: g[0].o,
      h: Math.max(...g.map(x => x.h)),
      l: Math.min(...g.map(x => x.l)),
      c: g[g.length - 1].c,
    }))
    .sort((a, b) => a.t - b.t);
}

function structuralLevels(bars: Bar[], typeH: LiqType, typeL: LiqType, label: string, count: number): LiquidityLevel[] {
  const recent = bars.slice(-count);
  return recent.flatMap(b => [
    { price: b.h, side: 'high' as const, type: typeH, swept: false, label: `${label} High` },
    { price: b.l, side: 'low'  as const, type: typeL, swept: false, label: `${label} Low`  },
  ]);
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const [daily, bars1h, bars15m] = await Promise.all([
    fetchBars('ES=F', '1d',  '30d'),
    fetchBars('ES=F', '60m', '7d'),
    fetchBars('ES=F', '15m', '5d'),
  ]);

  // Fallback to ^GSPC if ES=F fails
  const d  = daily.length  ? daily  : await fetchBars('^GSPC', '1d',  '30d');
  const h1 = bars1h.length ? bars1h : await fetchBars('^GSPC', '60m', '7d');
  const m15 = bars15m.length ? bars15m : await fetchBars('^GSPC', '15m', '5d');

  const levels: LiquidityLevel[] = [];
  const midnight = israelMidnightUTC();
  const now      = Date.now();

  // ── Previous day H/L ─────────────────────────────────────────────────────
  const todayStart = midnight;
  const yesterday  = d.filter(b => b.t < todayStart);
  if (yesterday.length > 0) {
    const prev = yesterday[yesterday.length - 1];
    levels.push({ price: prev.h, side: 'high', type: 'prev_day_high', swept: false, label: 'PDH' });
    levels.push({ price: prev.l, side: 'low',  type: 'prev_day_low',  swept: false, label: 'PDL' });
  }

  // ── Previous week H/L ────────────────────────────────────────────────────
  // Find the ISO week that ended before this week
  const dayMs  = 86_400_000;
  const weekMs = 7 * dayMs;
  const thisWeekStart = midnight - (new Date().getUTCDay() * dayMs);  // last Sunday UTC
  const prevWeekBars  = d.filter(b => b.t >= thisWeekStart - weekMs && b.t < thisWeekStart);
  if (prevWeekBars.length > 0) {
    levels.push({ price: Math.max(...prevWeekBars.map(b => b.h)), side: 'high', type: 'prev_week_high', swept: false, label: 'PWH' });
    levels.push({ price: Math.min(...prevWeekBars.map(b => b.l)), side: 'low',  type: 'prev_week_low',  swept: false, label: 'PWL' });
  }

  // ── 4H H/L (last 4 candles) ──────────────────────────────────────────────
  const bars4h = aggregate(h1, 4 * 3_600_000);
  const closed4h = bars4h.filter(b => b.t + 4 * 3_600_000 < now).slice(-4);
  levels.push(...structuralLevels(closed4h, '4h_high', '4h_low', '4H', 4));

  // ── 1H H/L (last 6 candles) ──────────────────────────────────────────────
  const closed1h = h1.filter(b => b.t + 3_600_000 < now).slice(-6);
  levels.push(...structuralLevels(closed1h, '1h_high', '1h_low', '1H', 6));

  // ── 15m H/L (last 12 candles) ────────────────────────────────────────────
  const closed15m = m15.filter(b => b.t + 900_000 < now).slice(-12);
  levels.push(...structuralLevels(closed15m, '15m_high', '15m_low', '15m', 12));

  // ── Session H/L ──────────────────────────────────────────────────────────
  levels.push(...sessionLevels(m15, midnight));

  // Deduplicate by price (±0.25 tick)
  const deduped = levels.filter((a, i) =>
    !levels.slice(0, i).some(b => Math.abs(a.price - b.price) < 0.25 && a.side === b.side),
  );

  return Response.json(deduped, { headers: { 'Cache-Control': 'no-store' } });
}
