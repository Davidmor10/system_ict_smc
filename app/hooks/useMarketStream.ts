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

export type Bias          = 'BULLISH' | 'BEARISH' | 'INDECISIVE';
export type StructureEvent = 'BOS_BULL' | 'BOS_BEAR' | 'CHoCH_BULL' | 'CHoCH_BEAR' | null;
export type ZoneState     = 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
export type TrendState    = 'BULLISH' | 'BEARISH' | 'RANGING';
export type SweepState    = 'BUY_SIDE_SWEEP' | 'SELL_SIDE_SWEEP' | null;
export type FVGStatus     = 'ACTIVE' | 'HONORED' | 'EXPLOSIVE' | 'INVERTED' | 'MITIGATED';
export type SessionName   = 'ASIA' | 'LONDON' | 'NY_AM' | 'NY_PM';

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

export interface EnhancedFVGZone extends FVGZone {
  midpoint: number;
  status: FVGStatus;
  explosive: boolean;
  inverted: boolean;
}

export interface SessionLiq {
  session: SessionName;
  high: number;
  low: number;
  highSwept: boolean;
  lowSwept: boolean;
}

export interface InducementLevel {
  price: number;
  tf: string;
  side: 'HIGH' | 'LOW';
  swept: boolean;
}

export interface BiasFactors {
  h4FVGs: EnhancedFVGZone[];
  h1FVGs: EnhancedFVGZone[];
  sessionLiq: SessionLiq[];
  inducement: InducementLevel[];
}

export interface DailyBiasV2 {
  bias: Bias;
  score: number;
  factors: {
    honoredGaps: boolean;
    explosiveGaps: boolean;
    iFVGsActive: boolean;
    sessionLiqUnswept: boolean;
    inducementUnswept: boolean;
  };
  commentary: string;
  d1Event: StructureEvent;
  h4Event: StructureEvent;
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

// Legacy type — kept for DashboardView backward compat
export interface DailyBias {
  bias: Bias;
  d1Event: StructureEvent;
  h4Event: StructureEvent;
  reason: string;
}

export interface MarketStream {
  // ES prices
  esCandles: CandleBar[];
  currentPrice: number;
  priceChange: number;
  pricePct: number;
  // NQ prices
  nqCandles: CandleBar[];
  nqCurrentPrice: number;
  nqPriceChange: number;
  nqPricePct: number;
  // V2 concurrent bias (ES + NQ independently)
  esDailyBias: DailyBiasV2;
  nqDailyBias: DailyBiasV2;
  esBiasFactors: BiasFactors;
  nqBiasFactors: BiasFactors;
  // Legacy (backward compat with existing DashboardView)
  dailyBias: DailyBias;
  mtfMatrix: MTFRow[];
  htfOB: OrderBlock | null;
  htfFVG: EnhancedFVGZone | null;
  ltfFVGs: FVGZone[];
  orderFlow: OrderFlow;
  smt: SMTState;
  confluence: ConfluenceState;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ES_BASE       = 7549.50;
const NQ_BASE       = 20078.50;
const ES_TICK       = 0.25;
const NQ_TICK       = 0.25;
const NQ_EXEC_SCALE = 2.2;
const EXEC_SEED     = 100;
const MAX_EXEC      = 300;
const D1_COUNT      = 22;
const H4_COUNT      = 32;
const H1_COUNT      = 48; // 2 calendar days of 1H bars

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

function buildSeedBars(
  startTime: number,
  base: number,
  tick: number,
  count: number,
  scale: number,
): CandleBar[] {
  const bars: CandleBar[] = [];
  let price    = base;
  let momentum = 0.04;
  for (let i = 0; i < count; i++) {
    const open   = snap(price, tick);
    momentum     = momentum * 0.72 + (Math.random() - 0.46) * 0.28;
    const move   = momentum * 8 * scale + (Math.random() - 0.5) * 3 * scale;
    const close  = snap(open + move, tick);
    const spread = Math.abs(close - open);
    const wk     = spread * 0.5 + Math.random() * 1.5 * scale;
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
  if (!bars || bars.length < 10) return base;
  const { highs, lows } = swingPoints(bars.slice(-Math.min(bars.length, 30)), 2);
  if (highs.length < 2 || lows.length < 2) return base;
  const lastH = highs[highs.length - 1], prevH = highs[highs.length - 2];
  const lastL = lows[lows.length - 1],   prevL = lows[lows.length - 2];
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

// ─── Eastern Time Helper (DST-aware, uses getUTCHours) ────────────────────

function getEasternHour(unixSec: number): number {
  const ms  = unixSec * 1000;
  const d   = new Date(ms);
  const yr  = d.getUTCFullYear();

  // Returns the timestamp (ms) of 02:00 ET on the nth Sunday of a given UTC month.
  // 02:00 EST = 07:00 UTC; we use 07:00 UTC as the reference point.
  const nthSundayMs = (mo: number, nth: number): number => {
    const t = new Date(Date.UTC(yr, mo, 1, 7));
    t.setUTCDate(1 + ((7 - t.getUTCDay()) % 7) + (nth - 1) * 7);
    return t.getTime();
  };

  // US DST: second Sunday of March → first Sunday of November
  const isDST  = ms >= nthSundayMs(2, 2) && ms < nthSundayMs(10, 1);
  const offset = isDST ? -4 : -5; // EDT = UTC-4, EST = UTC-5
  return ((d.getUTCHours() + offset) + 24) % 24;
}

function sessionForBar(bar: CandleBar): SessionName | null {
  const h = getEasternHour(bar.time);
  if (h >= 0  && h < 8)  return 'ASIA';
  if (h >= 9  && h < 12) return 'LONDON';
  if (h >= 16 && h < 18) return 'NY_AM';
  if (h >= 20)           return 'NY_PM';
  return null; // dead-band between sessions
}

// ─── Session Liquidity (H1 resolution for pinpoint session H/L) ───────────

function detectSessionLiquidity(h1Bars: CandleBar[], price: number): SessionLiq[] {
  if (!h1Bars || h1Bars.length === 0) return [];

  const buckets: Record<SessionName, { highs: number[]; lows: number[] }> = {
    ASIA:   { highs: [], lows: [] },
    LONDON: { highs: [], lows: [] },
    NY_AM:  { highs: [], lows: [] },
    NY_PM:  { highs: [], lows: [] },
  };

  for (const bar of h1Bars.slice(-48)) { // last 2 calendar days
    const s = sessionForBar(bar);
    if (!s) continue;
    buckets[s].highs.push(bar.high);
    buckets[s].lows.push(bar.low);
  }

  const ORDER: SessionName[] = ['ASIA', 'LONDON', 'NY_AM', 'NY_PM'];
  return ORDER
    .filter(s => buckets[s].highs.length > 0)
    .map(s => {
      const high = Math.max(...buckets[s].highs);
      const low  = Math.min(...buckets[s].lows);
      return { session: s, high, low, highSwept: price > high, lowSwept: price < low };
    });
}

// ─── Enhanced FVG Detection ────────────────────────────────────────────────
// Status hierarchy: ACTIVE → EXPLOSIVE → HONORED → INVERTED | (MITIGATED unreachable)

function detectEnhancedFVGs(bars: CandleBar[], tf: string, price: number): EnhancedFVGZone[] {
  if (!bars || bars.length < 3) return [];
  const result: EnhancedFVGZone[] = [];

  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2], b2 = bars[i];

    // ── Bullish FVG: bar[i].low > bar[i-2].high ───────────────────────────
    if (b2.low > b0.high) {
      const bottom = b0.high, top = b2.low;
      const sz = top - bottom;
      if (sz < 0.1) continue;
      const midpoint = (top + bottom) / 2;

      let tested = false, crossedCE = false, wasInverted = false;
      for (let j = i + 1; j < bars.length; j++) {
        const lb = bars[j];
        if (lb.low > top) continue;
        tested = true;
        const bodyLow = Math.min(lb.open, lb.close);
        if (bodyLow < bottom) { wasInverted = true; break; }
        if (bodyLow < midpoint) crossedCE = true;
      }

      // Blown-through without formal test → INVERTED (not MITIGATED)
      const status: FVGStatus =
        wasInverted                 ? 'INVERTED' :
        (!tested && price < bottom) ? 'INVERTED' :
        !tested                     ? 'ACTIVE'   :
        crossedCE                   ? 'HONORED'  : 'EXPLOSIVE';

      const inGap  = price >= bottom && price <= top;
      const fillPct = inGap ? ((price - bottom) / sz) * 100 : price <= bottom ? 100 : 0;
      result.push({
        type: 'BULLISH', top, bottom, midpoint, time: bars[i - 1].time,
        mitigated: false, fillPct, tf,
        status, explosive: status === 'EXPLOSIVE', inverted: status === 'INVERTED',
      });
    }

    // ── Bearish FVG: bar[i].high < bar[i-2].low ───────────────────────────
    if (b2.high < b0.low) {
      const bottom = b2.high, top = b0.low;
      const sz = top - bottom;
      if (sz < 0.1) continue;
      const midpoint = (top + bottom) / 2;

      let tested = false, crossedCE = false, wasInverted = false;
      for (let j = i + 1; j < bars.length; j++) {
        const lb = bars[j];
        if (lb.high < bottom) continue;
        tested = true;
        const bodyHigh = Math.max(lb.open, lb.close);
        if (bodyHigh > top) { wasInverted = true; break; }
        if (bodyHigh > midpoint) crossedCE = true;
      }

      const status: FVGStatus =
        wasInverted              ? 'INVERTED' :
        (!tested && price > top) ? 'INVERTED' :
        !tested                  ? 'ACTIVE'   :
        crossedCE                ? 'HONORED'  : 'EXPLOSIVE';

      const inGap  = price >= bottom && price <= top;
      const fillPct = inGap ? ((top - price) / sz) * 100 : price >= top ? 100 : 0;
      result.push({
        type: 'BEARISH', top, bottom, midpoint, time: bars[i - 1].time,
        mitigated: false, fillPct, tf,
        status, explosive: status === 'EXPLOSIVE', inverted: status === 'INVERTED',
      });
    }
  }

  // INVERTED zones stay (they're active opposing zones). MITIGATED is filtered out.
  return result.filter(f => f.status !== 'MITIGATED');
}

// Legacy thin wrapper — used for ltfFVGs count display in sidebar
function detectFVGs(bars: CandleBar[], tf: string, price: number): FVGZone[] {
  return detectEnhancedFVGs(bars, tf, price).filter(f => !f.inverted);
}

// ─── Inducement Levels (Structural Liquidity Pools) ───────────────────────

function detectInducementLevels(bars: CandleBar[], tf: string, price: number): InducementLevel[] {
  if (!bars || bars.length < 7) return []; // swingPoints(n=3) needs ≥7 bars
  const w = bars.slice(-Math.min(bars.length, 60));
  const { highs, lows } = swingPoints(w, 3);
  const levels: InducementLevel[] = [];
  for (const h of highs.slice(-4)) levels.push({ price: h, tf, side: 'HIGH', swept: price > h });
  for (const l of lows.slice(-4))  levels.push({ price: l, tf, side: 'LOW',  swept: price < l });
  return levels;
}

// ─── Daily Bias V2 — 6-factor scoring engine ──────────────────────────────

function computeDailyBiasV2(
  d1: MTFRow, h4: MTFRow, price: number,
  h4FVGs: EnhancedFVGZone[], h1FVGs: EnhancedFVGZone[],
  sessionLiq: SessionLiq[],
  inducement: InducementLevel[],
): DailyBiasV2 {
  let score = 0;
  const all = [...h4FVGs, ...h1FVGs];

  // ── 1. HTF Structure ──────────────────────────────────────────────────────
  if      (d1.bias === 'BULLISH') score += 1.0;
  else if (d1.bias === 'BEARISH') score -= 1.0;
  if      (h4.bias === 'BULLISH') score += 0.5;
  else if (h4.bias === 'BEARISH') score -= 0.5;

  // ── 2. Honored / Explosive FVGs (acting as live support/resistance) ───────
  const honoredBull = all.filter(f =>
    f.type === 'BULLISH' && !f.inverted &&
    (f.status === 'HONORED' || f.status === 'EXPLOSIVE') && f.top < price,
  );
  const honoredBear = all.filter(f =>
    f.type === 'BEARISH' && !f.inverted &&
    (f.status === 'HONORED' || f.status === 'EXPLOSIVE') && f.bottom > price,
  );
  if (honoredBull.length > 0) score += 1.0;
  if (honoredBear.length > 0) score -= 1.0;

  // ── 3. Explosive bonus ────────────────────────────────────────────────────
  const explosiveBull = honoredBull.filter(f => f.explosive);
  const explosiveBear = honoredBear.filter(f => f.explosive);
  if (explosiveBull.length > 0) score += 0.5;
  if (explosiveBear.length > 0) score -= 0.5;

  // ── 4. iFVGs (inverted → reversed polarity zones) ────────────────────────
  const iFVGSupport    = all.filter(f => f.inverted && f.type === 'BEARISH' && f.top    < price);
  const iFVGResistance = all.filter(f => f.inverted && f.type === 'BULLISH' && f.bottom > price);
  if (iFVGSupport.length > 0)    score += 0.5;
  if (iFVGResistance.length > 0) score -= 0.5;

  // ── 5. Session Liquidity Draw (nearest unswept level wins) ────────────────
  const unsweptAbove = sessionLiq.filter(s => !s.highSwept && s.high > price);
  const unsweptBelow = sessionLiq.filter(s => !s.lowSwept  && s.low  < price);
  const distUp   = unsweptAbove.reduce((m, s) => Math.min(m, s.high - price), Infinity);
  const distDown = unsweptBelow.reduce((m, s) => Math.min(m, price - s.low),  Infinity);
  if      (unsweptAbove.length > 0 && distUp   < distDown) score += 1.0;
  else if (unsweptBelow.length > 0 && distDown < distUp)   score -= 1.0;

  // ── 6. Inducement (structural swing targets) ──────────────────────────────
  const indAbove = inducement.filter(l => l.side === 'HIGH' && !l.swept && l.price > price);
  const indBelow = inducement.filter(l => l.side === 'LOW'  && !l.swept && l.price < price);
  const distIndUp   = indAbove.reduce((m, l) => Math.min(m, l.price - price), Infinity);
  const distIndDown = indBelow.reduce((m, l) => Math.min(m, price - l.price), Infinity);
  if      (indAbove.length > 0 && distIndUp   < distIndDown) score += 0.5;
  else if (indBelow.length > 0 && distIndDown < distIndUp)   score -= 0.5;

  const bias: Bias = score > 1.0 ? 'BULLISH' : score < -1.0 ? 'BEARISH' : 'INDECISIVE';

  // ── Commentary — single sentence ≤65 chars, HTF factors only ───────────────
  const nearAboveSess = [...unsweptAbove].sort((a, b) => a.high - b.high)[0];
  const nearBelowSess = [...unsweptBelow].sort((a, b) => b.low  - a.low)[0];
  let commentary: string;
  if (bias === 'BULLISH') {
    if (explosiveBull.length > 0)
      commentary = 'HTF Bullish | Explosive FVG holding, BSL in draw';
    else if (honoredBull.length > 0 && nearAboveSess && distUp < distDown)
      commentary = `HTF Bullish | FVG support, targeting ${nearAboveSess.session} BSL`;
    else if (honoredBull.length > 0)
      commentary = 'HTF Bullish | Discount FVG holding, targets above';
    else if (iFVGSupport.length > 0)
      commentary = 'HTF Bullish | iFVG support active, draw on liquidity';
    else if (nearAboveSess && distUp < distDown)
      commentary = `HTF Bullish | Draw on ${nearAboveSess.session} BSL, discount zone`;
    else
      commentary = 'HTF Bullish | D1/H4 aligned, await discount FVG';
  } else if (bias === 'BEARISH') {
    if (explosiveBear.length > 0)
      commentary = 'HTF Bearish | Explosive FVG capping, SSL in draw';
    else if (honoredBear.length > 0 && nearBelowSess && distDown < distUp)
      commentary = `HTF Bearish | FVG supply, targeting ${nearBelowSess.session} SSL`;
    else if (honoredBear.length > 0)
      commentary = 'HTF Bearish | Premium FVG in control, targets below';
    else if (iFVGResistance.length > 0)
      commentary = 'HTF Bearish | iFVG resistance active, draw on SSL';
    else if (nearBelowSess && distDown < distUp)
      commentary = `HTF Bearish | Draw on ${nearBelowSess.session} SSL, premium zone`;
    else
      commentary = 'HTF Bearish | D1/H4 aligned, await premium FVG';
  } else {
    if (iFVGSupport.length > 0 || iFVGResistance.length > 0)
      commentary = 'Indecisive | Conflicting iFVG zones, await resolution';
    else if (nearAboveSess || nearBelowSess)
      commentary = 'Indecisive | Session liq. unswept, no clear draw';
    else
      commentary = 'Indecisive | Choppy HTF structure, await sweep/break';
  }

  return {
    bias,
    score: Math.round(score * 10) / 10,
    factors: {
      honoredGaps:       honoredBull.length > 0 || honoredBear.length > 0,
      explosiveGaps:     explosiveBull.length > 0 || explosiveBear.length > 0,
      iFVGsActive:       iFVGSupport.length > 0 || iFVGResistance.length > 0,
      sessionLiqUnswept: unsweptAbove.length > 0 || unsweptBelow.length > 0,
      inducementUnswept: indAbove.length > 0 || indBelow.length > 0,
    },
    commentary,
    d1Event: d1.event,
    h4Event: h4.event,
  };
}

// ─── Order Block ───────────────────────────────────────────────────────────

function detectOrderBlock(bars: CandleBar[], tf: string, price: number): OrderBlock | null {
  if (!bars || bars.length < 6) return null;
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
  const htfZoneAligned = (bias.bias === 'BULLISH' && of.zone === 'DISCOUNT') || (bias.bias === 'BEARISH' && of.zone === 'PREMIUM');
  const liquiditySweep = of.sweep !== null;
  const smtDivergence  = smt.active;
  const score          = [htfZoneAligned, liquiditySweep, smtDivergence].filter(Boolean).length;
  return { active: score >= 2, htfZoneAligned, liquiditySweep, smtDivergence, score };
}

// ─── Order Flow ────────────────────────────────────────────────────────────

function computeOrderFlow(bars: CandleBar[], base: number): OrderFlow {
  const fallback: OrderFlow = {
    zone: 'EQUILIBRIUM', trend: 'RANGING', sweep: null,
    equilibrium: base, rangeHigh: base + 20, rangeLow: base - 20, gravityScore: 0, liquidityMagnet: base,
  };
  if (!bars || bars.length < 6) return fallback;
  const lookback    = bars.slice(-50);
  const last        = bars[bars.length - 1];
  const price       = last.close;
  const rangeHigh   = Math.max(...lookback.map(c => c.high));
  const rangeLow    = Math.min(...lookback.map(c => c.low));
  const equilibrium = snap((rangeHigh + rangeLow) / 2, ES_TICK);
  const zoneRatio   = (price - rangeLow) / (rangeHigh - rangeLow || 1);
  const zone: ZoneState    = zoneRatio > 0.618 ? 'PREMIUM' : zoneRatio < 0.382 ? 'DISCOUNT' : 'EQUILIBRIUM';
  const gravityScore        = Math.round(Math.abs(zoneRatio - 0.5) * 2 * 100);
  const ref10   = bars.length >= 10 ? bars[bars.length - 10].close : null;
  const delta   = ref10 !== null ? price - ref10 : 0;
  const trend: TrendState  = delta > (base * 0.0007) ? 'BULLISH' : delta < -(base * 0.0007) ? 'BEARISH' : 'RANGING';
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
  const t0        = useRef(Math.floor(Date.now() / 1000));
  const sharedMom = useRef(0.04);
  const esMom     = useRef(0.04);
  const nqMom     = useRef(0.04);

  // Seed bars — computed once, never mutated
  // ES: D1 scale=8 (~30-60pt body), H4 scale=3 (~12-25pt), H1 scale=1.5 (~6-12pt)
  const d1ES = useRef(buildSeedBars(t0.current - D1_COUNT * 86400, ES_BASE, ES_TICK, D1_COUNT, 8));
  const h4ES = useRef(buildSeedBars(t0.current - H4_COUNT * 14400, ES_BASE, ES_TICK, H4_COUNT, 3));
  const h1ES = useRef(buildSeedBars(t0.current - H1_COUNT *  3600, ES_BASE, ES_TICK, H1_COUNT, 1.5));
  // NQ: D1 scale=20, H4 scale=8, H1 scale=4
  const d1NQ = useRef(buildSeedBars(t0.current - D1_COUNT * 86400, NQ_BASE, NQ_TICK, D1_COUNT, 20));
  const h4NQ = useRef(buildSeedBars(t0.current - H4_COUNT * 14400, NQ_BASE, NQ_TICK, H4_COUNT, 8));
  const h1NQ = useRef(buildSeedBars(t0.current - H1_COUNT *  3600, NQ_BASE, NQ_TICK, H1_COUNT, 4));

  const [streams, setStreams] = useState<{ es: CandleBar[]; nq: CandleBar[] }>(() => {
    const t = t0.current - EXEC_SEED;
    return {
      es: buildSeedBars(t, ES_BASE, ES_TICK, EXEC_SEED, 1),
      nq: buildSeedBars(t, NQ_BASE, NQ_TICK, EXEC_SEED, NQ_EXEC_SCALE),
    };
  });

  useEffect(() => {
    const id = setInterval(() => {
      sharedMom.current = sharedMom.current * 0.65 + (Math.random() - 0.5) * 0.35;
      esMom.current     = esMom.current * 0.3  + sharedMom.current * 0.7;
      const diverge     = Math.random() < 0.06;
      nqMom.current     = diverge
        ? -(sharedMom.current * 0.7)
        : nqMom.current * 0.3 + sharedMom.current * 0.7;

      const esMomSnap = esMom.current;
      const nqMomSnap = nqMom.current;

      setStreams(prev => {
        const esLast = prev.es[prev.es.length - 1];
        const esO    = esLast.close;
        const esMove = esMomSnap * 8 + (Math.random() - 0.5) * 2.5;
        const esC    = snap(esO + esMove);
        const esSp   = Math.abs(esC - esO);
        const esWk   = esSp * 0.4 + Math.random() * 1.2;
        const esBar: CandleBar = {
          time : esLast.time + 1, open: esO,
          high : snap(Math.max(esO, esC) + esWk * Math.random()),
          low  : snap(Math.min(esO, esC) - esWk * Math.random()),
          close: esC, volume: Math.floor(800 + Math.random() * 3500),
        };

        const nqLast = prev.nq[prev.nq.length - 1];
        const nqO    = nqLast.close;
        const nqMove = nqMomSnap * 8 * NQ_EXEC_SCALE + (Math.random() - 0.5) * 4;
        const nqC    = snap(nqO + nqMove, NQ_TICK);
        const nqSp   = Math.abs(nqC - nqO);
        const nqWk   = nqSp * 0.4 + Math.random() * NQ_EXEC_SCALE;
        const nqBar: CandleBar = {
          time : nqLast.time + 1, open: nqO,
          high : snap(Math.max(nqO, nqC) + nqWk * Math.random(), NQ_TICK),
          low  : snap(Math.min(nqO, nqC) - nqWk * Math.random(), NQ_TICK),
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

  const analysis = useMemo(() => {
    const { es, nq } = streams;

    // Defensive: return empty state before first tick populates streams
    if (!es.length || !nq.length) {
      const emptyBiasV2: DailyBiasV2 = {
        bias: 'INDECISIVE', score: 0,
        factors: { honoredGaps: false, explosiveGaps: false, iFVGsActive: false, sessionLiqUnswept: false, inducementUnswept: false },
        commentary: 'initializing...', d1Event: null, h4Event: null,
      };
      const emptyLegacy: DailyBias = { bias: 'INDECISIVE', d1Event: null, h4Event: null, reason: 'initializing...' };
      const emptyFactors: BiasFactors = { h4FVGs: [], h1FVGs: [], sessionLiq: [], inducement: [] };
      return {
        esDailyBias: emptyBiasV2, nqDailyBias: emptyBiasV2,
        esBiasFactors: emptyFactors, nqBiasFactors: emptyFactors,
        dailyBias: emptyLegacy,
        mtfMatrix: [] as MTFRow[], htfOB: null, htfFVG: null,
        ltfFVGs: [] as FVGZone[], orderFlow: computeOrderFlow([], ES_BASE),
        smt: { active: false, type: null } as SMTState,
        confluence: { active: false, htfZoneAligned: false, liquiditySweep: false, smtDivergence: false, score: 0 },
      };
    }

    const esPrice = es[es.length - 1].close;
    const nqPrice = nq[nq.length - 1].close;

    // ── Structure (ES) ────────────────────────────────────────────────────
    const d1ESRow   = analyzeStructure(d1ES.current, 'D1');
    const h4ESRow   = analyzeStructure(h4ES.current, 'H4');
    const h1ESRow   = analyzeStructure(h1ES.current, 'H1');
    const execESRow = analyzeStructure(es.slice(-20), 'Exec');

    // ── Structure (NQ) ────────────────────────────────────────────────────
    const d1NQRow = analyzeStructure(d1NQ.current, 'D1');
    const h4NQRow = analyzeStructure(h4NQ.current, 'H4');

    // ── Enhanced FVGs — ES (H4 + H1) ─────────────────────────────────────
    const h4ESFVGs = detectEnhancedFVGs(h4ES.current, 'H4', esPrice);
    const h1ESFVGs = detectEnhancedFVGs(h1ES.current, 'H1', esPrice);

    // ── Enhanced FVGs — NQ (H4 + H1) ─────────────────────────────────────
    const h4NQFVGs = detectEnhancedFVGs(h4NQ.current, 'H4', nqPrice);
    const h1NQFVGs = detectEnhancedFVGs(h1NQ.current, 'H1', nqPrice);

    // ── Session Liquidity (H1 resolution) ────────────────────────────────
    const esSessionLiq = detectSessionLiquidity(h1ES.current, esPrice);
    const nqSessionLiq = detectSessionLiquidity(h1NQ.current, nqPrice);

    // ── Inducement (H4 + H1 + 15m proxy from exec stream) ────────────────
    const esInducement: InducementLevel[] = [
      ...detectInducementLevels(h4ES.current, 'H4', esPrice),
      ...detectInducementLevels(h1ES.current, 'H1', esPrice),
      ...detectInducementLevels(es.slice(-15), '15m', esPrice),
    ];
    const nqInducement: InducementLevel[] = [
      ...detectInducementLevels(h4NQ.current, 'H4', nqPrice),
      ...detectInducementLevels(h1NQ.current, 'H1', nqPrice),
      ...detectInducementLevels(nq.slice(-15), '15m', nqPrice),
    ];

    // ── Daily Bias V2 — concurrent ES + NQ ───────────────────────────────
    const esDailyBias = computeDailyBiasV2(
      d1ESRow, h4ESRow, esPrice, h4ESFVGs, h1ESFVGs, esSessionLiq, esInducement,
    );
    const nqDailyBias = computeDailyBiasV2(
      d1NQRow, h4NQRow, nqPrice, h4NQFVGs, h1NQFVGs, nqSessionLiq, nqInducement,
    );

    // ── Legacy DailyBias — ES only, for existing DashboardView callsites ──
    const dailyBias: DailyBias = {
      bias    : esDailyBias.bias,
      d1Event : esDailyBias.d1Event,
      h4Event : esDailyBias.h4Event,
      reason  : esDailyBias.commentary,
    };

    const mtfMatrix: MTFRow[] = [d1ESRow, h4ESRow, h1ESRow, execESRow];
    const htfOB    = detectOrderBlock(h4ES.current, 'H4', esPrice);
    const htfFVG   = h4ESFVGs.at(-1) ?? null;
    const ltfFVGs  = detectFVGs(es.slice(-30), 'Exec', esPrice);
    const orderFlow = computeOrderFlow(es, ES_BASE);
    const smt       = detectSMT(es, nq);
    const confluence = detectConfluence(orderFlow, dailyBias, smt);

    return {
      esDailyBias, nqDailyBias,
      esBiasFactors: { h4FVGs: h4ESFVGs, h1FVGs: h1ESFVGs, sessionLiq: esSessionLiq, inducement: esInducement },
      nqBiasFactors: { h4FVGs: h4NQFVGs, h1FVGs: h1NQFVGs, sessionLiq: nqSessionLiq, inducement: nqInducement },
      dailyBias, mtfMatrix, htfOB, htfFVG, ltfFVGs, orderFlow, smt, confluence,
    };
  }, [streams]);

  const esPrice       = streams.es[streams.es.length - 1]?.close ?? ES_BASE;
  const esFirst       = streams.es[0]?.open ?? ES_BASE;
  const nqPrice       = streams.nq[streams.nq.length - 1]?.close ?? NQ_BASE;
  const nqFirst       = streams.nq[0]?.open ?? NQ_BASE;
  const priceChange   = esPrice - esFirst;
  const nqPriceChange = nqPrice - nqFirst;

  return {
    esCandles      : streams.es,
    currentPrice   : esPrice,
    priceChange,
    pricePct       : (priceChange / esFirst) * 100,
    nqCandles      : streams.nq,
    nqCurrentPrice : nqPrice,
    nqPriceChange,
    nqPricePct     : (nqPriceChange / nqFirst) * 100,
    ...analysis,
  };
}
