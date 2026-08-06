'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import type { DictKey } from '../lib/i18n';
import { usePlan, type Role } from './PlanProvider';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const NAV: { href: string; key: DictKey; min: Role }[] = [
  { href: '/dashboard',              key: 'nav_workspace',    min: 'free'   },
  { href: '/dashboard/journal',      key: 'nav_journal',      min: 'free'   },
  { href: '/dashboard/notebook',     key: 'nav_notebook',     min: 'free'   },
  { href: '/dashboard/ai-analytics', key: 'nav_ai_analytics', min: 'pro'    },
  { href: '/dashboard/coach',        key: 'nav_coach',        min: 'deluxe' },
  { href: '/dashboard/playbook',     key: 'nav_playbook',     min: 'free'   },
  { href: '/dashboard/rules',        key: 'nav_rules',        min: 'free'   },
  { href: '/dashboard/settings',     key: 'nav_settings',     min: 'free'   },
];

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { lang, t } = useLanguage();
  const { canAccess } = usePlan();
  const rtl = lang === 'he';

  return (
    <aside style={{ order: rtl ? 2 : 0 }} className={`hidden min-[881px]:flex w-[200px] shrink-0 flex-col ${rtl ? 'border-l' : 'border-r'} border-[#1c1c1e] bg-black`}>

      {/* ── Branding ─────────────────────────────────────────── */}
      <div className="px-5 py-5 border-b border-[#1c1c1e]">
        <span className="block font-serif text-lg font-bold tracking-[0.06em] text-white leading-none">
          ONYX
        </span>
        <span className={`block font-mono text-[10px] font-bold tracking-[0.34em] text-[#d4af37] uppercase leading-none mt-1.5 ${rtl ? 'text-right' : ''}`}>
          {t('brand_sub')}
        </span>
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-0.5">
        {NAV.map(({ href, key, min }) => {
          const locked = !canAccess(min);
          const active = !locked && (pathname === href || (href !== '/dashboard' && pathname.startsWith(href)));
          // Locked items go to the upgrade funnel instead of a page that would
          // bounce them there anyway (the server guard is the real gate).
          return (
            <Link
              key={href}
              href={locked ? '/checkout' : href}
              dir={rtl ? 'rtl' : 'ltr'}
              title={locked ? t('nav_locked_hint') : undefined}
              style={{ transition: 'color 250ms cubic-bezier(0.16,1,0.3,1), background-color 250ms cubic-bezier(0.16,1,0.3,1), border-color 250ms cubic-bezier(0.16,1,0.3,1)' }}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl',
                'text-sm font-bold font-mono tracking-[0.12em] uppercase',
                rtl ? 'pr-[10px] pl-3 border-r-2 border-l-0' : 'pl-[10px] pr-3 border-l-2',
                active
                  ? 'border-[#d4af37] bg-[#d4af37]/8 text-white'
                  : locked
                    ? 'border-transparent text-white/30 hover:text-white/55 hover:bg-white/[0.02]'
                    : 'border-transparent text-white/50 hover:text-white/90 hover:bg-white/[0.03] hover:border-white/10',
              ].join(' ')}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: active ? '#d4af37' : 'transparent',
                  boxShadow: active ? '0 0 8px rgba(212,175,55,0.7)' : 'none',
                  transition: 'background 300ms cubic-bezier(0.16,1,0.3,1), box-shadow 300ms cubic-bezier(0.16,1,0.3,1)',
                  order: rtl ? 1 : 0,
                }}
              />
              <span className="flex-1">{t(key)}</span>
              {locked && <span className="shrink-0 text-[#d4af37]/50" style={{ order: rtl ? -1 : 1 }}><LockIcon /></span>}
            </Link>
          );
        })}
      </nav>

      {/* ── Account + language toggle ─────────── */}
      <div className="px-5 py-4 border-t border-[#1c1c1e]">
        {CLERK_ENABLED && (
          <div className={`flex items-center gap-2.5 mb-3 ${rtl ? 'flex-row-reverse' : ''}`}>
            <UserButton />
            <span className="text-xs font-bold font-mono text-white/50 uppercase tracking-[0.18em]">{t('sys_account')}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
