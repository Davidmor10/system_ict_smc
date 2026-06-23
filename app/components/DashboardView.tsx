'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import { useLivePrices, type LiveQuote } from '../hooks/useLivePrices';
import SmcChart from './SmcChart';
import PositionCalculator from './PositionCalculator';
import { israelClock, getSessionStatus, fmtHMS, type SessionStatus } from '../lib/sessions';
import { useMarketStatus } from '../hooks/useMarketStatus';

type Bi = { he: string; en: string };
const pick = (b: Bi, isEn: boolean) => (isEn ? b.en : b.he);

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ num, title, subtitle, dir }: { num: string; title: string; subtitle: string; dir?: 'rtl' | 'ltr' }) {
  return (
    <div className="flex items-end justify-between mb-[30px] pb-5 border-b border-[#1c1c1e]">
      <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">{num}</span>
      <div className={dir === 'ltr' ? 'text-left' : 'text-right'} dir={dir ?? 'rtl'}>
        <h2 className="font-serif text-[26px] font-bold text-white leading-none">{title}</h2>
        <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/45 mt-2">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Sticky status bar ────────────────────────────────────────────────────────

function StatusBar({
  role, clock, status, isMarketOpen, override, setOverride, isDev, isOwner, nextOpenLabel, en,
}: {
  role: 'free' | 'pro';
  clock: string;
  status: SessionStatus;
  isMarketOpen: boolean;
  override: boolean;
  setOverride: React.Dispatch<React.SetStateAction<boolean>>;
  isDev: boolean;
  isOwner: boolean;
  nextOpenLabel: string;
  en: boolean;
}) {
  const marketOpen = override || isMarketOpen;
  const dir = en ? 'ltr' : 'rtl';

  return (
    <div className="sticky top-0 max-[880px]:top-[54px] z-50 flex items-center justify-between px-10 max-[880px]:px-4 h-[58px] max-[880px]:h-[45px] bg-[rgba(8,8,9,.86)] backdrop-blur-md border-b border-[#1c1c1e] shrink-0">

      {/* Right: role badge / upgrade CTA */}
      <div className={`flex items-center gap-3 max-[880px]:hidden`} dir={dir}>
        {role === 'pro' ? (
          <>
            <span className="px-3 py-1 rounded-sm border border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37] font-mono text-[11px] font-bold tracking-[0.2em] uppercase [box-shadow:0_0_20px_rgba(212,175,55,0.25)]">
              PRO
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#d4af37] animate-pulse" />
            <span className="font-mono text-xs text-white/50 hidden sm:block">
              {pick({ he: 'גישת PRO פעילה', en: 'PRO access active' }, en)}
            </span>
          </>
        ) : (
          <>
            <Link
              href="/checkout"
              className="shrink-0 px-4 py-1.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold [box-shadow:0_0_24px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_40px_rgba(212,175,55,0.6)] transition-shadow duration-500"
            >
              {pick({ he: 'שדרוג ל-PRO ←', en: '→ Upgrade to PRO' }, en)}
            </Link>
            <span className="font-mono text-xs text-white/40 hidden sm:block">
              {pick({ he: 'חשבון חינמי', en: 'Free account' }, en)}
            </span>
          </>
        )}
      </div>

      {/* Left: clock + session countdown + dev override */}
      <div className="flex items-center gap-4">
        {(isDev || isOwner) && (
          <button
            onClick={() => setOverride(o => !o)}
            className={`px-2.5 py-1 rounded-sm border text-xs font-bold font-mono transition-colors duration-300 ${
              override
                ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/10'
                : 'border-[#2a2a2d] text-white/60 hover:text-white'
            }`}
          >
            {pick({ he: 'עקוף סשן', en: 'Override Session' }, en)}
          </button>
        )}

        {marketOpen ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-[20px] font-black text-white tabular-nums [text-shadow:0_0_20px_rgba(212,175,55,0.25)]">
              {clock}
            </span>
            <span className="font-mono text-xs font-bold text-[#d4af37] uppercase tracking-[0.2em]">IDT</span>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-sm border border-[#d4af37]/30 bg-[#d4af37]/5">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status.inSession ? 'bg-[#d4af37] animate-pulse' : 'bg-white/40'}`} />
              <span className="font-mono text-xs font-bold text-white/60 hidden sm:inline">
                {status.inSession
                  ? pick({ he: 'מסתיים בעוד:', en: 'Ends in:' }, en)
                  : pick({ he: 'מתחיל בעוד:', en: 'Starts in:' }, en)}
              </span>
              <span className="font-mono text-xs font-black text-[#d4af37] tabular-nums">{fmtHMS(status.remaining)}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-sm border border-[#d4af37]/30 bg-[#d4af37]/5">
            <span className="h-2 w-2 rounded-full bg-white/40" />
            <span className="font-mono text-sm font-bold text-white/80 uppercase tracking-[0.18em]">
              {pick({ he: 'שוק סגור', en: 'Market Closed' }, en)}
            </span>
            <span className="h-3 w-px bg-[#d4af37]/20" />
            <span className="font-mono text-sm font-black text-[#d4af37] uppercase tracking-[0.14em] tabular-nums">{nextOpenLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Live quote card ──────────────────────────────────────────────────────────

function QuoteCard({ symbol, name, quote }: { symbol: string; name: string; quote: LiveQuote }) {
  const bullish = quote.change >= 0;
  const hasData  = quote.price > 0;
  const hasRange = quote.high > 0 && quote.low > 0 && quote.high > quote.low;
  const rangePos = hasRange
    ? Math.min(100, Math.max(0, ((quote.price - quote.low) / (quote.high - quote.low)) * 100))
    : 50;

  return (
    <div className="bg-[#0d0d0f] border border-[#1c1c1e] rounded-[5px] p-6 lift">
      {/* Symbol row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="font-mono text-[24px] font-bold text-white leading-none">{symbol}</div>
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-white/40 mt-1">{name}</div>
        </div>
        <span className="font-mono text-[10px] text-white/20 tracking-[0.15em] uppercase mt-1">TradingView</span>
      </div>

      {/* Price + change pill */}
      <div className="flex items-end gap-3 mb-5">
        <span className={`font-mono text-[42px] max-[880px]:text-[32px] font-black tabular-nums leading-none transition-colors duration-300 ${
          quote.flash === 'up'   ? 'text-emerald-400' :
          quote.flash === 'down' ? 'text-[#cf8d8d]'   : 'text-white'
        }`}>
          {hasData ? quote.price.toFixed(2) : '—'}
        </span>
        {hasData && (
          <span className={`mb-1 px-2.5 py-1 rounded-sm font-mono text-[12px] font-bold tabular-nums ${
            bullish
              ? 'bg-emerald-950/60 text-emerald-400'
              : 'bg-[rgba(139,58,58,.16)] text-[#cf8d8d]'
          }`}>
            {bullish ? '+' : ''}{quote.change.toFixed(2)} ({bullish ? '+' : ''}{quote.pct.toFixed(2)}%)
          </span>
        )}
      </div>

      {/* Day range bar */}
      {hasRange ? (
        <div>
          <div className="flex justify-between font-mono text-[10px] text-white/35 mb-2">
            <span>L {quote.low.toFixed(2)}</span>
            <span>H {quote.high.toFixed(2)}</span>
          </div>
          <div className="relative h-px bg-[#1c1c1e]">
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-[#d4af37] [box-shadow:0_0_8px_rgba(212,175,55,0.6)] transition-all duration-500"
              style={{ left: `clamp(0%, ${rangePos}%, 100%)` }}
            />
          </div>
        </div>
      ) : (
        <div className="h-px bg-[#1c1c1e] opacity-40" />
      )}
    </div>
  );
}

// ─── Timeframe selector constants ────────────────────────────────────────────

const TF_BUTTONS = [
  { label: '1m',  tv: '1'   },
  { label: '2m',  tv: '2'   },
  { label: '3m',  tv: '3'   },
  { label: '5m',  tv: '5'   },
  { label: '15m', tv: '15'  },
  { label: '1H',  tv: '60'  },
  { label: '4H',  tv: '240' },
  { label: '1D',  tv: 'D'   },
] as const;

export const TF_LABEL: Record<string, string> = {
  '1':   '1-Minute',
  '2':   '2-Minute',
  '3':   '3-Minute',
  '5':   '5-Minute',
  '15':  '15-Minute',
  '60':  '1-Hour',
  '240': '4-Hour',
  'D':   'Daily',
};

// ─── Chart panel ─────────────────────────────────────────────────────────────

function ChartPanel({
  symbol, name, interval, onIntervalChange,
}: {
  symbol: 'ES' | 'NQ';
  name: string;
  interval: string;
  onIntervalChange: (tv: string) => void;
}) {
  return (
    <div className="bg-black border border-[#1c1c1e] rounded-[5px] overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-[18px] py-[11px] border-b border-[#1c1c1e] bg-[#0d0d0f]">
        {/* Symbol + name */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[14px] font-bold text-white">{symbol}1!</span>
          <span className="font-mono text-[10px] text-white/40 tracking-[0.15em] uppercase">{name}</span>
        </div>
        {/* Segmented TF control */}
        <div
          className="flex items-stretch rounded-[4px] border max-[880px]:max-w-[200px] max-[880px]:overflow-x-auto"
          style={{
            borderColor: 'rgba(255,255,255,.1)',
            background: '#000',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
          } as React.CSSProperties}
        >
          {TF_BUTTONS.map(({ label, tv }) => {
            const active = tv === interval;
            return (
              <button
                key={tv}
                onClick={() => onIntervalChange(tv)}
                className={[
                  'font-mono text-[10px] font-semibold px-[7px] py-[5px] leading-none shrink-0',
                  'transition-[color,background,box-shadow] duration-150 cursor-pointer border-none',
                  active
                    ? 'text-[#d4af37]'
                    : 'text-white/[.38] hover:text-white/85 hover:bg-white/[.06]',
                ].join(' ')}
                style={active ? {
                  background:  'rgba(212,175,55,.12)',
                  boxShadow:   'inset 0 0 0 1px rgba(212,175,55,.4)',
                  letterSpacing: '.06em',
                } : { letterSpacing: '.06em' }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Chart body */}
      <div className="h-[440px] max-[880px]:h-[300px]">
        <SmcChart symbol={symbol} interval={interval} />
      </div>
    </div>
  );
}

// ─── Session gate (spans 2 columns) ──────────────────────────────────────────

function SessionGate({ en }: { en: boolean }) {
  return (
    <div className="col-span-2 max-[880px]:col-span-1 flex items-center justify-center p-16 max-[880px]:p-8 bg-[#000000] border border-[#1c1c1e] rounded-[5px]">
      <div className="max-w-lg text-center rounded-xl border border-[#d4af37]/50 bg-[#0d0d0f] p-10 [box-shadow:0_0_60px_-15px_rgba(212,175,55,0.4)]" dir={en ? 'ltr' : 'rtl'}>
        <span className="text-[#d4af37] text-4xl">◈</span>
        <p className="mt-5 text-xl font-bold text-white leading-relaxed tracking-wide">
          {pick({ he: 'אין סשן מסחר פעיל כרגע — הגרפים יתעדכנו עם תחילת הסשן הבא.', en: 'No active trading session right now — charts will update at the start of the next session.' }, en)}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardView({
  role = 'free',
  macroBoard,
}: {
  role?: 'free' | 'pro';
  macroBoard?: React.ReactNode;
}) {
  const live = useLivePrices();
  const { isMarketOpen, nextOpenLabel } = useMarketStatus();
  const { user } = useUser();
  const { lang } = useLanguage();
  const en = lang === 'en';
  const dir = en ? 'ltr' : 'rtl';

  const [clock, setClock] = useState(() => israelClock());
  const [override, setOverride] = useState(false);

  const [esInterval, setEsInterval] = useState<string>(() => {
    if (typeof window === 'undefined') return '5';
    return localStorage.getItem('onyx_chart_tf_ES') ?? '5';
  });
  const [nqInterval, setNqInterval] = useState<string>(() => {
    if (typeof window === 'undefined') return '5';
    return localStorage.getItem('onyx_chart_tf_NQ') ?? '5';
  });
  const handleEsInterval = (tv: string) => {
    setEsInterval(tv);
    try { localStorage.setItem('onyx_chart_tf_ES', tv); } catch {}
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart_tf_es: tv }),
    }).catch(() => {});
  };
  const handleNqInterval = (tv: string) => {
    setNqInterval(tv);
    try { localStorage.setItem('onyx_chart_tf_NQ', tv); } catch {}
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart_tf_nq: tv }),
    }).catch(() => {});
  };

  useEffect(() => {
    // Load chart TF preferences from cloud on mount
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then((data: { prefs: { chart_tf_es?: string; chart_tf_nq?: string } | null } | null) => {
        const p = data?.prefs;
        if (!p) return;
        if (p.chart_tf_es) {
          setEsInterval(p.chart_tf_es);
          try { localStorage.setItem('onyx_chart_tf_ES', p.chart_tf_es); } catch {}
        }
        if (p.chart_tf_nq) {
          setNqInterval(p.chart_tf_nq);
          try { localStorage.setItem('onyx_chart_tf_NQ', p.chart_tf_nq); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(israelClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const status    = getSessionStatus(clock.sec);
  const visible   = override || (isMarketOpen && status.inSession);
  const isDev     = process.env.NODE_ENV !== 'production';
  const isOwner   = user?.primaryEmailAddress?.emailAddress?.toLowerCase() === 'davidmor030908@gmail.com';

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#000000] text-[#c0c0c0]" dir={dir}>

      {/* Sticky status bar */}
      <StatusBar
        role={role}
        clock={clock.clock}
        status={status}
        isMarketOpen={isMarketOpen}
        override={override}
        setOverride={setOverride}
        isDev={isDev}
        isOwner={isOwner}
        nextOpenLabel={nextOpenLabel}
        en={en}
      />

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-10 max-[880px]:px-4 pb-20">

          {/* ── 01 · Live Quotes ─────────────────────────────── */}
          <div className="py-12 border-b border-[#1c1c1e]">
            <SectionHeader num="01"
              title={pick({ he: 'סקירת שוק', en: 'Market Overview' }, en)}
              subtitle="Live Quotes · ES & NQ Futures"
              dir={dir} />
            <div className="grid grid-cols-2 max-[880px]:grid-cols-1 gap-[18px]">
              <QuoteCard symbol="ES1!" name="S&P 500 Futures · CME" quote={live.es} />
              <QuoteCard symbol="NQ1!" name="Nasdaq 100 Futures · CME" quote={live.nq} />
            </div>
          </div>

          {/* ── 02 · Live Charts ─────────────────────────────── */}
          <div className="py-12 border-b border-[#1c1c1e]">
            <SectionHeader num="02"
              title={pick({ he: 'גרפים חיים', en: 'Live Charts' }, en)}
              subtitle={`Monochrome · ${TF_LABEL[esInterval] ?? '5-Minute'} Candles`}
              dir={dir} />
            <div className="grid grid-cols-2 max-[880px]:grid-cols-1 gap-[18px]">
              {visible ? (
                <>
                  <ChartPanel symbol="ES" name="S&P 500"    interval={esInterval} onIntervalChange={handleEsInterval} />
                  <ChartPanel symbol="NQ" name="Nasdaq 100" interval={nqInterval} onIntervalChange={handleNqInterval} />
                </>
              ) : (
                <SessionGate en={en} />
              )}
            </div>
            <p
              className="mt-[18px] font-mono text-[11px] font-semibold text-white/35 leading-relaxed tracking-[0.1em]"
              dir={dir}
              style={{ textAlign: en ? 'left' : 'right' }}
            >
              {pick({
                he: '◈ הגרפים המוצגים כאן הם גרפי המדדים הכלליים (S&P 500 ו-Nasdaq 100) — ולא גרפי החוזים העתידיים (ES1! / NQ1!) שנסחרים ב-CME. ניתן להשתמש בהם כאינדיקציה כללית ולראייה רחבה של שוק המדדים בלבד, ולא כתחליף לגרפי החוזים לצורך קבלת החלטות מסחר.',
                en: '◈ The charts shown here are general index charts (S&P 500 & Nasdaq 100) — not the futures contracts (ES1! / NQ1!) traded on CME. Use them as a general indication and broad view of the index market only, not as a substitute for futures charts when making trading decisions.',
              }, en)}
            </p>
          </div>

          {/* ── 03 · Macro Journal ───────────────────────────── */}
          <div className="py-12 border-b border-[#1c1c1e]">
            <SectionHeader num="03"
              title={pick({ he: 'יומן מאקרו', en: 'Macro Journal' }, en)}
              subtitle="ForexFactory · USD High Impact · This Week"
              dir={dir} />
            {macroBoard}
          </div>

          {/* ── 04 · Position Calculator ─────────────────────── */}
          <div className="py-12">
            <SectionHeader num="04"
              title={pick({ he: 'מחשבון פוזיציה', en: 'Position Calculator' }, en)}
              subtitle="CME Spec · ES & NQ Risk Engine"
              dir={dir} />
            <PositionCalculator live={live} />
          </div>

        </div>
      </div>
    </div>
  );
}
