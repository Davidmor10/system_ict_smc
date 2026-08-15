'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import type { DictKey } from '../lib/i18n';
import { usePlan, type Role } from './PlanProvider';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Nav icons (Tabler-flavored) inlined as tiny SVG components. Kept in-file
// so the sidebar stays a single small deployable unit — no icon package,
// no runtime lookup. currentColor + stroke lets each item paint in the
// same tone as its label (active gold, locked dim, hover white).
type IconEl = () => React.JSX.Element;
const iconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
function IconGrid()      { return <svg {...iconProps}><rect x="3" y="3"  width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>; }
function IconBook()      { return <svg {...iconProps}><path d="M3 4h14a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2Z" /><path d="M7 4v16" /></svg>; }
function IconNotebook()  { return <svg {...iconProps}><path d="M6 4h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M12 8h3M12 12h3M12 16h3" /></svg>; }
function IconChart()     { return <svg {...iconProps}><path d="M4 20V10M10 20V4M16 20v-7M22 20h-20" /></svg>; }
function IconCoach()     { return <svg {...iconProps}><path d="M8 9h8M8 13h5" /><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg>; }
function IconPlaybook()  { return <svg {...iconProps}><path d="M12 4v16" /><path d="M3 6a3 3 0 0 1 3-3h5v18H6a3 3 0 0 1-3-3Z" /><path d="M21 6a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 0 3-3Z" /></svg>; }
function IconRules()     { return <svg {...iconProps}><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7Z" /><path d="M9 12l2 2 4-4" /></svg>; }
function IconReports()   { return <svg {...iconProps}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /><path d="M8 13h5M8 17h4M16 12l3 3-3 3" /></svg>; }
function IconSettings()  { return <svg {...iconProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>; }

// `child: true` nests an item under the one above it — indented, no icon, a
// smaller label. Statistics sits under Notebook because it is a view of the
// same record rather than a section of its own.
const NAV: { href: string; key: DictKey; min: Role; Icon: IconEl; child?: boolean }[] = [
  { href: '/dashboard',              key: 'nav_workspace',    min: 'free',   Icon: IconGrid     },
  { href: '/dashboard/journal',      key: 'nav_journal',      min: 'free',   Icon: IconBook     },
  { href: '/dashboard/notebook',     key: 'nav_notebook',     min: 'free',   Icon: IconNotebook },
  { href: '/dashboard/stats',        key: 'nav_stats',        min: 'deluxe', Icon: IconChart, child: true },
  { href: '/dashboard/ai-analytics', key: 'nav_ai_analytics', min: 'pro',    Icon: IconChart    },
  { href: '/dashboard/coach',        key: 'nav_coach',        min: 'deluxe', Icon: IconCoach    },
  { href: '/dashboard/playbook',     key: 'nav_playbook',     min: 'free',   Icon: IconPlaybook },
  { href: '/dashboard/rules',        key: 'nav_rules',        min: 'free',   Icon: IconRules    },
  { href: '/dashboard/reports',      key: 'nav_reports',      min: 'free',   Icon: IconReports  },
  { href: '/dashboard/settings',     key: 'nav_settings',     min: 'free',   Icon: IconSettings },
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
    <aside style={{ order: rtl ? 2 : 0 }} className={`hidden min-[881px]:flex w-[210px] shrink-0 flex-col ${rtl ? 'border-l' : 'border-r'} border-[#1c1c1e] bg-black`}>

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
        {NAV.map(({ href, key, min, Icon, child }) => {
          const locked = !canAccess(min);
          const active = !locked && (pathname === href || (href !== '/dashboard' && pathname.startsWith(href)));
          return (
            <Link
              key={href}
              href={locked ? '/checkout' : href}
              dir={rtl ? 'rtl' : 'ltr'}
              title={locked ? t('nav_locked_hint') : undefined}
              style={{
                transition: 'color 250ms cubic-bezier(0.16,1,0.3,1), background-color 250ms cubic-bezier(0.16,1,0.3,1), border-color 250ms cubic-bezier(0.16,1,0.3,1)',
                ...(child ? { paddingInlineStart: 26 } : null),
              }}
              className={[
                'flex items-center gap-2.5 px-3 py-2.5 rounded-xl',
                child ? 'text-[12px] tracking-[0.08em]' : 'text-[13px] tracking-[0.1em]',
                'font-bold font-mono uppercase',
                rtl ? 'pr-[10px] pl-3 border-r-2 border-l-0' : 'pl-[10px] pr-3 border-l-2',
                active
                  ? 'border-[#d4af37] bg-[#d4af37]/[0.08] text-white'
                  : locked
                    ? 'border-transparent text-white/30 hover:text-white/55 hover:bg-white/[0.02]'
                    : 'border-transparent text-white/55 hover:text-white/95 hover:bg-white/[0.03] hover:border-white/10',
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
              {!child && (
                <span className={`shrink-0 ${active ? 'text-[#d4af37]' : locked ? 'text-white/30' : 'text-white/50'}`}>
                  <Icon />
                </span>
              )}
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
