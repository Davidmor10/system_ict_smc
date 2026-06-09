'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const NAV_KEYS = [
  { href: '/dashboard',           key: 'nav_workspace' },
  { href: '/dashboard/analytics', key: 'nav_analytics' },
  { href: '/dashboard/journal',   key: 'nav_journal'   },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const { lang, toggle, t } = useLanguage();
  const rtl = lang === 'he';

  return (
    <aside className="w-[200px] shrink-0 flex flex-col border-r border-[#1c1c1e] bg-[#0d0d0f]">

      {/* ── Branding ─────────────────────────────────────────── */}
      <div className="px-5 py-5 border-b border-[#1c1c1e]">
        <span
          className="block font-serif text-lg font-bold tracking-[0.06em] text-white leading-none"
          style={{ fontStyle: 'normal' }}
        >
          Onyx
        </span>
        <span className={`block font-mono text-[10px] font-bold tracking-[0.34em] text-[#d4af37] uppercase leading-none mt-1.5 ${rtl ? 'text-right' : ''}`}>
          {t('brand_sub')}
        </span>
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-0.5">
        {NAV_KEYS.map(({ href, key }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              dir={rtl ? 'rtl' : 'ltr'}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-sm',
                'text-sm font-bold font-mono tracking-[0.12em] uppercase',
                'transition-all duration-700 ease-in-out',
                rtl ? 'pr-[10px] pl-3 border-r-2 border-l-0' : 'pl-[10px] pr-3 border-l-2',
                active
                  ? `border-[#d4af37] bg-[#d4af37]/8 text-white`
                  : `border-transparent text-white/55 hover:text-white hover:border-[#1c1c1e]`,
              ].join(' ')}
            >
              {active && (
                <span className={`w-1.5 h-1.5 rounded-full bg-[#d4af37] shrink-0 ${rtl ? 'order-last' : ''}`} />
              )}
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Account + system status + language toggle ─────────── */}
      <div className="px-5 py-4 border-t border-[#1c1c1e]">
        {CLERK_ENABLED && (
          <div className={`flex items-center gap-2.5 mb-3 ${rtl ? 'flex-row-reverse' : ''}`}>
            <UserButton />
            <span className="text-xs font-bold font-mono text-white/50 uppercase tracking-[0.18em]">{t('sys_account')}</span>
          </div>
        )}
        <div className={`flex items-center gap-2 mb-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <span className="h-2 w-2 rounded-full bg-[#d4af37] shrink-0" />
          <span className={`text-sm font-bold font-mono uppercase tracking-[0.18em] text-[#d4af37] ${rtl ? 'text-right' : ''}`}>
            {t('sys_live')}
          </span>
        </div>
        <span className={`text-[10px] font-bold font-mono text-white/40 tracking-[0.16em] uppercase block mb-3 ${rtl ? 'text-right' : ''}`}>
          CME · ES · NQ · Real-time
        </span>

        {/* Language toggle */}
        <button
          onClick={toggle}
          aria-label="Toggle language"
          className="w-full flex items-center justify-between px-3 py-2 border border-[#1c1c1e] rounded-sm text-xs font-bold font-mono tracking-[0.25em] text-white/60 hover:text-[#d4af37] hover:border-[#d4af37]/30 transition-all duration-700 ease-in-out group"
        >
          <span className="text-[#d4af37]/50 group-hover:text-[#d4af37]/70 transition-colors duration-700">◈</span>
          <span>{t('lang_other')}</span>
          <span className="text-[#d4af37]/50 group-hover:text-[#d4af37]/70 transition-colors duration-700">◈</span>
        </button>
      </div>
    </aside>
  );
}
