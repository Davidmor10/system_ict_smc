'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '../hooks/useLanguage';

function IconGrid() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="8" rx="1.5" />
      <rect x="12" y="2" width="8" height="8" rx="1.5" />
      <rect x="2" y="12" width="8" height="8" rx="1.5" />
      <rect x="12" y="12" width="8" height="8" rx="1.5" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <line x1="8" y1="3" x2="8" y2="19" />
      <line x1="11" y1="8" x2="17" y2="8" />
      <line x1="11" y1="12" x2="17" y2="12" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,16 7,10 11,13 16,6 20,9" />
      <line x1="2" y1="20" x2="20" y2="20" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5,3 19,11 5,19" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2L3 6v5c0 4.5 3.5 8.5 8 9.5C16.5 19.5 20 15.5 20 11V6L11 2z" />
      <polyline points="7,11 10,14 15,9" />
    </svg>
  );
}

function getActive(pathname: string): string {
  if (pathname.startsWith('/dashboard/journal'))      return 'journal';
  if (pathname.startsWith('/dashboard/ai-analytics'))  return 'ai-analytics';
  if (pathname.startsWith('/dashboard/playbook'))     return 'playbook';
  if (pathname.startsWith('/dashboard/rules'))        return 'rules';
  return 'dashboard';
}

export default function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const active = getActive(pathname);

  const tabs = [
    { id: 'dashboard',     href: '/dashboard',              Icon: IconGrid,   label: t('nav_workspace')    },
    { id: 'journal',       href: '/dashboard/journal',      Icon: IconBook,   label: t('nav_journal')      },
    { id: 'ai-analytics',  href: '/dashboard/ai-analytics', Icon: IconChart,  label: t('nav_ai_analytics') },
    { id: 'playbook',      href: '/dashboard/playbook',     Icon: IconPlay,   label: t('nav_playbook')     },
    { id: 'rules',         href: '/dashboard/rules',        Icon: IconShield, label: t('nav_rules')        },
  ];

  return (
    <nav
      className="fixed left-0 right-0 bottom-0 z-[70] min-[881px]:hidden grid"
      style={{
        gridTemplateColumns: 'repeat(5, 1fr)',
        background: 'rgba(10,10,12,.95)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderTop: '1px solid #1c1c1e',
        paddingTop: 9,
        paddingLeft: 4,
        paddingRight: 4,
        paddingBottom: 'calc(9px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {tabs.map(({ id, href, Icon, label }) => {
        const isActive = active === id;
        return (
          <Link
            key={id}
            href={href}
            className="relative flex flex-col items-center justify-center gap-[5px] active:scale-90 transition-transform duration-150"
            style={{ color: isActive ? '#d4af37' : 'rgba(255,255,255,.4)' }}
          >
            <span style={{ filter: isActive ? 'drop-shadow(0 0 6px rgba(212,175,55,.5))' : 'none', transition: 'filter 250ms', display: 'block' }}>
              <Icon />
            </span>
            <span className="font-mono text-[8px] font-bold uppercase tracking-[0.10em] leading-none">{label}</span>
            <span
              className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full bg-[#d4af37]"
              style={{
                width: isActive ? '24px' : '0px',
                opacity: isActive ? 1 : 0,
                boxShadow: isActive ? '0 0 8px rgba(212,175,55,.6)' : 'none',
                transition: 'width 350ms cubic-bezier(0.16,1,0.3,1), opacity 250ms ease',
              }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
