'use client';

import { useMarketStream } from '../hooks/useMarketStream';
import { useLivePrices } from '../hooks/useLivePrices';
import type {
  Bias, StructureEvent, ZoneState, TrendState, SweepState,
  SMTState, ConfluenceState, MTFRow, OrderBlock, FVGZone, DailyBiasV2, BiasRule,
} from '../hooks/useMarketStream';
import SmcChart from './SmcChart';

// ─── Primitive helpers ──────────────────────────────────────────────────────

type Variant = 'bullish' | 'bearish' | 'gold' | 'blue' | 'muted' | 'indecisive';
const variantCls: Record<Variant, string> = {
  bullish:    'bg-bullish/10 text-bullish border border-bullish/25',
  bearish:    'bg-bearish/10 text-bearish border border-bearish/25',
  gold:       'bg-gold/10 text-gold border border-gold/25',
  blue:       'bg-accent/10 text-accent border border-accent/25',
  muted:      'bg-background text-muted border border-border',
  indecisive: 'bg-surface text-muted border border-border',
};
function Badge({ label, variant }: { label: string; variant: Variant }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[9px] font-mono tracking-widest ${variantCls[variant]}`}>
      {label}
    </span>
  );
}
function Rule() { return <div className="h-px bg-[#1c1c1e] w-full" />; }

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

const RULE_SHORT: Record<BiasRule, string> = {
  SWEEP_CHOCH_BULL:  'SSL Sweep + CHoCH',
  D1_BULL_FVG:       'D1 Bull FVG',
  H4_BULL_FVG:       'H4 Bull FVG',
  BEAR_IFVG_SUPPORT: 'Bear iFVG Support',
  SWEEP_CHOCH_BEAR:  'BSL Sweep + CHoCH',
  D1_BEAR_FVG:       'D1 Bear FVG',
  H4_BEAR_FVG:       'H4 Bear FVG',
  BULL_IFVG_RESIST:  'Bull iFVG Resist',
  CONFLICTING_ZONES: 'Conflicting Zones',
  TIGHT_RANGE:       'No Clear Structure',
};

const biasColor: Record<Bias, string> = {
  BULLISH:    'text-bullish',
  BEARISH:    'text-bearish',
  INDECISIVE: 'text-muted',
};

const activeCls: Record<Bias, string> = {
  BULLISH:    'bg-bullish/10 text-bullish border border-bullish/30',
  BEARISH:    'bg-bearish/10 text-bearish border border-bearish/30',
  INDECISIVE: 'bg-surface text-muted border border-border',
};
const dimCls = 'bg-background text-muted/40 border border-border';

const FACTORS: { key: keyof DailyBiasV2['factors']; label: string }[] = [
  { key: 'honoredGaps',       label: 'Honored Gaps'  },
  { key: 'explosiveGaps',     label: 'Explosive Gaps' },
  { key: 'iFVGsActive',       label: 'iFVGs Active'  },
  { key: 'sessionLiqUnswept', label: 'Session Liq'   },
  { key: 'inducementUnswept', label: 'Inducement'    },
];

function BiasPanel({ symbol, bias }: { symbol: string; bias: DailyBiasV2 }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-3">
      {/* Row 1 — title · status · rule */}
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] shrink-0">{symbol}</span>
        <span className={`text-[11px] font-mono font-semibold tracking-widest ${biasColor[bias.bias]}`}>
          {bias.bias === 'BULLISH' ? '▲' : bias.bias === 'BEARISH' ? '▼' : '◈'} {bias.bias}
        </span>
        <span className="text-[9px] font-mono text-muted/70 truncate max-w-[150px] tracking-wide">
          {bias.rule ? RULE_SHORT[bias.rule] : '—'}
        </span>
      </div>
      {/* Row 2 — factor badges */}
      <div className="flex items-center gap-1.5">
        {FACTORS.map(f => (
          <span
            key={f.key}
            className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-medium tracking-wide transition-all duration-700 ease-in-out ${bias.factors[f.key] ? activeCls[bias.bias] : dimCls}`}
          >
            {f.label}
          </span>
        ))}
      </div>
      {/* Row 3 — commentary */}
      <p className="text-[9px] font-mono text-muted/50 truncate leading-tight tracking-wider">
        {bias.commentary}
      </p>
    </div>
  );
}

function DualBiasStrip({ es, nq }: { es: DailyBiasV2; nq: DailyBiasV2 }) {
  return (
    <div className="grid grid-cols-2 border-b border-[#1c1c1e] shrink-0">
      <div className="border-r border-[#1c1c1e] bg-surface">
        <BiasPanel symbol="ES1! · S&P 500" bias={es} />
      </div>
      <div className="bg-surface">
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
      <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block leading-none mb-1.5">
        {symbol}
      </span>
      <div className="flex items-baseline gap-2.5">
        <span className={`text-xl font-semibold font-mono text-foreground tabular-nums tracking-tight ${flash === 'up' ? 'price-flash-up' : flash === 'down' ? 'price-flash-down' : ''}`}>
          {price > 0 ? price.toFixed(2) : '—'}
        </span>
        <span className={`text-[11px] font-mono tabular-nums ${bull ? 'text-bullish' : 'text-bearish'}`}>
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
      <div className="px-5 py-2.5 border-b border-[#1c1c1e] bg-[#0d0d0f] shrink-0 flex items-center justify-between">
        <span className="font-serif text-[11px] tracking-[0.08em] text-[#c0c0c0]/70 uppercase">{label}</span>
      </div>
      <div className="flex-1 min-h-0 bg-[#050505]">{children}</div>
    </div>
  );
}

// ─── MTF Matrix ─────────────────────────────────────────────────────────────

function MTFMatrix({ rows }: { rows: MTFRow[] }) {
  return (
    <div>
      <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-3">MTF Structure</span>
      <div className="flex flex-col">
        {rows.map(r => (
          <div key={r.tf} className="flex items-center justify-between py-2 border-b border-[#1c1c1e] last:border-0">
            <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider w-9 shrink-0">{r.tf}</span>
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
      <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-3">SMC Arrays</span>
      <div className="flex flex-col gap-2.5">
        {/* HTF Order Block */}
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider">HTF OB</span>
          {ob
            ? <div className="flex items-center gap-1.5">
                <Badge label={ob.type === 'BULLISH' ? 'BULL OB' : 'BEAR OB'} variant={ob.type === 'BULLISH' ? 'bullish' : 'bearish'} />
                <span className="text-[9px] font-mono text-muted/60 tabular-nums">{ob.low.toFixed(1)}–{ob.high.toFixed(1)}</span>
              </div>
            : <Badge label="NONE" variant="muted" />}
        </div>
        {/* HTF FVG — bullish=emerald, bearish=burgundy, both edged gold */}
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider">HTF FVG</span>
          {htfFVG
            ? <div className="flex items-center gap-1.5">
                <Badge label={htfFVG.type === 'BULLISH' ? 'BULL FVG' : 'BEAR FVG'} variant={htfFVG.type === 'BULLISH' ? 'bullish' : 'bearish'} />
                <span className="text-[9px] font-mono text-gold tabular-nums">{Math.round(htfFVG.fillPct)}%</span>
              </div>
            : <Badge label="NONE" variant="muted" />}
        </div>
        {/* LTF FVG pool — inducement glow in gold */}
        <div className={`flex justify-between items-center rounded px-2 py-1 transition-all duration-700 ease-in-out ${ltfFVGs.length > 0 ? 'bg-gold/5 border border-gold/15' : ''}`}>
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider">LTF FVGs</span>
          <span className={`text-[11px] font-mono tabular-nums ${ltfFVGs.length > 0 ? 'text-gold' : 'text-muted/50'}`}>{ltfFVGs.length} active</span>
        </div>
      </div>
    </div>
  );
}

// ─── Gravity bar ─────────────────────────────────────────────────────────────

function GravityBar({ score, zone }: { score: number; zone: ZoneState }) {
  const bar = zone === 'PREMIUM' ? 'bg-bearish' : zone === 'DISCOUNT' ? 'bg-bullish' : 'bg-muted/40';
  const tx  = score > 55 ? (zone === 'PREMIUM' ? 'text-bearish' : zone === 'DISCOUNT' ? 'text-bullish' : 'text-muted') : 'text-muted/60';
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em]">Gravity Score</span>
        <span className={`text-[11px] font-mono tabular-nums ${tx}`}>{score}%</span>
      </div>
      <div className="h-px bg-[#1c1c1e] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ease-in-out ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ─── Confluence panel ─────────────────────────────────────────────────────────

function ConfluencePanel({ state, smt }: { state: ConfluenceState; smt: SMTState }) {
  return (
    <div className={`rounded border p-4 transition-all duration-700 ease-in-out ${state.active ? 'border-gold/30 bg-gold/5' : 'border-[#1c1c1e] bg-transparent'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em]">Confluence</span>
        <span className={`text-[10px] font-mono ${state.score === 3 ? 'text-gold' : state.score === 2 ? 'text-gold/60' : 'text-muted/50'}`}>{state.score}/3</span>
      </div>
      {state.active && (
        <div className="text-[9px] font-mono text-gold tracking-[0.15em] mb-3">◈ INSTITUTIONAL ENTRY SIGNAL</div>
      )}
      {[
        { label: 'HTF Zone Aligned', active: state.htfZoneAligned },
        { label: 'Liquidity Sweep',  active: state.liquiditySweep },
        { label: 'SMT Divergence',   active: state.smtDivergence  },
      ].map(r => (
        <div key={r.label} className="flex items-center gap-2 mb-1">
          <span className={`text-[9px] transition-all duration-700 ease-in-out ${r.active ? 'text-gold' : 'text-[#1c1c1e]'}`}>{r.active ? '✓' : '○'}</span>
          <span className={`text-[9px] font-mono tracking-wider transition-all duration-700 ease-in-out ${r.active ? 'text-foreground' : 'text-muted/50'}`}>{r.label}</span>
        </div>
      ))}
      {smt.active && smt.type && (
        <div className="mt-3 pt-3 border-t border-[#1c1c1e]">
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
    <div className="flex flex-col h-full bg-[#050505] text-[#c0c0c0] overflow-hidden">

      {/* Dual bias strip — ES left / NQ right */}
      <DualBiasStrip es={esDailyBias} nq={nqDailyBias} />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div className="flex items-center gap-6">
          {/* ES — live CME futures price */}
          <PriceBlock
            symbol="ES1! · S&P 500 Futures"
            price={live.es.price}
            change={live.es.change}
            pct={live.es.pct}
            flash={live.es.flash}
          />
          <div className="h-8 w-px bg-[#1c1c1e]" />
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

        {/* Market status indicator — steady, no animation */}
        {isMarketOpen() ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-gold shrink-0" />
            <span className="text-[9px] text-gold font-mono uppercase tracking-[0.25em]">Live</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-muted/40 shrink-0" />
            <span className="text-[9px] text-muted/50 font-mono uppercase tracking-[0.25em]">Closed</span>
          </div>
        )}
      </header>

      {/* ── Chart area (50/50 split + analytics sidebar) ── */}
      <div className="flex flex-1 min-h-0">

        {/* ES Chart — live TradingView data */}
        <ChartPanel label="ES1! — S&P 500 · Liquidity & Structure">
          <SmcChart symbol="ES" interval="5" />
        </ChartPanel>

        <div className="w-px bg-[#1c1c1e] shrink-0" />

        {/* NQ Chart — live TradingView data */}
        <ChartPanel label="NQ1! — Nasdaq · SMT Divergence Monitor">
          <SmcChart symbol="NQ" interval="5" />
        </ChartPanel>

        {/* Analytics sidebar */}
        <aside className="w-56 shrink-0 border-l border-[#1c1c1e] bg-[#0d0d0f] flex flex-col overflow-y-auto">
          <div className="px-5 py-3 border-b border-[#1c1c1e] shrink-0">
            <span className="font-serif text-[11px] tracking-[0.1em] text-[#c0c0c0]/70 uppercase">Analytics</span>
          </div>

          <div className="flex flex-col gap-5 px-5 py-5">

            <GravityBar score={orderFlow.gravityScore} zone={orderFlow.zone} />

            {/* Liquidity Magnet */}
            <div>
              <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-2">Liq. Magnet</span>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-mono text-gold tabular-nums">{orderFlow.liquidityMagnet.toFixed(2)}</span>
                <span className="text-[9px] font-mono text-muted/50">{orderFlow.zone === 'PREMIUM' ? '↓ draw' : '↑ draw'}</span>
              </div>
            </div>

            {/* Price levels */}
            <div className="flex flex-col gap-2">
              {[
                { label: 'Range H',  val: orderFlow.rangeHigh,    cls: 'text-bearish' },
                { label: 'Equilib.', val: orderFlow.equilibrium,  cls: 'text-gold'    },
                { label: 'Range L',  val: orderFlow.rangeLow,     cls: 'text-bullish' },
              ].map(r => (
                <div key={r.label} className="flex justify-between items-center">
                  <span className="text-[9px] font-mono text-muted/60 uppercase tracking-wider">{r.label}</span>
                  <span className={`text-[11px] font-mono tabular-nums ${r.cls}`}>{r.val.toFixed(2)}</span>
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
