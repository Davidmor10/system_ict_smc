'use client';

import { useLivePrices } from '../hooks/useLivePrices';
import SmcChart from './SmcChart';
import PositionCalculator from './PositionCalculator';
import { useLanguage } from '../hooks/useLanguage';
import type { DictKey } from '../lib/i18n';

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

function todayET(): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date());
}

// ─── Instrument price block ─────────────────────────────────────────────────

function PriceBlock({ symbol, price, change, pct, flash }: {
  symbol: string; price: number; change: number; pct: number;
  flash?: 'up' | 'down' | null;
}) {
  const bull = change >= 0;
  return (
    <div>
      <span className="text-[11px] font-bold font-mono text-white/70 uppercase tracking-[0.22em] block leading-none mb-2">
        {symbol}
      </span>
      <div className="flex items-baseline gap-3">
        <span className={`text-2xl font-bold font-mono text-white tabular-nums tracking-tight ${flash === 'up' ? 'price-flash-up' : flash === 'down' ? 'price-flash-down' : ''}`}>
          {price > 0 ? price.toFixed(2) : '—'}
        </span>
        <span className={`text-sm font-bold font-mono tabular-nums ${bull ? 'text-bullish' : 'text-bearish'}`}>
          {price > 0 ? `${bull ? '+' : ''}${change.toFixed(2)} (${bull ? '+' : ''}${pct.toFixed(2)}%)` : ''}
        </span>
      </div>
    </div>
  );
}

// ─── Chart panel wrapper ────────────────────────────────────────────────────

function ChartPanel({ label, className = '', children }: {
  label: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col min-w-0 min-h-0 ${className}`}>
      <div className="px-5 py-3 border-b border-[#1c1c1e] bg-[#0d0d0f] shrink-0 flex items-center">
        <span className="font-serif text-[14px] font-bold tracking-[0.08em] text-white uppercase">{label}</span>
      </div>
      <div className="flex-1 min-h-0 bg-[#000000]">{children}</div>
    </div>
  );
}

// ─── Macro news sidebar (Today's News + Weekly Outlook) ─────────────────────

const ECO_EVENTS: { impact: 'HIGH' | 'MED'; day: string; time: string; nameKey: DictKey; fcst: string | null }[] = [
  { impact: 'MED',  day: 'Mon', time: '10:00', nameKey: 'ev_ism',      fcst: '51.0' },
  { impact: 'HIGH', day: 'Tue', time: '14:00', nameKey: 'ev_fomc_min', fcst: null   },
  { impact: 'HIGH', day: 'Wed', time: '08:30', nameKey: 'ev_cpi',      fcst: '0.2%' },
  { impact: 'MED',  day: 'Thu', time: '08:30', nameKey: 'ev_claims',   fcst: '217K' },
  { impact: 'MED',  day: 'Thu', time: '08:30', nameKey: 'ev_ppi',      fcst: '0.1%' },
  { impact: 'HIGH', day: 'Fri', time: '08:30', nameKey: 'ev_retail',   fcst: '0.3%' },
];

function MacroSidebar() {
  const { t, lang } = useLanguage();
  const rtl   = lang === 'he';
  const align = rtl ? 'text-right' : '';
  const today = todayET();
  const todays = ECO_EVENTS.filter(e => e.day === today);

  const EventRow = (e: typeof ECO_EVENTS[number], key: string, showDay: boolean) => (
    <div key={key} className="flex items-start gap-3 py-3 border-b border-[#1c1c1e] last:border-0">
      <span className={`mt-[7px] h-2 w-2 rounded-full shrink-0 ${e.impact === 'HIGH' ? 'bg-bearish' : 'bg-[#d4af37]'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {showDay && <span className="text-xs font-bold font-mono text-white/70 uppercase tracking-wider">{e.day}</span>}
          <span className="text-sm font-bold font-mono text-[#d4af37] tabular-nums">{e.time}</span>
          {e.impact === 'HIGH' && (
            <span className="text-[10px] font-bold font-mono text-bearish uppercase tracking-[0.18em] ms-auto">High</span>
          )}
        </div>
        <span className={`text-base font-bold font-mono text-white block leading-snug ${align}`}>{t(e.nameKey)}</span>
        {e.fcst && <span className="text-sm font-bold font-mono text-white/60 block mt-1">{t('fcst')} {e.fcst}</span>}
      </div>
    </div>
  );

  return (
    <aside className="w-72 shrink-0 border-r border-[#1c1c1e] bg-[#0d0d0f] flex flex-col overflow-y-auto">
      <div className={`px-5 py-4 border-b border-[#1c1c1e] shrink-0 ${align}`}>
        <span className="font-serif text-base font-bold tracking-[0.1em] text-white uppercase">{t('macro')}</span>
      </div>

      <div className="flex flex-col gap-8 px-5 py-6" dir={rtl ? 'rtl' : 'ltr'}>

        {/* Today's News */}
        <section>
          <span className={`text-sm font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em] block mb-4 ${align}`}>{t('today_news')}</span>
          {todays.length > 0
            ? <div className="flex flex-col">{todays.map((e, i) => EventRow(e, `t-${i}`, false))}</div>
            : <span className={`text-sm font-semibold font-mono text-white/50 tracking-wide block ${align}`}>{t('eco_none')}</span>}
        </section>

        {/* Weekly Outlook */}
        <section>
          <span className={`text-sm font-bold font-mono text-white uppercase tracking-[0.18em] block mb-4 ${align}`}>{t('weekly_outlook')}</span>
          <div className="flex flex-col">{ECO_EVENTS.map((e, i) => EventRow(e, `w-${i}`, true))}</div>
          <span className={`text-[10px] font-medium font-mono text-white/30 tracking-wider mt-4 block ${align}`}>{t('demo_note')}</span>
        </section>

      </div>
    </aside>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardView() {
  const live = useLivePrices();
  const { t } = useLanguage();

  return (
    <div className="flex flex-col h-full bg-[#000000] text-[#c0c0c0] overflow-hidden">

      {/* Minimal price-ticker header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div className="flex items-center gap-6">
          <PriceBlock symbol={t('es_label')} price={live.es.price} change={live.es.change} pct={live.es.pct} flash={live.es.flash} />
          <div className="h-8 w-px bg-[#1c1c1e]" />
          <PriceBlock symbol={t('nq_label')} price={live.nq.price} change={live.nq.change} pct={live.nq.pct} flash={live.nq.flash} />
        </div>
        {isMarketOpen() ? (
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="h-2.5 w-2.5 rounded-full bg-[#d4af37] shrink-0" />
            <span className="text-lg font-bold text-[#d4af37] font-mono uppercase tracking-[0.2em]">{t('market_live')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="h-2.5 w-2.5 rounded-full bg-white/40 shrink-0" />
            <span className="text-lg font-bold text-white/55 font-mono uppercase tracking-[0.2em]">{t('market_closed')}</span>
          </div>
        )}
      </header>

      {/* Scroll region: charts fill the first screen, calculator below the fold */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Macro sidebar + expansive 50/50 chart grid (full viewport height) */}
        <div className="flex h-full min-h-0">
          <MacroSidebar />
          <div className="grid grid-cols-2 flex-1 min-w-0 min-h-0">
            <ChartPanel label={t('panel_es')} className="border-r border-[#1c1c1e]">
              <SmcChart symbol="ES" interval="5" />
            </ChartPanel>
            <ChartPanel label={t('panel_nq')}>
              <SmcChart symbol="NQ" interval="5" />
            </ChartPanel>
          </div>
        </div>

        <PositionCalculator live={live} />
      </div>
    </div>
  );
}
