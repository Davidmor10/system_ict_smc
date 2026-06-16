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
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-center transition-colors duration-300 ${
              active ? 'text-[#d4af37]' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span className="text-[10px] font-bold font-mono uppercase tracking-[0.14em]">{t(labelKey)}</span>
            {active && <span className="absolute bottom-0 h-px w-10 bg-[#d4af37]" />}
          </Link>
        );
      })}
    </nav>
  );
}
