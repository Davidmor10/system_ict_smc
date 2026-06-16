'use client';

import { useEffect, useState } from 'react';
import { useLivePrices } from '../hooks/useLivePrices';
import SmcChart from './SmcChart';
import TickerWidget from './TickerWidget';
import PositionCalculator from './PositionCalculator';
import { israelClock, getSessionStatus, fmtHMS, type SessionStatus } from '../lib/sessions';
import { useMarketStatus } from '../hooks/useMarketStatus';

// ─── Market-closed fallback (weekend) — mirrors ClockHUD's design tokens ─────

function MarketClosedHUD({ nextOpenLabel }: { nextOpenLabel: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-sm border border-[#d4af37]/30 bg-[#d4af37]/5 shrink-0">
      <span className="h-2 w-2 rounded-full bg-white/40" />
      <span className="text-sm font-bold font-mono text-white/80 uppercase tracking-[0.18em]">Market Closed</span>
      <span className="h-3 w-px bg-[#d4af37]/20" />
      <span className="text-sm font-black font-mono text-[#d4af37] uppercase tracking-[0.14em] tabular-nums">{nextOpenLabel}</span>
    </div>
  );
}

// ─── Institutional clock + session countdown HUD ────────────────────────────

function ClockHUD({ clock, status }: { clock: string; status: SessionStatus }) {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0" dir="rtl">
      {/* Clock — hidden on smallest screens to save space */}
      <div className="hidden sm:flex items-center gap-2">
        <span className="text-xl font-black font-mono text-white tabular-nums tracking-tight [text-shadow:0_0_20px_rgba(212,175,55,0.25)]">
          {clock}
        </span>
        <span className="text-xs font-bold font-mono text-[#d4af37] uppercase tracking-[0.2em]">IDT</span>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-sm border border-[#d4af37]/30 bg-[#d4af37]/5">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status.inSession ? 'bg-[#d4af37] animate-pulse' : 'bg-white/40'}`} />
        <span className="text-xs font-bold font-mono text-white/80 hidden sm:inline">
          {status.inSession ? 'מסתיים בעוד:' : 'מתחיל בעוד:'}
        </span>
        <span className="text-xs font-black font-mono text-[#d4af37] tabular-nums">{fmtHMS(status.remaining)}</span>
      </div>
      <span className="hidden sm:block text-[10px] font-bold font-mono text-white/50 tracking-wide">
        {status.session.label}
      </span>
    </div>
  );
}

// ─── Chart panel wrapper ────────────────────────────────────────────────────

function ChartPanel({ className = '', children }: {
  className?: string; children: React.ReactNode;
}) {
  // Symbol header bar (ES1! / NQ1!) intentionally removed — the bare chart
  // fills the panel for a clean, header-free monochrome surface.
  return (
    <div className={`flex flex-col min-w-0 min-h-0 ${className}`}>
      <div className="flex-1 min-h-0 bg-[#000000]">{children}</div>
    </div>
  );
}

// ─── Session gating box ──────────────────────────────────────────────────────

function SessionGate() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 bg-[#000000]">
      <div className="max-w-lg text-center rounded-xl border border-[#d4af37]/50 bg-[#0d0d0f] p-10 [box-shadow:0_0_60px_-15px_rgba(212,175,55,0.4)]" dir="rtl">
        <span className="text-[#d4af37] text-4xl">◈</span>
        <p className="mt-5 text-xl font-bold text-white leading-relaxed tracking-wide">
          אין סשן מסחר פעיל כרגע — הגרפים ומערכת הציטוטים יתעדכנו עם תחילת הסשן הבא.
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// `sidebar` is a Server Component (NewsWidget) passed in from the server page,
// so the macro feed renders server-side even though this view is client-only.
export default function DashboardView({ sidebar }: { sidebar?: React.ReactNode }) {
  const live = useLivePrices();
  const { isMarketOpen, nextOpenLabel } = useMarketStatus();

  const [clock, setClock] = useState(() => israelClock());
  const [override, setOverride] = useState(false);

  // Live IDT clock + session countdown (1s tick). Client-only (ssr:false route).
  useEffect(() => {
    const id = setInterval(() => setClock(israelClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const status     = getSessionStatus(clock.sec);
  const marketOpen = override || isMarketOpen;             // weekend gate (dev override bypasses)
  const visible    = override || (isMarketOpen && status.inSession);
  const isDev      = process.env.NODE_ENV !== 'production';

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#000000] text-[#c0c0c0]">

      {/* Header — TradingView tickers + clock HUD */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-4 md:px-6 py-2 md:py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        {/* Live tickers */}
        <div className="flex items-center gap-3 min-w-0 overflow-x-auto">
          {marketOpen ? (
            <>
              <div className="w-48 md:w-64 shrink-0"><TickerWidget symbol="CME_MINI:ES1!" /></div>
              <div className="h-10 w-px bg-[#1c1c1e] shrink-0" />
              <div className="w-48 md:w-64 shrink-0"><TickerWidget symbol="CME_MINI:NQ1!" /></div>
            </>
          ) : (
            <MarketClosedHUD nextOpenLabel={nextOpenLabel} />
          )}
        </div>

        <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
          {isDev && (
            <button
              onClick={() => setOverride(o => !o)}
              className={`px-2.5 py-1 rounded-sm border text-xs font-bold font-mono transition-colors duration-300 ${
                override ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] text-white/60 hover:text-white'
              }`}
              dir="rtl"
            >
              עקוף סשן
            </button>
          )}
          {marketOpen && <ClockHUD clock={clock.clock} status={status} />}
        </div>
      </header>

      {/* Single scroll context — charts fill viewport, calculator scrolls into view below */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* Chart row — fixed height so PositionCalculator is reachable by scrolling.
            Charts are iframes that swallow scroll events; the scroll container
            on the right edge (outside the chart iframes) lets the user scroll. */}
        <div className="flex" style={{ height: 'clamp(340px, 65vh, 780px)' }}>
          {/* Macro feed sidebar */}
          <div className="hidden md:block shrink-0 overflow-y-auto" style={{ width: '288px' }}>
            {sidebar}
          </div>

          <div className="relative flex-1 min-w-0">
            {visible ? (
              <div className="flex flex-col md:flex-row h-full">
                <ChartPanel className="flex-1 border-b md:border-b-0 md:border-r border-[#1c1c1e]">
                  <SmcChart symbol="ES" interval="5" />
                </ChartPanel>
                <ChartPanel className="flex-1">
                  <SmcChart symbol="NQ" interval="5" />
                </ChartPanel>
              </div>
            ) : (
              <SessionGate />
            )}
          </div>
        </div>

        {/* Scroll anchor so the #risk-calculator hash-link lands with breathing room */}
        <div id="risk-calculator" className="scroll-mt-4">
          <PositionCalculator live={live} />
        </div>
      </div>
    </div>
  );
}
