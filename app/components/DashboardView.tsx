'use client';

import { useMarketStream } from '../hooks/useMarketStream';
import { useLivePrices } from '../hooks/useLivePrices';
import type {
  Bias, StructureEvent, ZoneState, TrendState, SweepState,
  SMTState, ConfluenceState, MTFRow, OrderBlock, FVGZone, DailyBiasV2,
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

// ─── Market-hours check (CME Globex: Sun 6pm–Fri 5pm ET, daily 4–5pm break) ─

function isMarketOpen(): boolean {
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const day      = parts.find(p => p.type === 'weekday')?.value ?? '';
  const hour     = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10);
  const minute   = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const totalMin = hour * 60 + minute;
  if (day === 'Sat') return false;
  if (day === 'Sun' && totalMin < 18 * 60) return false;
  if (day === 'Fri' && totalMin >= 17 * 60) return false;
  if (totalMin >= 16 * 60 && totalMin < 17 * 60) return false; // daily settlement break
  return true;
}

// ─── Dual Bias Strip (50/50 ES | NQ) ───────────────────────────────────────

const biasColor: Record<Bias, string> = {
  BULLISH:    'text-green-400',
  BEARISH:    'text-red-400',
  INDECISIVE: 'text-gray-400',
};

const activeCls: Record<Bias, string> = {
  BULLISH:    'bg-green-950 text-green-400 border border-green-800',
  BEARISH:    'bg-red-950 text-red-400 border border-red-800',
  INDECISIVE: 'bg-neutral-800 text-neutral-300 border border-neutral-700',
};
const dimCls = 'bg-neutral-900 text-neutral-500 border border-neutral-800';

const FACTORS: { key: keyof DailyBiasV2['factors']; label: string }[] = [
  { key: 'honoredGaps',       label: 'Honored Gaps'  },
  { key: 'explosiveGaps',     label: 'Explosive Gaps' },
  { key: 'iFVGsActive',       label: 'iFVGs Active'  },
  { key: 'sessionLiqUnswept', label: 'Session Liq'   },
  { key: 'inducementUnswept', label: 'Inducement'    },
];

function BiasPanel({ symbol, bias }: { symbol: string; bias: DailyBiasV2 }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-2">
      {/* Row 1 — title · status · score */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-muted uppercase tracking-[0.18em] shrink-0">{symbol}</span>
        <span className={`text-[11px] font-mono font-bold tracking-widest ${biasColor[bias.bias]}`}>
          {bias.bias === 'BULLISH' ? '▲' : bias.bias === 'BEARISH' ? '▼' : '◈'} {bias.bias}
        </span>
        <span className="text-[10px] font-mono text-muted tabular-nums">Score: {bias.score}/6</span>
      </div>
      {/* Row 2 — factor badges (fixed order, always visible) */}
      <div className="flex items-center gap-1.5">
        {FACTORS.map(f => (
          <span
            key={f.key}
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wide ${bias.factors[f.key] ? activeCls[bias.bias] : dimCls}`}
          >
            {f.label}
          </span>
        ))}
      </div>
      {/* Row 3 — commentary */}
      <p className="text-[9px] font-mono text-neutral-500 truncate leading-tight">
        {bias.commentary}
      </p>
    </div>
  );
}

function DualBiasStrip({ es, nq }: { es: DailyBiasV2; nq: DailyBiasV2 }) {
  return (
    <div className="grid grid-cols-2 border-b border-border shrink-0">
      <div className="border-r border-border bg-surface/40">
        <BiasPanel symbol="ES1! · S&P 500" bias={es} />
      </div>
      <div className="bg-surface/40">
        <BiasPanel symbol="NQ1! · Nasdaq" bias={nq} />
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
    esDailyBias, nqDailyBias,
    dailyBias, mtfMatrix,
    htfOB, htfFVG, ltfFVGs,
    orderFlow, smt, confluence,
  } = useMarketStream();

  const live = useLivePrices();

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* Dual bias strip — ES left / NQ right */}
      <DualBiasStrip es={esDailyBias} nq={nqDailyBias} />

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

        {/* Market status indicator */}
        {isMarketOpen() ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bullish opacity-70" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-bullish" />
            </span>
            <span className="text-[10px] text-muted font-mono uppercase tracking-widest">LIVE</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-2 w-2 rounded-full bg-neutral-600 shrink-0" />
            <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest">
              Market Closed · Data Frozen
            </span>
          </div>
        )}
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
