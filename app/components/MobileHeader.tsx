'use client';

import Link from 'next/link';
import { usePortfolios } from './PortfolioProvider';

/** Fixed brand header, visible on mobile (≤880px) only.
 *
 *  It carries the portfolio because the rail does not exist here: the sidebar
 *  is hidden below 880px, and with it the switcher. Without this a phone had
 *  no way to see which account it was looking at, and no way to change it —
 *  on the one screen size where a trader is most likely to be checking. */
export default function MobileHeader() {
  const { selected, ready } = usePortfolios();
  return (
    <header
      className="fixed top-0 inset-x-0 z-[60] h-[54px] flex items-center justify-between px-4
                 min-[881px]:hidden"
      style={{
        background: 'rgba(8,8,9,.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid #1c1c1e',
      }}
    >
      {/* Brand */}
      <div className="flex items-baseline gap-[7px] leading-none">
        <span className="font-serif text-[21px] font-bold text-white tracking-[0.04em]">ONYX</span>
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-[#d4af37]">Trading</span>
      </div>

      {/* The portfolio, and the way to change it. A tap goes to the list —
          a dropdown in a 54px fixed bar on a phone is a worse control than
          the page it would be imitating. */}
      <div className="flex items-center gap-2 min-w-0">
        {ready && (
          <Link
            href="/dashboard/portfolios"
            className="flex flex-col items-end min-w-0 max-w-[46vw] px-2 py-1 rounded-md
                       border border-[#d4af37]/35 bg-[#d4af37]/[0.07]"
          >
            <span className="text-[11.5px] font-bold text-white leading-tight truncate max-w-full">
              {selected?.name || 'אין תיק מחובר'}
            </span>
            {selected && (
              <span className="font-mono text-[9px] font-bold text-[#d4af37] tabular-nums leading-tight" dir="ltr">
                ${Math.round(selected.startingBalanceUsd).toLocaleString('en-US')}
              </span>
            )}
          </Link>
        )}
        {/* Live pulse */}
        <span
          className="h-2 w-2 rounded-full bg-[#d4af37] animate-pulse shrink-0"
          style={{ boxShadow: '0 0 8px rgba(212,175,55,.7)' }}
        />
      </div>
    </header>
  );
}
