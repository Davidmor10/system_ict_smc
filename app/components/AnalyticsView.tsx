'use client';

import { useMarketStream } from '../hooks/useMarketStream';
import type {
  Bias, StructureEvent, MTFRow, EnhancedFVGZone,
  SessionLiq, InducementLevel, SMTState, ConfluenceState,
  BiasFactors, DailyBiasV2, BiasRule,
} from '../hooks/useMarketStream';

// ─── Shared primitives ──────────────────────────────────────────────────────

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
    <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-semibold tracking-widest ${variantCls[variant]}`}>
      {label}
    </span>
  );
}

function bv(b: Bias): Variant {
  return b === 'BULLISH' ? 'bullish' : b === 'BEARISH' ? 'bearish' : 'indecisive';
}
function evLabel(e: StructureEvent): string { return e ? e.replace('_', ' ') : '—'; }
function evVariant(e: StructureEvent): Variant { return !e ? 'muted' : e.includes('BULL') ? 'bullish' : 'bearish'; }

function fvgLabel(f: EnhancedFVGZone): string {
  if (f.inverted) return f.type === 'BULLISH' ? 'iFVG RESIST' : 'iFVG SUPP';
  if (f.explosive) return f.type === 'BULLISH' ? 'EXPL BULL' : 'EXPL BEAR';
  if (f.status === 'HONORED') return f.type === 'BULLISH' ? 'HON BULL' : 'HON BEAR';
  return f.type === 'BULLISH' ? 'ACT BULL' : 'ACT BEAR';
}
function fvgVariant(f: EnhancedFVGZone): Variant {
  if (f.inverted) return f.type === 'BULLISH' ? 'bearish' : 'bullish';
  if (f.explosive) return 'gold';
  if (f.status === 'HONORED') return f.type === 'BULLISH' ? 'bullish' : 'bearish';
  return 'blue';
}

// ─── isMarketOpen ────────────────────────────────────────────────────────────

function isMarketOpen(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const day = parts.find(p => p.type === 'weekday')?.value ?? '';
  const h   = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10);
  const m   = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const t   = h * 60 + m;
  if (day === 'Sat') return false;
  if (day === 'Sun' && t < 18 * 60) return false;
  if (day === 'Fri' && t >= 17 * 60) return false;
  if (t >= 16 * 60 && t < 17 * 60) return false;
  return true;
}

// ─── Section heading ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted border-b border-border/50 pb-1">
        {title}
      </span>
      {children}
    </div>
  );
}

// ─── Prominent Bias Card (stable, rule-locked) ────────────────────────────────

const BIAS_BG: Record<Bias, string> = {
  BULLISH:    'bg-green-950/60 border-green-800/60',
  BEARISH:    'bg-red-950/60 border-red-800/60',
  INDECISIVE: 'bg-neutral-900/60 border-neutral-700/60',
};
const BIAS_TEXT: Record<Bias, string> = {
  BULLISH: 'text-green-400', BEARISH: 'text-red-400', INDECISIVE: 'text-gray-400',
};
const BIAS_ICON: Record<Bias, string> = { BULLISH: '▲', BEARISH: '▼', INDECISIVE: '◈' };
const RULE_LABEL: Record<BiasRule, string> = {
  SWEEP_CHOCH_BULL:  'H4 SSL Sweep + Bullish CHoCH',
  D1_BULL_FVG:       'Holding D1 Bullish FVG',
  H4_BULL_FVG:       'Holding H4 Bullish FVG',
  BEAR_IFVG_SUPPORT: 'Closed Above Bearish iFVG',
  SWEEP_CHOCH_BEAR:  'H4 BSL Sweep + Bearish CHoCH',
  D1_BEAR_FVG:       'Holding D1 Bearish FVG',
  H4_BEAR_FVG:       'Holding H4 Bearish FVG',
  BULL_IFVG_RESIST:  'Closed Below Bullish iFVG',
  CONFLICTING_ZONES: 'Conflicting HTF Zones',
  TIGHT_RANGE:       'No Clear H4 Structure',
};

const FACTOR_LABELS: { key: keyof DailyBiasV2['factors']; label: string }[] = [
  { key: 'honoredGaps',       label: 'Honored FVG'  },
  { key: 'explosiveGaps',     label: 'Explosive FVG' },
  { key: 'iFVGsActive',       label: 'iFVG Active'  },
  { key: 'sessionLiqUnswept', label: 'Session Liq'  },
  { key: 'inducementUnswept', label: 'Inducement'   },
];

const factorActiveCls: Record<Bias, string> = {
  BULLISH:    'bg-green-950 text-green-400 border border-green-800',
  BEARISH:    'bg-red-950 text-red-400 border border-red-800',
  INDECISIVE: 'bg-neutral-800 text-neutral-300 border border-neutral-700',
};
const factorDimCls = 'bg-neutral-900 text-neutral-600 border border-neutral-800';

function BiasCard({ symbol, bias }: { symbol: string; bias: DailyBiasV2 }) {
  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-3 ${BIAS_BG[bias.bias]}`}>
      {/* Symbol + direction */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">{symbol}</span>
        <span className={`text-[10px] font-mono font-bold ${BIAS_TEXT[bias.bias]}`}>
          {BIAS_ICON[bias.bias]} {bias.bias}
        </span>
      </div>
      {/* Rule label — the locked reason */}
      <div>
        <p className={`text-[13px] font-mono font-semibold leading-tight ${BIAS_TEXT[bias.bias]}`}>
          {bias.rule ? RULE_LABEL[bias.rule] : 'No signal'}
        </p>
        {(bias.d1Event || bias.h4Event) && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {bias.d1Event && <Badge label={`D1 ${evLabel(bias.d1Event)}`} variant={evVariant(bias.d1Event)} />}
            {bias.h4Event && <Badge label={`H4 ${evLabel(bias.h4Event)}`} variant={evVariant(bias.h4Event)} />}
          </div>
        )}
      </div>
      {/* Informational factor badges */}
      <div className="flex flex-wrap gap-1">
        {FACTOR_LABELS.map(f => (
          <span
            key={f.key}
            className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-semibold tracking-wide ${bias.factors[f.key] ? factorActiveCls[bias.bias] : factorDimCls}`}
          >
            {f.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── MTF rows ────────────────────────────────────────────────────────────────

function MTFRows({ rows }: { rows: MTFRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col">
      {rows.map(r => (
        <div key={r.tf} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
          <span className="text-[10px] font-mono text-muted uppercase w-9 shrink-0">{r.tf}</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Badge label={r.bias} variant={bv(r.bias)} />
            {r.event && <Badge label={evLabel(r.event)} variant={evVariant(r.event)} />}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── FVG array list ──────────────────────────────────────────────────────────

function FVGList({ fvgs, max = 5 }: { fvgs: EnhancedFVGZone[]; max?: number }) {
  if (!fvgs.length) return <span className="text-[9px] font-mono text-muted/50 italic">No zones</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {fvgs.slice(-max).reverse().map((f, i) => (
        <div key={i} className="flex items-center justify-between py-0.5">
          <Badge label={fvgLabel(f)} variant={fvgVariant(f)} />
          <span className="text-[9px] font-mono text-muted tabular-nums ml-2">
            {f.bottom.toFixed(2)} – {f.top.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Session liquidity ────────────────────────────────────────────────────────

function SessionLiqTable({ levels }: { levels: SessionLiq[] }) {
  if (!levels.length) return <span className="text-[9px] font-mono text-muted/50 italic">No session data</span>;
  return (
    <div className="flex flex-col">
      {levels.map(s => (
        <div key={s.session} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
          <span className="text-[9px] font-mono text-muted uppercase w-14 shrink-0">{s.session}</span>
          <span className={`text-[9px] font-mono tabular-nums ${s.highSwept ? 'text-muted line-through' : 'text-bearish'}`}>
            H {s.high.toFixed(2)}
          </span>
          <span className="text-border text-[9px]">·</span>
          <span className={`text-[9px] font-mono tabular-nums ${s.lowSwept ? 'text-muted line-through' : 'text-bullish'}`}>
            L {s.low.toFixed(2)}
          </span>
          {(s.highSwept || s.lowSwept) && (
            <span className="text-[9px] font-mono text-sweep ml-auto">{s.highSwept ? 'BSL ✓' : 'SSL ✓'}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Inducement levels ────────────────────────────────────────────────────────

function InducementTable({ levels }: { levels: InducementLevel[] }) {
  const unswept = levels.filter(l => !l.swept);
  if (!unswept.length) return <span className="text-[9px] font-mono text-muted/50 italic">All swept</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {unswept.slice(0, 6).map((l, i) => (
        <div key={i} className="flex items-center justify-between py-0.5">
          <span className={`text-[9px] font-mono ${l.side === 'HIGH' ? 'text-bearish' : 'text-bullish'}`}>
            {l.side === 'HIGH' ? '↑ BSL' : '↓ SSL'}
          </span>
          <span className="text-[9px] font-mono text-foreground tabular-nums">{l.price.toFixed(2)}</span>
          <span className="text-[8px] font-mono text-muted">{l.tf}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Technical instrument column ─────────────────────────────────────────────

function TechnicalColumn({
  symbol, bias, factors, mtfRows,
}: {
  symbol: string;
  bias: DailyBiasV2;
  factors: BiasFactors;
  mtfRows: MTFRow[];
}) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto">
      {/* Prominent, stable bias card */}
      <BiasCard symbol={symbol} bias={bias} />

      {mtfRows.length > 0 && (
        <Section title="MTF Structure">
          <MTFRows rows={mtfRows} />
        </Section>
      )}

      {/* NQ proxy — show D1/H4 events when no full mtfMatrix */}
      {mtfRows.length === 0 && (bias.d1Event || bias.h4Event) && (
        <Section title="Structure Events">
          <div className="flex flex-col">
            {([['D1', bias.d1Event], ['H4', bias.h4Event]] as [string, StructureEvent][])
              .filter(([, ev]) => ev)
              .map(([tf, ev]) => (
                <div key={tf} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-[10px] font-mono text-muted uppercase w-9 shrink-0">{tf}</span>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <Badge label={evLabel(ev)} variant={evVariant(ev)} />
                  </div>
                </div>
              ))}
          </div>
        </Section>
      )}

      <Section title="H4 FVG Arrays">
        <FVGList fvgs={factors.h4FVGs} />
      </Section>

      <Section title="H1 FVG Arrays">
        <FVGList fvgs={factors.h1FVGs} />
      </Section>

      <Section title="Session Liquidity">
        <SessionLiqTable levels={factors.sessionLiq} />
      </Section>

      <Section title="Inducement Pool">
        <InducementTable levels={factors.inducement} />
      </Section>
    </div>
  );
}

// ─── SMT / Confluence banner ──────────────────────────────────────────────────

function SMTBanner({ smt, confluence }: { smt: SMTState; confluence: ConfluenceState }) {
  const active = smt.active || confluence.active;
  return (
    <div className={`px-5 py-2 border-b flex items-center gap-3 shrink-0 ${active ? 'bg-sweep/8 border-sweep/30' : 'bg-surface/40 border-border'}`}>
      <span className="text-[9px] font-mono text-muted uppercase tracking-widest">SMT Monitor</span>
      {smt.active && smt.type
        ? <Badge label={smt.type.replace('_', ' ')} variant={smt.type === 'BULLISH_SMT' ? 'bullish' : 'bearish'} />
        : <span className="text-[9px] font-mono text-muted/50">No divergence</span>
      }
      {confluence.active && (
        <span className="text-[10px] font-mono text-sweep font-semibold tracking-wide ml-2">
          ◈ CONFLUENCE {confluence.score}/3
        </span>
      )}
      <div className="ml-auto flex items-center gap-3 text-[9px] font-mono">
        {[
          { label: 'HTF Zone', on: confluence.htfZoneAligned },
          { label: 'Liq Sweep', on: confluence.liquiditySweep },
          { label: 'SMT Div',   on: confluence.smtDivergence  },
        ].map(r => (
          <span key={r.label} className={r.on ? 'text-sweep' : 'text-muted/40'}>
            {r.on ? '✓' : '○'} {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Macro / Fundamental column ───────────────────────────────────────────────

interface EconEvent {
  time: string; event: string; impact: 'HIGH' | 'MED' | 'LOW'; forecast: string; actual: string;
}

// Static demo events — replace with live economic calendar API when available
const ECON_EVENTS: EconEvent[] = [
  { time: 'Mon 10:00', event: 'ISM Services PMI',   impact: 'MED',  forecast: '51.0', actual: '—'   },
  { time: 'Tue 14:00', event: 'FOMC Minutes',        impact: 'HIGH', forecast: '—',    actual: '—'   },
  { time: 'Wed 08:30', event: 'CPI (MoM)',            impact: 'HIGH', forecast: '0.2%', actual: '—'   },
  { time: 'Thu 08:30', event: 'Initial Jobless Claims',impact: 'MED', forecast: '217K', actual: '—'   },
  { time: 'Thu 08:30', event: 'PPI (MoM)',            impact: 'MED',  forecast: '0.1%', actual: '—'   },
  { time: 'Fri 08:30', event: 'Retail Sales (MoM)',   impact: 'HIGH', forecast: '0.3%', actual: '—'   },
];

const impactCls: Record<EconEvent['impact'], string> = {
  HIGH: 'text-bearish',
  MED:  'text-sweep',
  LOW:  'text-muted',
};

function MacroColumn() {
  return (
    <div className="flex flex-col gap-5 px-4 py-4 overflow-y-auto">

      {/* Economic Calendar */}
      <Section title="Economic Calendar">
        <div className="flex flex-col gap-0">
          {ECON_EVENTS.map((ev, i) => (
            <div key={i} className="flex flex-col py-1.5 border-b border-border/30 last:border-0 gap-0.5">
              <div className="flex items-center justify-between">
                <span className={`text-[8px] font-mono font-bold uppercase tracking-wider ${impactCls[ev.impact]}`}>
                  ● {ev.impact}
                </span>
                <span className="text-[8px] font-mono text-muted">{ev.time}</span>
              </div>
              <span className="text-[10px] font-mono text-foreground leading-tight">{ev.event}</span>
              <div className="flex items-center gap-3 text-[8px] font-mono text-muted">
                <span>Fcst: <span className="text-foreground">{ev.forecast}</span></span>
                <span>Actual: <span className={ev.actual !== '—' ? 'text-sweep' : 'text-muted'}>{ev.actual}</span></span>
              </div>
            </div>
          ))}
        </div>
        <span className="text-[8px] font-mono text-muted/40 italic">Demo data — connect live API for real events</span>
      </Section>

      {/* Fed Sentiment */}
      <Section title="Fed Sentiment">
        <div className="rounded border border-border bg-surface/30 p-3 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-mono text-muted uppercase">Target Rate</span>
            <span className="text-[11px] font-mono font-bold text-foreground tabular-nums">5.25 – 5.50%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-mono text-muted uppercase">Stance</span>
            <Badge label="RESTRICTIVE" variant="bearish" />
          </div>
          <div className="h-px bg-border/50 my-0.5" />
          <div className="flex flex-col gap-1">
            {[
              { label: 'Last FOMC',  val: 'May 7, 2026' },
              { label: 'Next FOMC',  val: 'Jun 17–18, 2026' },
            ].map(r => (
              <div key={r.label} className="flex justify-between items-center">
                <span className="text-[9px] font-mono text-muted">{r.label}</span>
                <span className="text-[9px] font-mono text-foreground">{r.val}</span>
              </div>
            ))}
          </div>
          <div className="h-px bg-border/50 my-0.5" />
          {/* CME FedWatch (static) */}
          <span className="text-[8px] font-mono text-muted uppercase tracking-wider">CME FedWatch — Jun Meeting</span>
          {[
            { label: 'Hold (525–550)',  pct: 71, cls: 'bg-muted/40' },
            { label: 'Cut 25bp',        pct: 26, cls: 'bg-bullish/60' },
            { label: 'Hike 25bp',       pct: 3,  cls: 'bg-bearish/60' },
          ].map(r => (
            <div key={r.label} className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[8px] font-mono">
                <span className="text-muted">{r.label}</span>
                <span className="text-foreground tabular-nums">{r.pct}%</span>
              </div>
              <div className="h-1 bg-border/30 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${r.cls}`} style={{ width: `${r.pct}%` }} />
              </div>
            </div>
          ))}
          <span className="text-[8px] font-mono text-muted/40 italic mt-0.5">Static — connect CME FedWatch API for live</span>
        </div>
      </Section>

      {/* Market Context */}
      <Section title="Market Context">
        <div className="flex flex-col gap-1.5 text-[9px] font-mono text-muted leading-relaxed">
          <p>Risk-on regime. Equities pricing in Fed pivot optionality through H2 2026. Watch CPI prints for rate-cut catalysts.</p>
          <p className="text-muted/50 italic">Manual context — update per session.</p>
        </div>
      </Section>

    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AnalyticsView() {
  const {
    esDailyBias, nqDailyBias,
    esBiasFactors, nqBiasFactors,
    mtfMatrix, smt, confluence,
  } = useMarketStream();

  const open = isMarketOpen();

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground">
          Market Analytics
        </span>
        {open ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bullish opacity-70" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-bullish" />
            </span>
            <span className="text-[10px] text-muted font-mono uppercase tracking-widest">LIVE</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-neutral-600 shrink-0" />
            <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest">Market Closed</span>
          </div>
        )}
      </header>

      {/* SMT / Confluence banner */}
      <SMTBanner smt={smt} confluence={confluence} />

      {/* Three-column layout: Macro | ES | NQ */}
      <div className="grid grid-cols-[220px_1fr_1fr] flex-1 min-h-0 overflow-hidden divide-x divide-border">

        {/* Left — Macro / Fundamental */}
        <div className="overflow-y-auto bg-surface/20">
          <div className="px-4 py-2 border-b border-border bg-surface/40 sticky top-0 z-10">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">Macro · Fundamentals</span>
          </div>
          <MacroColumn />
        </div>

        {/* Middle — ES Technical */}
        <div className="overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-border bg-surface/40 shrink-0">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">ES1! · S&P 500 Futures</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TechnicalColumn
              symbol="ES1! · S&P 500"
              bias={esDailyBias}
              factors={esBiasFactors}
              mtfRows={mtfMatrix}
            />
          </div>
        </div>

        {/* Right — NQ Technical */}
        <div className="overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-border bg-surface/40 shrink-0">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">NQ1! · Nasdaq Futures</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TechnicalColumn
              symbol="NQ1! · Nasdaq"
              bias={nqDailyBias}
              factors={nqBiasFactors}
              mtfRows={[]}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
