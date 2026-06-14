'use client';

import { useEffect, useState } from 'react';
import { useLivePrices } from '../hooks/useLivePrices';
import SmcChart from './SmcChart';
import TickerWidget from './TickerWidget';
import PositionCalculator from './PositionCalculator';
import { israelClock, getSessionStatus, fmtHMS, type SessionStatus } from '../lib/sessions';

// ─── Institutional clock + session countdown HUD ────────────────────────────

function ClockHUD({ clock, status }: { clock: string; status: SessionStatus }) {
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-black font-mono text-white tabular-nums tracking-tight [text-shadow:0_0_20px_rgba(212,175,55,0.25)]">
          {clock}
        </span>
        <span className="text-xs font-bold font-mono text-[#d4af37] uppercase tracking-[0.2em]">IDT</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1 rounded-sm border border-[#d4af37]/30 bg-[#d4af37]/5">
        <span className={`h-2 w-2 rounded-full ${status.inSession ? 'bg-[#d4af37] animate-pulse' : 'bg-white/40'}`} />
        <span className="text-sm font-bold font-mono text-white/80">
          {status.inSession ? 'הסשן הנוכחי מסתיים בעוד:' : 'הסשן הבא מתחיל בעוד:'}
        </span>
        <span className="text-sm font-black font-mono text-[#d4af37] tabular-nums">{fmtHMS(status.remaining)}</span>
      </div>
      <span className="text-xs font-bold font-mono text-white/50 tracking-wide">
        {status.inSession ? 'סשן נוכחי' : 'הסשן הבא'}: {status.session.label}
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

  const [clock, setClock] = useState(() => israelClock());
  const [override, setOverride] = useState(false);

  // Live IDT clock + session countdown (1s tick). Client-only (ssr:false route).
  useEffect(() => {
    const id = setInterval(() => setClock(israelClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const status  = getSessionStatus(clock.sec);
  const visible = override || status.inSession;
  const isDev   = process.env.NODE_ENV !== 'production';

  return (
    <div className="flex flex-col h-full bg-[#000000] text-[#c0c0c0] overflow-hidden">

      {/* Header — TradingView tickers + clock HUD */}
      <header className="flex items-center justify-between gap-6 px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-64 shrink-0"><TickerWidget symbol="CME_MINI:ES1!" /></div>
          <div className="h-12 w-px bg-[#1c1c1e] shrink-0" />
          <div className="w-64 shrink-0"><TickerWidget symbol="CME_MINI:NQ1!" /></div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {isDev && (
            <button
              onClick={() => setOverride(o => !o)}
              className={`px-3 py-1.5 rounded-sm border text-sm font-bold font-mono transition-colors duration-300 ${
                override ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] text-white/60 hover:text-white'
              }`}
              dir="rtl"
            >
              עקוף סשן (פיתוח)
            </button>
          )}
          <ClockHUD clock={clock.clock} status={status} />
        </div>
      </header>

      {/* Scroll region: charts fill the first screen, calculator below the fold */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex h-full min-h-0">
          {sidebar}

          {/* Chart workspace — charts when active/override, gated overlay otherwise */}
          <div className="relative flex-1 min-w-0 min-h-0">
            {visible ? (
              <div className="flex h-full min-h-0">
                <ChartPanel className="flex-1 border-r border-[#1c1c1e]">
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

        <div id="risk-calculator" className="scroll-mt-16">
          <PositionCalculator live={live} />
        </div>
      </div>
    </div>
  );
}
