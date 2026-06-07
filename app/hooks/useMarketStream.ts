'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

// ─── Exported Types ────────────────────────────────────────────────────────

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Bias = 'BULLISH' | 'BEARISH' | 'INDECISIVE';
export type StructureEvent = 'BOS_BULL' | 'BOS_BEAR' | 'CHoCH_BULL' | 'CHoCH_BEAR' | null;
export type ZoneState = 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
export type TrendState = 'BULLISH' | 'BEARISH' | 'RANGING';
export type SweepState = 'BUY_SIDE_SWEEP' | 'SELL_SIDE_SWEEP' | null;

export interface MTFRow {
  tf: string;
  bias: Bias;
  event: StructureEvent;
  swingHigh: number;
  swingLow: number;
}

export interface OrderBlock {
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  time: number;
  mitigated: boolean;
  tf: string;
}

export interface FVGZone {
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  time: number;
  mitigated: boolean;
  fillPct: number;
  tf: string;
}

export interface OrderFlow {
  zone: ZoneState;
  trend: TrendState;
  sweep: SweepState;
  equilibrium: number;
  rangeHigh: number;
  rangeLow: number;
  gravityScore: number;
  liquidityMagnet: number;
}

export interface SMTState {
  active: boolean;
  type: 'BULLISH_SMT' | 'BEARISH_SMT' | null;
}

export interface ConfluenceState {
  active: boolean;
  htfZoneAligned: boolean;
  liquiditySweep: boolean;
  smtDivergence: boolean;
  score: number;
}

export interface DailyBias {
  bias: Bias;
  d1Event: StructureEvent;
  h4Event: StructureEvent;
  reason: string;
}

export interface MarketStream {
  // ES (primary)
  esCandles: CandleBar[];
  currentPrice: number;
  priceChange: number;
  pricePct: number;
  // NQ (correlated)
  nqCandles: CandleBar[];
  nqCurrentPrice: number;
  nqPriceChange: number;
  nqPricePct: number;
  // HTF / SMC analysis
  dailyBias: DailyBias;
  mtfMatrix: MTFRow[];
  htfOB: OrderBlock | null;
  htfFVG: FVGZone | null;
  ltfFVGs: FVGZone[];
  orderFlow: OrderFlow;
  smt: SMTState;
  confluence: ConfluenceState;
}

// ─── Constants (CME calibrated) ────────────────────────────────────────────

const ES_BASE   = 7549.50;
const NQ_BASE   = 20078.50;
const ES_TICK   = 0.25;
const NQ_TICK   = 0.25;
// Dollar-volatility ratio for execution bars (NQ moves ~2x ES in index points)
const NQ_EXEC_SCALE = 2.2;

const EXEC_SEED = 100;
const MAX_EXEC  = 300;
const D1_COUNT  = 22;
const H4_COUNT  = 32;

// ─── Utilities ─────────────────────────────────────────────────────────────

function snap(price: number, tick: number = ES_TICK): number {
  return Math.round(price / tick) * tick;
}

function swingPoints(bars: CandleBar[], n: number = 2) {
  const highs: number[] = [];
  const lows: number[]  = [];
  for (let i = n; i < bars.length - n; i++) {
    if (bars.slice(i - n, i + n + 1).every((b, j) => j === n || b.high <= bars[i].high)) highs.push(bars[i].high);
    if (bars.slice(i - n, i + n + 1).every((b, j) => j === n || b.low  >= bars[i].low))  lows.push(bars[i].low);
  }
  return { highs, lows };
}

// ─── Seed-bar generator ────────────────────────────────────────────────────
// scale controls candle body size relative to ES 1-second bars

function buildSeedBars(
  startTime : number,
  base      : number,
  tick      : number,
  count     : number,
  scale     : number,
): CandleBar[] {
  const bars: CandleBar[] = [];
  let price    = base;
  let momentum = 0.04; // slight bullish drift

  for (let i = 0; i < count; i++) {
    const open  = snap(price, tick);
    momentum    = momentum * 0.72 + (Math.random() - 0.46) * 0.28;
    const move  = momentum * 8 * scale + (Math.random() - 0.5) * 3 * scale;
    const close = snap(open + move, tick);
    const spread = Math.abs(close - open);
    const wk    = spread * 0.5 + Math.random() * 1.5 * scale;
    bars.push({
      time  : startTime + i,
      open,
      high  : snap(Math.max(open, close) + wk * Math.random(), tick),
      low   : snap(Math.min(open, close) - wk * Math.random(), tick),
      close,
      volume: Math.floor(1000 + Math.random() * 5000),
    });
    price = close;
  }
  return bars;
}

// ─── Market Structure ──────────────────────────────────────────────────────

function analyzeStructure(bars: CandleBar[], tf: string): MTFRow {
  const last = bars[bars.length - 1];
  const base: MTFRow = { tf, bias: 'INDECISIVE', event: null, swingHigh: last?.high ?? 0, swingLow: last?.low ?? 0 };
  if (bars.length < 10) return base;

  const { highs, lows } = swingPoints(bars.slice(-Math.min(bars.length, 30)), 2);
  if (highs.length < 2 || lows.length < 2) return base;

  const lastH = highs[highs.length - 1], prevH = highs[highs.length - 2];
  const lastL = lows[lows.length - 1],  prevL = lows[lows.length - 2];
  const close = last.close;
  const hhhl  = lastH > prevH && lastL > prevL;
  const lhll  = lastH < prevH && lastL < prevL;

  let event: StructureEvent = null, bias: Bias = 'INDECISIVE';
  if      (hhhl && close > lastH) { bias = 'BULLISH'; event = 'BOS_BULL'; }
  else if (hhhl)                  { bias = 'BULLISH'; }
  else if (lhll && close < lastL) { bias = 'BEARISH'; event = 'BOS_BEAR'; }
  else if (lhll)                  { bias = 'BEARISH'; }
  else if (close > lastH)         { bias = 'BULLISH'; event = 'CHoCH_BULL'; }
  else if (close < lastL)         { bias = 'BEARISH'; event = 'CHoCH_BEAR'; }

  return { tf, bias, event, swingHigh: lastH, swingLow: lastL };
}

// ─── Daily Bias ────────────────────────────────────────────────────────────

function computeDailyBias(d1: MTFRow, h4: MTFRow): DailyBias {
  if (d1.bias === 'BULLISH' && h4.bias === 'BULLISH')
    return { bias: 'BULLISH', d1Event: d1.event, h4Event: h4.event, reason: 'D1 & H4 HH/HL — target buy-side liquidity' };
  if (d1.bias === 'BEARISH' && h4.bias === 'BEARISH')
    return { bias: 'BEARISH', d1Event: d1.event, h4Event: h4.event, reason: 'D1 & H4 LH/LL — target sell-side liquidity' };
  if (d1.bias === 'BULLISH')
    return { bias: 'BULLISH', d1Event: d1.event, h4Event: h4.event, reason: 'D1 bullish — H4 corrective, await discount re-entry' };
  if (d1.bias === 'BEARISH')
    return { bias: 'BEARISH', d1Event: d1.event, h4Event: h4.event, reason: 'D1 bearish — H4 pullback to premium, await rejection' };
  return { bias: 'INDECISIVE', d1Event: d1.event, h4Event: h4.event, reason: 'HTF structures conflicting — await clarity' };
}

// ─── Order Block ───────────────────────────────────────────────────────────

function detectOrderBlock(bars: CandleBar[], tf: string, price: number): OrderBlock | null {
  if (bars.length < 6) return null;
  const w = bars.slice(-Math.min(bars.length, 25));
  for (let i = w.length - 3; i >= 1; i--) {
    const ob      = w[i];
    const impulse = w.slice(i + 1, Math.min(i + 5, w.length));
    if (impulse.length < 2) continue;
    const net       = impulse.reduce((s, b) => s + (b.close - b.open), 0);
    const bullBreak = net > 0 && impulse[impulse.length - 1].close > ob.high;
    const bearBreak = net < 0 && impulse[impulse.length - 1].close < ob.low;
    if (bullBreak && ob.close < ob.open)
      return { type: 'BULLISH', high: ob.high, low: ob.low, time: ob.time, mitigated: price >= ob.low && price <= ob.high, tf };
    if (bearBreak && ob.close > ob.open)
      return { type: 'BEARISH', high: ob.high, low: ob.low, time: ob.time, mitigated: price >= ob.low && price <= ob.high, tf };
  }
  return null;
}

// ─── FVG ───────────────────────────────────────────────────────────────────

function detectFVGs(bars: CandleBar[], tf: string, price: number): FVGZone[] {
  const result: FVGZone[] = [];
  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2], b2 = bars[i];
    if (b2.low > b0.high) {
      const [top, bottom] = [b2.low, b0.high];
      const sz = top - bottom;
      if (sz < 0.1) continue;
      const inGap  = price >= bottom && price <= top;
      const fillPct = inGap ? ((price - bottom) / sz) * 100 : price <= bottom ? 100 : 0;
      result.push({ type: 'BULLISH', top, bottom, time: bars[i - 1].time, mitigated: price <= bottom, fillPct, tf });
    }
    if (b2.high < b0.low) {
      const [top, bottom] = [b0.low, b2.high];
      const sz = top - bottom;
      if (sz < 0.1) continue;
      const inGap  = price >= bottom && price <= top;
      const fillPct = inGap ? ((top - price) / sz) * 100 : price >= top ? 100 : 0;
      result.push({ type: 'BEARISH', top, bottom, time: bars[i - 1].time, mitigated: price >= top, fillPct, tf });
    }
  }
  return result.filter(f => !f.mitigated);
}

// ─── SMT Divergence ────────────────────────────────────────────────────────

function detectSMT(esBars: CandleBar[], nqBars: CandleBar[]): SMTState {
  const n = Math.min(esBars.length, nqBars.length, 8);
  if (n < 6) return { active: false, type: null };
  const es = esBars.slice(-n), nq = nqBars.slice(-n);
  const esP = es.slice(0, -1), nqP = nq.slice(0, -1);
  const esH = Math.max(...esP.map(b => b.high)), esL = Math.min(...esP.map(b => b.low));
  const nqH = Math.max(...nqP.map(b => b.high)), nqL = Math.min(...nqP.map(b => b.low));
  const esLast = es[es.length - 1], nqLast = nq[nq.length - 1];
  if (esLast.high > esH && nqLast.high <= nqH && esLast.close < esH) return { active: true, type: 'BEARISH_SMT' };
  if (esLast.low  < esL && nqLast.low  >= nqL && esLast.close > esL) return { active: true, type: 'BULLISH_SMT' };
  return { active: false, type: null };
}

// ─── Confluence ────────────────────────────────────────────────────────────

function detectConfluence(of: OrderFlow, bias: DailyBias, smt: SMTState): ConfluenceState {
  const htfZoneAligned  = (bias.bias === 'BULLISH' && of.zone === 'DISCOUNT') || (bias.bias === 'BEARISH' && of.zone === 'PREMIUM');
  const liquiditySweep  = of.sweep !== null;
  const smtDivergence   = smt.active;
  const score           = [htfZoneAligned, liquiditySweep, smtDivergence].filter(Boolean).length;
  return { active: score >= 2, htfZoneAligned, liquiditySweep, smtDivergence, score };
}

// ─── Order Flow ────────────────────────────────────────────────────────────

function computeOrderFlow(bars: CandleBar[], base: number): OrderFlow {
  const fallback: OrderFlow = {
    zone: 'EQUILIBRIUM', trend: 'RANGING', sweep: null,
    equilibrium: base, rangeHigh: base + 20, rangeLow: base - 20, gravityScore: 0, liquidityMagnet: base,
  };
  if (bars.length < 6) return fallback;
  const lookback = bars.slice(-50);
  const last     = bars[bars.length - 1];
  const price    = last.close;
  const rangeHigh = Math.max(...lookback.map(c => c.high));
  const rangeLow  = Math.min(...lookback.map(c => c.low));
  const equilibrium = snap((rangeHigh + rangeLow) / 2, ES_TICK);
  const zoneRatio   = (price - rangeLow) / (rangeHigh - rangeLow || 1);
  const zone: ZoneState = zoneRatio > 0.618 ? 'PREMIUM' : zoneRatio < 0.382 ? 'DISCOUNT' : 'EQUILIBRIUM';
  const gravityScore    = Math.round(Math.abs(zoneRatio - 0.5) * 2 * 100);
  const ref10   = bars.length >= 10 ? bars[bars.length - 10].close : null;
  const delta   = ref10 !== null ? price - ref10 : 0;
  const trend: TrendState = delta > (base * 0.0007) ? 'BULLISH' : delta < -(base * 0.0007) ? 'BEARISH' : 'RANGING';
  let sweep: SweepState = null;
  if (bars.length >= 6) {
    const prior = bars.slice(-6, -1);
    const pH = Math.max(...prior.map(b => b.high)), pL = Math.min(...prior.map(b => b.low));
    if (last.high > pH && last.close < pH) sweep = 'SELL_SIDE_SWEEP';
    else if (last.low < pL && last.close > pL) sweep = 'BUY_SIDE_SWEEP';
  }
  return { zone, trend, sweep, equilibrium, rangeHigh, rangeLow, gravityScore,
    liquidityMagnet: zone === 'PREMIUM' ? rangeLow : rangeHigh };
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useMarketStream(): MarketStream {
  const t0         = useRef(Math.floor(Date.now() / 1000));
  const sharedMom  = useRef(0.04);
  const esMom      = useRef(0.04);
  const nqMom      = useRef(0.04);

  // Static HTF seeds — computed once, never mutated
  // ES D1: scale=8 → ~30-60 pt daily body; H4: scale=3 → ~12-25 pt 4H body
  const d1ES = useRef(buildSeedBars(t0.current - D1_COUNT * 86400, ES_BASE, ES_TICK, D1_COUNT, 8));
  const h4ES = useRef(buildSeedBars(t0.current - H4_COUNT * 14400, ES_BASE, ES_TICK, H4_COUNT, 3));
  // NQ D1: scale=20 → ~120-200 pt daily body; H4: scale=8 → ~50-80 pt body
  const d1NQ = useRef(buildSeedBars(t0.current - D1_COUNT * 86400, NQ_BASE, NQ_TICK, D1_COUNT, 20));
  const h4NQ = useRef(buildSeedBars(t0.current - H4_COUNT * 14400, NQ_BASE, NQ_TICK, H4_COUNT, 8));

  // Execution stream — starts at CME calibrated prices
  const [streams, setStreams] = useState<{ es: CandleBar[]; nq: CandleBar[] }>(() => {
    const t = t0.current - EXEC_SEED;
    return {
      es: buildSeedBars(t, ES_BASE, ES_TICK, EXEC_SEED, 1),
      nq: buildSeedBars(t, NQ_BASE, NQ_TICK, EXEC_SEED, NQ_EXEC_SCALE),
    };
  });

  useEffect(() => {
    const id = setInterval(() => {
      // Compute momentum outside setState (avoids strict-mode double-call side effects)
      sharedMom.current = sharedMom.current * 0.65 + (Math.random() - 0.5) * 0.35;
      esMom.current     = esMom.current * 0.3  + sharedMom.current * 0.7;
      const diverge     = Math.random() < 0.06;
      nqMom.current     = diverge
        ? -(sharedMom.current * 0.7)
        : nqMom.current * 0.3 + sharedMom.current * 0.7;

      const esMomSnap = esMom.current;
      const nqMomSnap = nqMom.current;

      setStreams(prev => {
        // ES bar
        const esLast = prev.es[prev.es.length - 1];
        const esO    = esLast.close;
        const esMove = esMomSnap * 8 + (Math.random() - 0.5) * 2.5;
        const esC    = snap(esO + esMove);
        const esSp   = Math.abs(esC - esO);
        const esWk   = esSp * 0.4 + Math.random() * 1.2;
        const esBar: CandleBar = {
          time: esLast.time + 1, open: esO,
          high: snap(Math.max(esO, esC) + esWk * Math.random()),
          low : snap(Math.min(esO, esC) - esWk * Math.random()),
          close: esC, volume: Math.floor(800 + Math.random() * 3500),
        };

        // NQ bar (scaled, correlated with ES)
        const nqLast = prev.nq[prev.nq.length - 1];
        const nqO    = nqLast.close;
        const nqMove = nqMomSnap * 8 * NQ_EXEC_SCALE + (Math.random() - 0.5) * 4;
        const nqC    = snap(nqO + nqMove, NQ_TICK);
        const nqSp   = Math.abs(nqC - nqO);
        const nqWk   = nqSp * 0.4 + Math.random() * NQ_EXEC_SCALE;
        const nqBar: CandleBar = {
          time: nqLast.time + 1, open: nqO,
          high: snap(Math.max(nqO, nqC) + nqWk * Math.random(), NQ_TICK),
          low : snap(Math.min(nqO, nqC) - nqWk * Math.random(), NQ_TICK),
          close: nqC, volume: Math.floor(1000 + Math.random() * 5000),
        };

        return {
          es: [...prev.es, esBar].slice(-MAX_EXEC),
          nq: [...prev.nq, nqBar].slice(-MAX_EXEC),
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // All SMC analysis memoized — reruns only when streams updates (1×/sec)
  const analysis = useMemo(() => {
    const { es, nq } = streams;
    const esPrice = es[es.length - 1]?.close ?? ES_BASE;
    const nqPrice = nq[nq.length - 1]?.close ?? NQ_BASE;

    const d1Row   = analyzeStructure(d1ES.current, 'D1');
    const h4Row   = analyzeStructure(h4ES.current, 'H4');
    const h1Row   = analyzeStructure(es.slice(-60), 'H1');
    const execRow = analyzeStructure(es.slice(-20), 'Exec');

    const dailyBias  = computeDailyBias(d1Row, h4Row);
    const mtfMatrix: MTFRow[] = [d1Row, h4Row, h1Row, execRow];
    const htfOB     = detectOrderBlock(h4ES.current, 'H4', esPrice);
    const htfFVGArr = detectFVGs(h4ES.current, 'H4', esPrice);
    const htfFVG    = htfFVGArr[htfFVGArr.length - 1] ?? null;
    const ltfFVGs   = detectFVGs(es.slice(-30), 'Exec', esPrice);
    const orderFlow = computeOrderFlow(es, ES_BASE);
    const smt       = detectSMT(es, nq);
    const confluence = detectConfluence(orderFlow, dailyBias, smt);

    void nqPrice; // used for SMT only (in detectSMT via nq candles)
    return { dailyBias, mtfMatrix, htfOB, htfFVG, ltfFVGs, orderFlow, smt, confluence };
  }, [streams]);

  const esPrice    = streams.es[streams.es.length - 1]?.close ?? ES_BASE;
  const esFirst    = streams.es[0]?.open ?? ES_BASE;
  const nqPrice    = streams.nq[streams.nq.length - 1]?.close ?? NQ_BASE;
  const nqFirst    = streams.nq[0]?.open ?? NQ_BASE;
  const priceChange   = esPrice - esFirst;
  const nqPriceChange = nqPrice - nqFirst;

  return {
    esCandles    : streams.es,
    currentPrice : esPrice,
    priceChange,
    pricePct     : (priceChange / esFirst) * 100,
    nqCandles    : streams.nq,
    nqCurrentPrice : nqPrice,
    nqPriceChange,
    nqPricePct   : (nqPriceChange / nqFirst) * 100,
    ...analysis,
  };
}
