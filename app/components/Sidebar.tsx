'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '../hooks/useLanguage';

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
          className="block font-serif text-[16px] tracking-[0.06em] text-[#c0c0c0] leading-none"
          style={{ fontStyle: 'normal' }}
        >
          Onyx
        </span>
        <span className={`block font-mono text-[8px] tracking-[0.38em] text-[#c9a84c] uppercase leading-none mt-1.5 ${rtl ? 'text-right' : ''}`}>
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
                'text-[10px] font-mono tracking-[0.14em] uppercase',
                'transition-all duration-700 ease-in-out',
                rtl ? 'pr-[10px] pl-3 border-r-2 border-l-0' : 'pl-[10px] pr-3 border-l-2',
                active
                  ? `border-[#c9a84c] bg-[#c9a84c]/6 text-[#c0c0c0]`
                  : `border-transparent text-[#52525b] hover:text-[#c0c0c0] hover:border-[#1c1c1e]`,
              ].join(' ')}
            >
              {active && (
                <span className={`w-1 h-1 rounded-full bg-[#c9a84c] shrink-0 ${rtl ? 'order-last' : ''}`} />
              )}
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── System status + language toggle ──────────────────── */}
      <div className="px-5 py-4 border-t border-[#1c1c1e]">
        <div className={`flex items-center gap-2 mb-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9a84c] shrink-0" />
          <span className={`text-[9px] font-mono uppercase tracking-[0.22em] text-[#c9a84c] ${rtl ? 'text-right' : ''}`}>
            {t('sys_live')}
          </span>
        </div>
        <span className={`text-[8px] font-mono text-[#52525b] tracking-[0.18em] uppercase block mb-3 ${rtl ? 'text-right' : ''}`}>
          CME · ES · NQ · Real-time
        </span>

        {/* Language toggle */}
        <button
          onClick={toggle}
          aria-label="Toggle language"
          className="w-full flex items-center justify-between px-3 py-1.5 border border-[#1c1c1e] rounded-sm text-[9px] font-mono tracking-[0.25em] text-[#52525b] hover:text-[#c9a84c] hover:border-[#c9a84c]/25 transition-all duration-700 ease-in-out group"
        >
          <span className="text-[#c9a84c]/40 group-hover:text-[#c9a84c]/60 transition-colors duration-700">◈</span>
          <span>{t('lang_other')}</span>
          <span className="text-[#c9a84c]/40 group-hover:text-[#c9a84c]/60 transition-colors duration-700">◈</span>
        </button>
      </div>
    </aside>
  );
}
