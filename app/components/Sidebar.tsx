'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard',           icon: '📊', label: 'Main Charts'       },
  { href: '/dashboard/analytics', icon: '🧠', label: 'Market Analytics'  },
  { href: '/dashboard/journal',   icon: '📓', label: 'Trading Journal'   },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[200px] shrink-0 flex flex-col border-r border-[#27272a] bg-[#18181b]">

      {/* ── Branding ───────────────────────────────────────────── */}
      <div className="px-5 py-5 border-b border-[#27272a]">
        <span className="block font-mono font-bold text-[11px] tracking-[0.22em] text-[#f4f4f5] leading-none">
          FRACTAL
        </span>
        <span className="block font-mono font-bold text-[11px] tracking-[0.22em] text-[#3b82f6] leading-none mt-0.5">
          // ENGINE
        </span>
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-md',
                'text-[11px] font-mono tracking-wide transition-colors duration-150',
                active
                  ? 'bg-[#3b82f6]/15 text-[#f4f4f5] border border-[#3b82f6]/25'
                  : 'text-[#71717a] hover:bg-[#27272a] hover:text-[#a1a1aa]',
              ].join(' ')}
            >
              <span className="text-sm leading-none">{icon}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Connection status ───────────────────────────────────── */}
      <div className="px-5 py-4 border-t border-[#27272a]">
        <div className="flex items-center gap-2 mb-1">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-70" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]" />
          </span>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#71717a]">
            System Live
          </span>
        </div>
        <span className="text-[9px] font-mono text-[#3f3f46] tracking-wider block">
          CME · ES · NQ · Real-time
        </span>
      </div>
    </aside>
  );
}
