'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import type { DictKey } from '../lib/i18n';
import { usePlan, type Role } from './PlanProvider';
import './sidebar.css';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// The redesigned rail carries NO nav icons — a leading dot carries the state
// instead, and the label carries the meaning. Twelve small glyphs at 16px next
// to twelve Hebrew words were competing with the words rather than helping
// them, and none of them was ever the thing being read.
//
// `child: true` nests an item under the one above it — Statistics sits under
// Notebook because it is a view of the same record rather than a section of
// its own.
//
// `owner: true` is not a plan tier — no subscription reaches it. It is drawn
// only for an address on the admin allowlist, and hiding it is a convenience:
// the page itself answers everyone else with a 404 and never reads a row for
// them.
// `child: true` nests an item under the one above it — indented, no icon, a
// smaller label. Statistics sits under Notebook because it is a view of the
// same record rather than a section of its own.
//
// `owner: true` is not a plan tier — no subscription reaches it. It is drawn
// only for an address on the admin allowlist, and hiding it is a convenience:
// the page itself answers everyone else with a 404 and never reads a row for
// them.
const NAV: { href: string; key: DictKey; min: Role; child?: boolean; owner?: boolean }[] = [
  { href: '/dashboard',              key: 'nav_workspace',    min: 'starter'     },
  { href: '/dashboard/journal',      key: 'nav_journal',      min: 'starter'     },
  { href: '/dashboard/notebook',     key: 'nav_notebook',     min: 'starter' },
  { href: '/dashboard/stats',        key: 'nav_stats',        min: 'starter', child: true },
  { href: '/dashboard/progress',     key: 'nav_progress',     min: 'pro'     },
  { href: '/dashboard/ai-analytics', key: 'nav_ai_analytics', min: 'pro' },
  { href: '/dashboard/coach',        key: 'nav_coach',        min: 'deluxe'    },
  { href: '/dashboard/playbook',     key: 'nav_playbook',     min: 'starter' },
  { href: '/dashboard/rules',        key: 'nav_rules',        min: 'starter'    },
  { href: '/dashboard/reports',      key: 'nav_reports',      min: 'starter'  },
  { href: '/dashboard/settings',     key: 'nav_settings',     min: 'starter' },
  { href: '/dashboard/payments',     key: 'nav_payments',     min: 'starter', owner: true },
];

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { canAccess, isAdmin, role } = usePlan();

  return (
    <aside className="sb" aria-label="ניווט">
      <div className="sb-logo">
        <div className="sb-word">ONYX</div>
        <div className="sb-sub">{t('brand_sub')}</div>
      </div>

      <nav className="sb-nav">
        {NAV.filter(item => !item.owner || isAdmin).map(({ href, key, min, child }) => {
          const locked = !canAccess(min);
          const active = !locked && (pathname === href || (href !== '/dashboard' && pathname.startsWith(href)));
          return (
            <Link
              key={href}
              href={locked ? '/checkout' : href}
              title={locked ? t('nav_locked_hint') : undefined}
              className={`sb-item${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}${child ? ' is-child' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="sb-dot" aria-hidden />
              <span className="sb-label">{t(key)}</span>
              {locked && <span className="sb-lock"><LockIcon /></span>}
            </Link>
          );
        })}
      </nav>

      {/* The account block. The avatar is Clerk's own button so the menu —
          sign out, manage account — is still one click away; the design's
          gradient ring and the plan line sit around it. */}
      <div className="sb-account">
        {CLERK_ENABLED && <span className="sb-avatar"><UserButton /></span>}
        <span className="sb-account-text">
          <span className="sb-account-k">{t('sys_account')}</span>
          <span className="sb-account-plan">{role.toUpperCase()}</span>
        </span>
      </div>
    </aside>
  );
}
