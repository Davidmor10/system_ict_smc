'use client';

import { useMarketStream } from '../hooks/useMarketStream';
import { useLivePrices } from '../hooks/useLivePrices';
import type {
  Bias, StructureEvent, ZoneState, TrendState, SweepState,
  SMTState, ConfluenceState, MTFRow, OrderBlock, FVGZone,
} from '../hooks/useMarketStream';
import SmcChart from './SmcChart';

// ─── Primitive helpers ──────────────────────────────────────────────────────

type Variant = 'bullish' | 'bearish' | 'gold' | 'blue' | 'muted' | 'indecisive';
const variantCls: Record<Variant, string> = {
  bullish:    'bg-bullish/10 text-bullish border border-bullish/25',
  bearish:    'bg-bearish/10 text-bearish border border-bearish/25',
  gold:       'bg-sweep/10 text-sweep border border-sweep/25',
  blue:       'bg-accent/10 text-accent border border-accent/25',
  muted:      'bg-background text-muted border border-border',
  indecisive: 'bg-surface text-muted border border-border',
};
function Badge({ label, variant }: { label: string; variant: Variant }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-widest ${variantCls[variant]}`}>
      {label}
    </span>
  );
}
function Rule() { return <div className="h-px bg-border w-full" />; }

// ─── Variant mappers ────────────────────────────────────────────────────────

function bv(b: Bias): Variant     { return b === 'BULLISH' ? 'bullish' : b === 'BEARISH' ? 'bearish' : 'indecisive'; }
function zv(z: ZoneState): Variant { return z === 'PREMIUM' ? 'bearish' : z === 'DISCOUNT' ? 'bullish' : 'muted'; }
function tv(t: TrendState): Variant { return t === 'BULLISH' ? 'bullish' : t === 'BEARISH' ? 'bearish' : 'muted'; }
function sv(s: SweepState): Variant { return s === 'BUY_SIDE_SWEEP' ? 'bullish' : s === 'SELL_SIDE_SWEEP' ? 'bearish' : 'muted'; }
function smv(s: SMTState): Variant  { return s.active ? (s.type === 'BULLISH_SMT' ? 'bullish' : 'bearish') : 'muted'; }
function evLabel(e: StructureEvent): string  { return e ? e.replace('_', ' ') : '—'; }
function evVariant(e: StructureEvent): Variant { return !e ? 'muted' : e.includes('BULL') ? 'bullish' : 'bearish'; }

// ─── Daily Bias Strip ───────────────────────────────────────────────────────

function BiasStrip({ bias, reason, d1Event, h4Event }: {
  bias: Bias; reason: string; d1Event: StructureEvent; h4Event: StructureEvent;
}) {
  const strip: Record<Bias, string> = {
    BULLISH:    'bg-bullish/8 border-b border-bullish/20',
    BEARISH:    'bg-bearish/8 border-b border-bearish/20',
    INDECISIVE: 'bg-surface border-b border-border',
  };
  const lc: Record<Bias, string> = {
    BULLISH: 'text-bullish', BEARISH: 'text-bearish', INDECISIVE: 'text-muted',
  };
  return (
    <div className={`flex items-center gap-4 px-5 py-1.5 shrink-0 ${strip[bias]}`}>
      <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em]">Daily Bias</span>
      <span className={`text-[11px] font-mono font-bold tracking-widest ${lc[bias]}`}>
        {bias === 'BULLISH' ? '▲' : bias === 'BEARISH' ? '▼' : '◈'} {bias}
      </span>
      <span className="text-[10px] font-mono text-muted hidden lg:block truncate max-w-sm">{reason}</span>
      <div className="ml-auto flex items-center gap-2">
        {d1Event && <Badge label={`D1: ${evLabel(d1Event)}`} variant={evVariant(d1Event)} />}
        {h4Event && <Badge label={`H4: ${evLabel(h4Event)}`} variant={evVariant(h4Event)} />}
      </div>
    </div>
  );
}

// ─── Instrument price block ─────────────────────────────────────────────────

function PriceBlock({ symbol, price, change, pct, flash }: {
  symbol: string; price: number; change: number; pct: number;
  flash?: 'up' | 'down' | null;
}) {
  const bull = change >= 0;
  return (
    <div>
      <span className="text-[10px] font-mono text-muted uppercase tracking-[0.18em] block leading-none mb-1">
        {symbol}
      </span>
      <div className="flex items-baseline gap-2">
        <span className={`text-xl font-semibold font-mono text-foreground tabular-nums ${flash === 'up' ? 'price-flash-up' : flash === 'down' ? 'price-flash-down' : ''}`}>
          {price > 0 ? price.toFixed(2) : '—'}
        </span>
        <span className={`text-xs font-mono font-medium tabular-nums ${bull ? 'text-bullish' : 'text-bearish'}`}>
          {price > 0 ? `${bull ? '+' : ''}${change.toFixed(2)} (${bull ? '+' : ''}${pct.toFixed(2)}%)` : ''}
        </span>
      </div>
    </div>
  );
}

// ─── Chart panel wrapper ────────────────────────────────────────────────────

function ChartPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="px-4 py-2 border-b border-border bg-surface/40 shrink-0">
        <span className="text-[10px] font-mono text-muted uppercase tracking-[0.15em]">{label}</span>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

// ─── MTF Matrix ─────────────────────────────────────────────────────────────

function MTFMatrix({ rows }: { rows: MTFRow[] }) {
  return (
    <div>
      <span className="text-[10px] font-mono text-muted uppercase tracking-[0.15em] block mb-2">MTF Structure</span>
      <div className="flex flex-col">
        {rows.map(r => (
          <div key={r.tf} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
            <span className="text-[10px] font-mono text-muted uppercase tracking-wider w-9 shrink-0">{r.tf}</span>
            <div className="flex items-center gap-1.5 ml-auto">
              <Badge label={r.bias} variant={bv(r.bias)} />
              {r.event && <Badge label={evLabel(r.event)} variant={evVariant(r.event)} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SMC Arrays ─────────────────────────────────────────────────────────────

function SMCArrays({ ob, htfFVG, ltfFVGs }: { ob: OrderBlock | null; htfFVG: FVGZone | null; ltfFVGs: FVGZone[] }) {
  return (
    <div>
      <span className="text-[10px] font-mono text-muted uppercase tracking-[0.15em] block mb-2">SMC Arrays</span>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-muted uppercase">HTF OB</span>
          {ob
            ? <div className="flex items-center gap-1"><Badge label={ob.type === 'BULLISH' ? 'BULL OB' : 'BEAR OB'} variant={ob.type === 'BULLISH' ? 'bullish' : 'bearish'} /><span className="text-[9px] font-mono text-muted tabular-nums">{ob.low.toFixed(1)}–{ob.high.toFixed(1)}</span></div>
            : <Badge label="NONE" variant="muted" />}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-muted uppercase">HTF FVG</span>
          {htfFVG
            ? <div className="flex items-center gap-1"><Badge label={htfFVG.type === 'BULLISH' ? 'BULL FVG' : 'BEAR FVG'} variant={htfFVG.type === 'BULLISH' ? 'blue' : 'gold'} /><span className="text-[9px] font-mono text-muted tabular-nums">{Math.round(htfFVG.fillPct)}%</span></div>
            : <Badge label="NONE" variant="muted" />}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-muted uppercase">LTF FVGs</span>
          <span className={`text-xs font-mono font-semibold ${ltfFVGs.length > 0 ? 'text-accent' : 'text-muted'}`}>{ltfFVGs.length} active</span>
        </div>
      </div>
    </div>
  );
}

// ─── Gravity bar ─────────────────────────────────────────────────────────────

function GravityBar({ score, zone }: { score: number; zone: ZoneState }) {
  const bar = zone === 'PREMIUM' ? 'bg-bearish' : zone === 'DISCOUNT' ? 'bg-bullish' : 'bg-muted';
  const tx  = score > 55 ? (zone === 'PREMIUM' ? 'text-bearish' : zone === 'DISCOUNT' ? 'text-bullish' : 'text-muted') : 'text-muted';
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Gravity Score</span>
        <span className={`text-xs font-mono font-semibold tabular-nums ${tx}`}>{score}%</span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ─── Confluence panel ─────────────────────────────────────────────────────────

function ConfluencePanel({ state, smt }: { state: ConfluenceState; smt: SMTState }) {
  return (
    <div className={`rounded border p-3 transition-all duration-500 ${state.active ? 'border-sweep/50 bg-sweep/8' : 'border-border bg-transparent'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-muted uppercase tracking-[0.15em]">Confluence</span>
        <span className={`text-[10px] font-mono font-bold ${state.score === 3 ? 'text-bullish' : state.score === 2 ? 'text-sweep' : 'text-muted'}`}>{state.score}/3</span>
      </div>
      {state.active && (
        <div className="text-[10px] font-mono text-sweep font-semibold tracking-wide mb-2">◈ PROBABLE INSTITUTIONAL ENTRY</div>
      )}
      {[
        { label: 'HTF Zone Aligned', active: state.htfZoneAligned },
        { label: 'Liquidity Sweep',  active: state.liquiditySweep },
        { label: 'SMT Divergence',   active: state.smtDivergence  },
      ].map(r => (
        <div key={r.label} className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] ${r.active ? 'text-sweep' : 'text-border'}`}>{r.active ? '✓' : '○'}</span>
          <span className={`text-[10px] font-mono ${r.active ? 'text-foreground' : 'text-muted'}`}>{r.label}</span>
        </div>
      ))}
      {smt.active && smt.type && (
        <div className="mt-2 pt-2 border-t border-border">
          <Badge label={smt.type.replace('_', ' ')} variant={smv(smt)} />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardView() {
  const {
    dailyBias, mtfMatrix,
    htfOB, htfFVG, ltfFVGs,
    orderFlow, smt, confluence,
  } = useMarketStream();

  const live = useLivePrices();

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* Daily Bias strip */}
      <BiasStrip
        bias={dailyBias.bias}
        reason={dailyBias.reason}
        d1Event={dailyBias.d1Event}
        h4Event={dailyBias.h4Event}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-5">
          {/* ES — live CME futures price */}
          <PriceBlock
            symbol="ES1! · S&P 500 Futures"
            price={live.es.price}
            change={live.es.change}
            pct={live.es.pct}
            flash={live.es.flash}
          />
          <div className="h-8 w-px bg-border" />
          {/* NQ — live CME futures price */}
          <PriceBlock
            symbol="NQ1! · Nasdaq Futures"
            price={live.nq.price}
            change={live.nq.change}
            pct={live.nq.pct}
            flash={live.nq.flash}
          />
          {/* State badges */}
          <div className="hidden xl:flex items-center gap-2 ml-2">
            <Badge label={orderFlow.zone}  variant={zv(orderFlow.zone)} />
            <Badge label={orderFlow.trend} variant={tv(orderFlow.trend)} />
            {orderFlow.sweep && <Badge label={orderFlow.sweep} variant={sv(orderFlow.sweep)} />}
            {smt.active && smt.type && <Badge label={smt.type.replace('_', ' ')} variant={smv(smt)} />}
          </div>
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bullish opacity-70" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-bullish" />
          </span>
          <span className="text-[10px] text-muted font-mono uppercase tracking-widest">LIVE</span>
        </div>
      </header>

      {/* ── Chart area (50/50 split + analytics sidebar) ── */}
      <div className="flex flex-1 min-h-0">

        {/* ES Chart — live TradingView data */}
        <ChartPanel label="Panel 1 — ES1! · Liquidity Magnet &amp; Gravity Score">
          <SmcChart symbol="ES" interval="5" />
        </ChartPanel>

        <div className="w-px bg-border shrink-0" />

        {/* NQ Chart — live TradingView data */}
        <ChartPanel label="Panel 2 — NQ1! · SMT Monitor">
          <SmcChart symbol="NQ" interval="5" />
        </ChartPanel>

        {/* Analytics sidebar */}
        <aside className="w-52 shrink-0 border-l border-border bg-surface flex flex-col overflow-y-auto">
          <div className="px-4 py-2 border-b border-border shrink-0">
            <span className="text-[10px] font-mono text-muted uppercase tracking-[0.15em]">Analytics</span>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4">

            <GravityBar score={orderFlow.gravityScore} zone={orderFlow.zone} />

            {/* Liquidity Magnet */}
            <div>
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block mb-1">Liq. Magnet</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-mono text-sweep font-semibold tabular-nums">{orderFlow.liquidityMagnet.toFixed(2)}</span>
                <span className="text-[10px] font-mono text-muted">{orderFlow.zone === 'PREMIUM' ? '↓ draw' : '↑ draw'}</span>
              </div>
            </div>

            {/* Price levels */}
            <div className="flex flex-col gap-1.5">
              {[
                { label: 'Range H', val: orderFlow.rangeHigh,  cls: 'text-bearish' },
                { label: 'Equilib.', val: orderFlow.equilibrium, cls: 'text-sweep'   },
                { label: 'Range L', val: orderFlow.rangeLow,   cls: 'text-bullish'  },
              ].map(r => (
                <div key={r.label} className="flex justify-between items-center">
                  <span className="text-[10px] font-mono text-muted uppercase tracking-wider">{r.label}</span>
                  <span className={`text-[11px] font-mono font-semibold tabular-nums ${r.cls}`}>{r.val.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <Rule />
            <MTFMatrix rows={mtfMatrix} />
            <Rule />
            <SMCArrays ob={htfOB} htfFVG={htfFVG} ltfFVGs={ltfFVGs} />
            <Rule />
            <ConfluencePanel state={confluence} smt={smt} />
          </div>
        </aside>
      </div>
    </div>
  );
}
