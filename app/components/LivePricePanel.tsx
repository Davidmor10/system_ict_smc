'use client';

import { useEffect, useState } from 'react';
import { useTvPrice } from '../hooks/useTvPrice';
import { useLanguage } from '../hooks/useLanguage';

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—:—:—';
  return new Date(ms).toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function SessionLabel({ sess, en }: { sess: string | null; en: boolean }) {
  if (!sess) return null;
  const map: Record<string, { he: string; en: string }> = {
    asia:   { he: 'אסיה',     en: 'Asia'   },
    london: { he: 'לונדון',   en: 'London' },
    ny_am:  { he: 'ניו יורק AM', en: 'NY AM' },
    ny_pm:  { he: 'ניו יורק PM', en: 'NY PM' },
    off:    { he: 'סגור',     en: 'Off'    },
  };
  const label = map[sess.toLowerCase()];
  return (
    <span className="font-mono text-[11px] text-white/40 uppercase tracking-[0.15em]">
      {label ? (en ? label.en : label.he) : sess.toUpperCase()}
    </span>
  );
}

// Ticking clock (seconds precision)
function NowClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(
      new Date().toLocaleTimeString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }),
    );
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{time}</span>;
}

export default function LivePricePanel() {
  const tv  = useTvPrice();
  const { lang } = useLanguage();
  const en  = lang === 'en';
  const dir = en ? 'ltr' : 'rtl';

  const isUp   = tv.change !== null && tv.change >= 0;
  const noData = tv.price === null;
  const color  = isUp ? '#d4af37' : '#ef4444';
  const glow   = isUp ? 'rgba(212,175,55,0.25)' : 'rgba(239,68,68,0.25)';

  return (
    <div dir={dir}>
      {/* Section header */}
      <div className="flex items-end justify-between mb-[30px] pb-5 border-b border-[#1c1c1e]">
        <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">02</span>
        <div className={en ? 'text-left' : 'text-right'}>
          <h2 className="font-serif text-[26px] font-bold text-white leading-none">
            {en ? 'Live Price' : 'מחיר חי'}
          </h2>
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/45 mt-2">
            TradingView Real-Time Feed
          </p>
        </div>
      </div>

      {/* No data state */}
      {noData ? (
        <div className="flex flex-col items-center justify-center h-[200px] border border-dashed border-[#2a2a2d] rounded-[5px] gap-4">
          {tv.status === 'error' ? (
            <>
              <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
              <p className="font-mono text-[12px] text-[#ef4444]/70 tracking-[0.2em] uppercase">
                {en ? 'Connection Error' : 'שגיאת חיבור'}
              </p>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-[#52525b] animate-pulse" />
              <p className="font-mono text-[12px] text-[#52525b] tracking-[0.2em] uppercase">
                {en ? 'Awaiting TradingView Signal' : 'ממתין לסיגנל מ-TradingView'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">

          {/* Main price row */}
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div className="flex items-baseline gap-4 flex-wrap">
              <span
                className="font-mono text-[56px] max-[880px]:text-[38px] font-black tabular-nums leading-none"
                style={{ color, textShadow: `0 0 50px ${glow}` }}
              >
                {fmt(tv.price)}
              </span>
              <span
                className="font-mono text-[18px] max-[880px]:text-[14px] font-bold tabular-nums"
                style={{ color: `${color}cc` }}
              >
                {isUp ? '+' : ''}{fmt(tv.change)} ({isUp ? '+' : ''}{tv.changePct?.toFixed(3)}%)
              </span>
            </div>

            {/* Status + TF + session */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d4af37] animate-pulse" />
                <span className="font-mono text-[11px] text-[#d4af37] tracking-[0.25em] uppercase">LIVE</span>
                {tv.tf && (
                  <span className="font-mono text-[11px] text-white/50 tracking-[0.15em] uppercase">
                    · {tv.tf.toUpperCase()}
                  </span>
                )}
              </div>
              <SessionLabel sess={tv.sess} en={en} />
            </div>
          </div>

          {/* OHLC grid */}
          <div className="grid grid-cols-4 max-[600px]:grid-cols-2 gap-2">
            {([
              { key: en ? 'Open'  : 'פתיחה', val: tv.open  },
              { key: en ? 'High'  : 'גבוה',  val: tv.high  },
              { key: en ? 'Low'   : 'נמוך',  val: tv.low   },
              { key: en ? 'Close' : 'סגירה', val: tv.price },
            ] as const).map(({ key, val }) => (
              <div key={key} className="p-3 border border-[#1c1c1e] rounded-[3px] bg-[#060607]">
                <p className="font-mono text-[10px] text-[#52525b] tracking-[0.2em] uppercase mb-1.5">{key}</p>
                <p className="font-mono text-[15px] font-bold text-white tabular-nums">{fmt(val)}</p>
              </div>
            ))}
          </div>

          {/* Time row */}
          <div className="flex items-center justify-between pt-3 border-t border-[#1c1c1e]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#52525b]">
                {en ? 'Now' : 'עכשיו'}
              </span>
              <span className="font-mono text-[13px] font-bold text-white/70">
                <NowClock />
              </span>
              <span className="font-mono text-[11px] text-[#52525b] uppercase">IDT</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#52525b]">
                {en ? 'Bar open' : 'פתיחת נר'}
              </span>
              <span className="font-mono text-[13px] font-bold text-white/50 tabular-nums">
                {fmtTime(tv.barTime)}
              </span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
