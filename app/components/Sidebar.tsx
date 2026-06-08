'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard',           label: 'Main Workspace'   },
  { href: '/dashboard/analytics', label: 'Market Analytics' },
  { href: '/dashboard/journal',   label: 'Trading Journal'  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[200px] shrink-0 flex flex-col border-r border-[#1c1c1e] bg-[#0d0d0f]">

      {/* ── Branding ─────────────────────────────────────────── */}
      <div className="px-5 py-5 border-b border-[#1c1c1e]">
        <span
          className="block font-serif text-[16px] tracking-[0.06em] text-[#c0c0c0] leading-none"
          style={{ fontStyle: 'normal' }}
        >
          Onyx
        </span>
        <span className="block font-mono text-[8px] tracking-[0.38em] text-[#c9a84c] uppercase leading-none mt-1.5">
          Trading
        </span>
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-0.5">
        {NAV.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-sm',
                'text-[10px] font-mono tracking-[0.14em] uppercase',
                'transition-all duration-700 ease-in-out',
                active
                  ? 'border-l-2 border-[#c9a84c] bg-[#c9a84c]/6 text-[#c0c0c0] pl-[10px]'
                  : 'border-l-2 border-transparent text-[#52525b] hover:text-[#c0c0c0] hover:border-[#1c1c1e] pl-[10px]',
              ].join(' ')}
            >
              {active && (
                <span className="w-1 h-1 rounded-full bg-[#c9a84c] shrink-0" />
              )}
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── System status ─────────────────────────────────────── */}
      <div className="px-5 py-4 border-t border-[#1c1c1e]">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9a84c] shrink-0" />
          <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-[#c9a84c]">
            System Live
          </span>
        </div>
        <span className="text-[8px] font-mono text-[#52525b] tracking-[0.18em] uppercase block">
          CME · ES · NQ · Real-time
        </span>
      </div>
    </aside>
  );
}
