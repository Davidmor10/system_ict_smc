'use client';

import { useMarketStream } from '../hooks/useMarketStream';
import { useLivePrices } from '../hooks/useLivePrices';
import type {
  Bias, StructureEvent, ZoneState, TrendState, SweepState,
  SMTState, ConfluenceState, MTFRow, OrderBlock, FVGZone, DailyBiasV2, BiasRule,
} from '../hooks/useMarketStream';
import SmcChart from './SmcChart';
import { useLanguage } from '../hooks/useLanguage';
import type { DictKey } from '../lib/i18n';

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

const RULE_KEY: Record<BiasRule, DictKey> = {
  SWEEP_CHOCH_BULL:  'rule_sweep_bull',
  D1_BULL_FVG:       'rule_d1_bull_fvg',
  H4_BULL_FVG:       'rule_h4_bull_fvg',
  BEAR_IFVG_SUPPORT: 'rule_bear_ifvg',
  SWEEP_CHOCH_BEAR:  'rule_sweep_bear',
  D1_BEAR_FVG:       'rule_d1_bear_fvg',
  H4_BEAR_FVG:       'rule_h4_bear_fvg',
  BULL_IFVG_RESIST:  'rule_bull_ifvg',
  CONFLICTING_ZONES: 'rule_conflict',
  TIGHT_RANGE:       'rule_tight',
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

const FACTOR_KEYS: { key: keyof DailyBiasV2['factors']; labelKey: DictKey }[] = [
  { key: 'honoredGaps',       labelKey: 'factor_honored'     },
  { key: 'explosiveGaps',     labelKey: 'factor_explosive'   },
  { key: 'iFVGsActive',       labelKey: 'factor_ifvgs'       },
  { key: 'sessionLiqUnswept', labelKey: 'factor_session_liq' },
  { key: 'inducementUnswept', labelKey: 'factor_inducement'  },
];

function BiasPanel({ symbol, bias }: { symbol: string; bias: DailyBiasV2 }) {
  const { t, lang } = useLanguage();
  const rtl = lang === 'he';
  return (
    <div className="flex flex-col gap-1.5 px-5 py-3" dir={rtl ? 'rtl' : 'ltr'}>
      {/* Row 1 — title · status · rule */}
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] shrink-0">{symbol}</span>
        <span className={`text-[11px] font-mono font-semibold tracking-widest ${biasColor[bias.bias]}`}>
          {bias.bias === 'BULLISH' ? '▲' : bias.bias === 'BEARISH' ? '▼' : '◈'} {bias.bias}
        </span>
        <span className="text-[9px] font-mono text-muted/70 truncate max-w-[150px] tracking-wide">
          {bias.rule ? t(RULE_KEY[bias.rule]) : '—'}
        </span>
      </div>
      {/* Row 2 — factor badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FACTOR_KEYS.map(f => (
          <span
            key={f.key}
            className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-medium tracking-wide transition-all duration-700 ease-in-out ${bias.factors[f.key] ? activeCls[bias.bias] : dimCls}`}
          >
            {t(f.labelKey)}
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
  const { t, lang } = useLanguage();
  return (
    <div>
      <span className={`text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-3 ${lang === 'he' ? 'text-right' : ''}`}>{t('mtf_struct')}</span>
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
  const { t, lang } = useLanguage();
  const rtl = lang === 'he';
  return (
    <div dir={rtl ? 'rtl' : 'ltr'}>
      <span className={`text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-3 ${rtl ? 'text-right' : ''}`}>{t('smc_arrays')}</span>
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider">{t('htf_ob')}</span>
          {ob
            ? <div className="flex items-center gap-1.5">
                <Badge label={ob.type === 'BULLISH' ? 'BULL OB' : 'BEAR OB'} variant={ob.type === 'BULLISH' ? 'bullish' : 'bearish'} />
                <span className="text-[9px] font-mono text-muted/60 tabular-nums">{ob.low.toFixed(1)}–{ob.high.toFixed(1)}</span>
              </div>
            : <Badge label="NONE" variant="muted" />}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider">{t('htf_fvg')}</span>
          {htfFVG
            ? <div className="flex items-center gap-1.5">
                <Badge label={htfFVG.type === 'BULLISH' ? 'BULL FVG' : 'BEAR FVG'} variant={htfFVG.type === 'BULLISH' ? 'bullish' : 'bearish'} />
                <span className="text-[9px] font-mono text-gold tabular-nums">{Math.round(htfFVG.fillPct)}%</span>
              </div>
            : <Badge label="NONE" variant="muted" />}
        </div>
        <div className={`flex justify-between items-center rounded px-2 py-1 transition-all duration-700 ease-in-out ${ltfFVGs.length > 0 ? 'bg-gold/5 border border-gold/15' : ''}`}>
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-wider">{t('ltf_fvgs')}</span>
          <span className={`text-[11px] font-mono tabular-nums ${ltfFVGs.length > 0 ? 'text-gold' : 'text-muted/50'}`}>{ltfFVGs.length} {t('active_word')}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Gravity bar ─────────────────────────────────────────────────────────────

function GravityBar({ score, zone }: { score: number; zone: ZoneState }) {
  const { t } = useLanguage();
  const bar = zone === 'PREMIUM' ? 'bg-bearish' : zone === 'DISCOUNT' ? 'bg-bullish' : 'bg-muted/40';
  const tx  = score > 55 ? (zone === 'PREMIUM' ? 'text-bearish' : zone === 'DISCOUNT' ? 'text-bullish' : 'text-muted') : 'text-muted/60';
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em]">{t('gravity')}</span>
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
  const { t, lang } = useLanguage();
  const rtl = lang === 'he';
  const ROWS: { labelKey: DictKey; active: boolean }[] = [
    { labelKey: 'htf_zone', active: state.htfZoneAligned },
    { labelKey: 'liq_sweep', active: state.liquiditySweep },
    { labelKey: 'smt_div',   active: state.smtDivergence  },
  ];
  return (
    <div className={`rounded border p-4 transition-all duration-700 ease-in-out ${state.active ? 'border-gold/30 bg-gold/5' : 'border-[#1c1c1e] bg-transparent'}`} dir={rtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em]">{t('confluence')}</span>
        <span className={`text-[10px] font-mono ${state.score === 3 ? 'text-gold' : state.score === 2 ? 'text-gold/60' : 'text-muted/50'}`}>{state.score}/3</span>
      </div>
      {state.active && (
        <div className="text-[9px] font-mono text-gold tracking-[0.15em] mb-3">{t('inst_signal')}</div>
      )}
      {ROWS.map(r => (
        <div key={r.labelKey} className="flex items-center gap-2 mb-1">
          <span className={`text-[9px] transition-all duration-700 ease-in-out ${r.active ? 'text-gold' : 'text-[#1c1c1e]'}`}>{r.active ? '✓' : '○'}</span>
          <span className={`text-[9px] font-mono tracking-wider transition-all duration-700 ease-in-out ${r.active ? 'text-foreground' : 'text-muted/50'}`}>{t(r.labelKey)}</span>
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

// ─── Macro sidebar ──────────────────────────────────────────────────────────

const ECO_EVENTS: { impact: 'HIGH' | 'MED'; day: string; time: string; nameKey: DictKey; fcst: string | null; actual: string | null }[] = [
  { impact: 'MED',  day: 'Mon', time: '10:00', nameKey: 'ev_ism',      fcst: '51.0',  actual: null },
  { impact: 'HIGH', day: 'Tue', time: '14:00', nameKey: 'ev_fomc_min', fcst: null,    actual: null },
  { impact: 'HIGH', day: 'Wed', time: '08:30', nameKey: 'ev_cpi',      fcst: '0.2%',  actual: null },
  { impact: 'MED',  day: 'Thu', time: '08:30', nameKey: 'ev_claims',   fcst: '217K',  actual: null },
  { impact: 'MED',  day: 'Thu', time: '08:30', nameKey: 'ev_ppi',      fcst: '0.1%',  actual: null },
  { impact: 'HIGH', day: 'Fri', time: '08:30', nameKey: 'ev_retail',   fcst: '0.3%',  actual: null },
];

const FEDWATCH: { labelKey: DictKey; pct: number }[] = [
  { labelKey: 'fed_hold', pct: 71 },
  { labelKey: 'fed_cut',  pct: 26 },
  { labelKey: 'fed_hike', pct:  3 },
];

function MacroSidebar() {
  const { t, lang } = useLanguage();
  const rtl = lang === 'he';
  const align = rtl ? 'text-right' : '';

  const FED_ROWS: [DictKey, string][] = [
    ['fed_rate',   '5.25 – 5.50%'],
    ['fed_stance', 'RESTRICTIVE'  ],
    ['fed_last',   'May 7, 2026'  ],
    ['fed_next',   'Jun 17–18'    ],
  ];

  return (
    <aside className="w-52 shrink-0 border-r border-[#1c1c1e] bg-[#0d0d0f] flex flex-col overflow-y-auto">
      <div className={`px-5 py-3 border-b border-[#1c1c1e] shrink-0 ${align}`}>
        <span className="font-serif text-[11px] tracking-[0.1em] text-[#c0c0c0]/70 uppercase">{t('macro')}</span>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4" dir={rtl ? 'rtl' : 'ltr'}>

        {/* Economic calendar */}
        <div>
          <span className={`text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-3 ${align}`}>{t('eco_calendar')}</span>
          <div className="flex flex-col">
            {ECO_EVENTS.map((e, i) => (
              <div key={i} className="flex items-start gap-2 py-2 border-b border-[#1c1c1e] last:border-0">
                <span className={`mt-[5px] h-1.5 w-1.5 rounded-full shrink-0 ${e.impact === 'HIGH' ? 'bg-bearish' : 'bg-gold/50'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[8px] font-mono text-muted/50 uppercase tracking-wider">{e.day}</span>
                    <span className="text-[8px] font-mono text-muted/35">{e.time}</span>
                  </div>
                  <span className={`text-[9px] font-mono text-foreground/65 block leading-tight tracking-wide ${align}`}>{t(e.nameKey)}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {e.fcst && <span className="text-[8px] font-mono text-muted/45">{t('fcst')} {e.fcst}</span>}
                    {e.actual !== null
                      ? <span className="text-[8px] font-mono text-gold">{e.actual}</span>
                      : <span className="text-[8px] font-mono text-muted/25">—</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <span className={`text-[7px] font-mono text-muted/25 tracking-wider mt-2 block ${align}`}>{t('demo_note')}</span>
        </div>

        <Rule />

        {/* Fed sentiment */}
        <div>
          <span className={`text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-3 ${align}`}>{t('fed_sentiment')}</span>
          <div className="flex flex-col gap-2 mb-4">
            {FED_ROWS.map(([key, val]) => (
              <div key={key} className="flex justify-between items-start gap-1">
                <span className="text-[8px] font-mono text-muted/45 uppercase tracking-wider shrink-0">{t(key)}</span>
                <span className="text-[9px] font-mono text-foreground/55 text-right leading-tight">{val}</span>
              </div>
            ))}
          </div>
          <span className={`text-[8px] font-mono text-muted/35 uppercase tracking-wider block mb-2 ${align}`}>{t('fed_watch')}</span>
          <div className="flex flex-col gap-2">
            {FEDWATCH.map(w => (
              <div key={w.labelKey}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[8px] font-mono text-muted/45">{t(w.labelKey)}</span>
                  <span className="text-[9px] font-mono text-foreground/55 tabular-nums">{w.pct}%</span>
                </div>
                <div className="h-px bg-[#1c1c1e] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${w.pct >= 50 ? 'bg-gold/45' : w.pct >= 20 ? 'bg-muted/35' : 'bg-muted/15'}`}
                    style={{ width: `${w.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <span className={`text-[7px] font-mono text-muted/25 tracking-wider mt-2 block ${align}`}>{t('fed_static_note')}</span>
        </div>

        <Rule />

        {/* Market context */}
        <div>
          <span className={`text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-2 ${align}`}>{t('mkt_context')}</span>
          <p className={`text-[9px] font-mono text-muted/45 leading-relaxed tracking-wide ${align}`}>{t('mkt_context_body')}</p>
          <span className={`text-[7px] font-mono text-muted/25 tracking-wider mt-2 block ${align}`}>{t('mkt_manual_note')}</span>
        </div>

      </div>
    </aside>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardView() {
  const {
    esDailyBias, nqDailyBias,
    mtfMatrix,
    htfOB, htfFVG, ltfFVGs,
    orderFlow, smt, confluence,
  } = useMarketStream();

  const live = useLivePrices();
  const { t, lang } = useLanguage();
  const rtl = lang === 'he';
  const align = rtl ? 'text-right' : '';

  const PRICE_LEVELS: { labelKey: DictKey; val: number; cls: string }[] = [
    { labelKey: 'range_h', val: orderFlow.rangeHigh,   cls: 'text-bearish' },
    { labelKey: 'equil',   val: orderFlow.equilibrium, cls: 'text-gold'    },
    { labelKey: 'range_l', val: orderFlow.rangeLow,    cls: 'text-bullish' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#050505] text-[#c0c0c0] overflow-hidden">

      <DualBiasStrip es={esDailyBias} nq={nqDailyBias} />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div className="flex items-center gap-6">
          <PriceBlock symbol={t('es_label')} price={live.es.price} change={live.es.change} pct={live.es.pct} flash={live.es.flash} />
          <div className="h-8 w-px bg-[#1c1c1e]" />
          <PriceBlock symbol={t('nq_label')} price={live.nq.price} change={live.nq.change} pct={live.nq.pct} flash={live.nq.flash} />
          <div className="hidden xl:flex items-center gap-2 ml-2">
            <Badge label={orderFlow.zone}  variant={zv(orderFlow.zone)} />
            <Badge label={orderFlow.trend} variant={tv(orderFlow.trend)} />
            {orderFlow.sweep && <Badge label={orderFlow.sweep} variant={sv(orderFlow.sweep)} />}
            {smt.active && smt.type && <Badge label={smt.type.replace('_', ' ')} variant={smv(smt)} />}
          </div>
        </div>
        {isMarketOpen() ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-gold shrink-0" />
            <span className="text-[9px] text-gold font-mono uppercase tracking-[0.25em]">{t('market_live')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-muted/40 shrink-0" />
            <span className="text-[9px] text-muted/50 font-mono uppercase tracking-[0.25em]">{t('market_closed')}</span>
          </div>
        )}
      </header>

      {/* Chart area */}
      <div className="flex flex-1 min-h-0">

        <MacroSidebar />

        <ChartPanel label={t('panel_es')}>
          <SmcChart symbol="ES" interval="5" />
        </ChartPanel>

        <div className="w-px bg-[#1c1c1e] shrink-0" />

        <ChartPanel label={t('panel_nq')}>
          <SmcChart symbol="NQ" interval="5" />
        </ChartPanel>

        {/* Analytics sidebar */}
        <aside className="w-56 shrink-0 border-l border-[#1c1c1e] bg-[#0d0d0f] flex flex-col overflow-y-auto">
          <div className={`px-5 py-3 border-b border-[#1c1c1e] shrink-0 ${align}`}>
            <span className="font-serif text-[11px] tracking-[0.1em] text-[#c0c0c0]/70 uppercase">{t('analytics')}</span>
          </div>

          <div className="flex flex-col gap-5 px-5 py-5" dir={rtl ? 'rtl' : 'ltr'}>

            <GravityBar score={orderFlow.gravityScore} zone={orderFlow.zone} />

            {/* Liquidity Magnet */}
            <div>
              <span className={`text-[9px] font-mono text-muted/60 uppercase tracking-[0.22em] block mb-2 ${align}`}>{t('liq_magnet')}</span>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-mono text-gold tabular-nums">{orderFlow.liquidityMagnet.toFixed(2)}</span>
                <span className="text-[9px] font-mono text-muted/50">{t(orderFlow.zone === 'PREMIUM' ? 'draw_down' : 'draw_up')}</span>
              </div>
            </div>

            {/* Price levels */}
            <div className="flex flex-col gap-2">
              {PRICE_LEVELS.map(r => (
                <div key={r.labelKey} className="flex justify-between items-center">
                  <span className="text-[9px] font-mono text-muted/60 uppercase tracking-wider">{t(r.labelKey)}</span>
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
