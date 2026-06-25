'use client';

import { useEffect, useState } from 'react';
import { useFuturesPrice, type FuturePrice } from '../hooks/useFuturesPrice';
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
  return <span className="tabular-nums">{time || '—:—:—'}</span>;
}

function PriceCard({ name, full, data, en }: {
  name:  string;
  full:  string;
  data:  FuturePrice;
  en:    boolean;
}) {
  const isUp   = data.change !== null && data.change >= 0;
  const color  = data.price === null ? '#52525b' : isUp ? '#d4af37' : '#ef4444';
  const glow   = isUp ? 'rgba(212,175,55,0.2)' : 'rgba(239,68,68,0.2)';
  const noData = data.price === null;

  return (
    <div className="flex-1 p-6 max-[880px]:p-4 border border-[#1c1c1e] rounded-[5px] bg-[#060607] space-y-4">
      {/* Symbol header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-[22px] font-black text-white tracking-[0.05em]">{name}</span>
          <span className="font-mono text-[11px] text-[#52525b] ml-2 tracking-[0.1em]">{full}</span>
        </div>
        {!noData && (
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d4af37] animate-pulse" />
            <span className="font-mono text-[10px] text-[#d4af37] tracking-[0.2em] uppercase">Live</span>
          </div>
        )}
      </div>

      {/* Main price */}
      {noData ? (
        <div className="h-[60px] flex items-center">
          <span className="font-mono text-[13px] text-[#52525b] tracking-[0.15em] uppercase animate-pulse">
            {en ? 'Fetching…' : 'טוען…'}
          </span>
        </div>
      ) : (
        <div>
          <div
            className="font-mono text-[44px] max-[880px]:text-[32px] font-black tabular-nums leading-none"
            style={{ color, textShadow: `0 0 40px ${glow}` }}
          >
            {fmt(data.price)}
          </div>
          <div
            className="font-mono text-[15px] max-[880px]:text-[13px] font-bold tabular-nums mt-1"
            style={{ color: `${color}bb` }}
          >
            {isUp ? '+' : ''}{fmt(data.change)} ({isUp ? '+' : ''}{data.changePct?.toFixed(3)}%)
          </div>
        </div>
      )}

      {/* OHLC */}
      <div className="grid grid-cols-4 gap-2">
        {([
          { k: en ? 'O' : 'פ', v: data.open  },
          { k: en ? 'H' : 'ג', v: data.high  },
          { k: en ? 'L' : 'נ', v: data.low   },
          { k: en ? 'C' : 'ס', v: data.price },
        ] as const).map(({ k, v }) => (
          <div key={k} className="p-2 border border-[#1a1a1c] rounded-[3px]">
            <p className="font-mono text-[9px] text-[#52525b] tracking-[0.2em] uppercase mb-1">{k}</p>
            <p className="font-mono text-[13px] font-bold text-white/80 tabular-nums">{fmt(v)}</p>
          </div>
        ))}
      </div>

      {/* Bar time */}
      {!noData && (
        <p className="font-mono text-[10px] text-[#52525b]">
          {en ? 'Bar' : 'נר'}: <span className="text-white/40 tabular-nums">{fmtTime(data.barTime)}</span>
        </p>
      )}
    </div>
  );
}

export default function LivePricePanel() {
  const { es, nq, status } = useFuturesPrice();
  const { lang } = useLanguage();
  const en  = lang === 'en';
  const dir = en ? 'ltr' : 'rtl';

  return (
    <div dir={dir}>
      {/* Section header */}
      <div className="flex items-end justify-between mb-[30px] pb-5 border-b border-[#1c1c1e]">
        <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">02</span>
        <div className={en ? 'text-left' : 'text-right'}>
          <h2 className="font-serif text-[26px] font-bold text-white leading-none">
            {en ? 'Futures · Live' : 'חוזים עתידיים · חי'}
          </h2>
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/45 mt-2">
            ES &amp; NQ · Yahoo Finance
          </p>
        </div>
      </div>

      {/* Error state */}
      {status === 'error' && (
        <div className="mb-4 px-4 py-2 border border-[#ef4444]/30 rounded-[3px] bg-[#ef4444]/5">
          <p className="font-mono text-[11px] text-[#ef4444]/80">
            {en ? 'Unable to fetch prices — retrying…' : 'לא ניתן לטעון מחירים — מנסה שנית…'}
          </p>
        </div>
      )}

      {/* Cards */}
      <div className="flex gap-4 max-[600px]:flex-col">
        <PriceCard name="ES" full="S&P 500 Futures" data={es} en={en} />
        <PriceCard name="NQ" full="Nasdaq Futures"  data={nq} en={en} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#1c1c1e]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[#52525b]">{en ? 'Now' : 'עכשיו'}</span>
          <span className="font-mono text-[13px] font-bold text-white/60"><NowClock /></span>
          <span className="font-mono text-[11px] text-[#52525b] uppercase">IDT</span>
        </div>
        <span className="font-mono text-[10px] text-[#52525b]">
          {en ? 'Updates every 15s' : 'מתעדכן כל 15 שניות'}
        </span>
      </div>
    </div>
  );
}
