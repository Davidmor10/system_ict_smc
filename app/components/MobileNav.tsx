'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '../hooks/useLanguage';

const NAV = [
  { href: '/dashboard',           icon: '⬡', labelKey: 'nav_workspace'  as const },
  { href: '/dashboard/analytics', icon: '◈', labelKey: 'nav_analytics'  as const },
  { href: '/dashboard/journal',   icon: '✦', labelKey: 'nav_journal'    as const },
] as const;

export default function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 flex items-stretch border-t border-[#1c1c1e] bg-[#0d0d0f]">
      {NAV.map(({ href, icon, labelKey }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 text-center active:scale-90`}
            style={{
              color: active ? '#d4af37' : 'rgba(255,255,255,0.38)',
              transition: 'color 250ms cubic-bezier(0.16,1,0.3,1), transform 150ms cubic-bezier(0.34,1.56,0.64,1)',
            }}
          >
            <span
              className="text-lg leading-none"
              style={{
                transform: active ? 'scale(1.18)' : 'scale(1)',
                transition: 'transform 350ms cubic-bezier(0.34,1.56,0.64,1)',
                display: 'block',
              }}
            >{icon}</span>
            <span className="text-[10px] font-bold font-mono uppercase tracking-[0.14em]">{t(labelKey)}</span>
            {/* Sliding gold underline */}
            <span
              className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full bg-[#d4af37]"
              style={{
                width: active ? '28px' : '0px',
                opacity: active ? 1 : 0,
                transition: 'width 350ms cubic-bezier(0.16,1,0.3,1), opacity 250ms ease',
                boxShadow: active ? '0 0 8px rgba(212,175,55,0.6)' : 'none',
              }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
