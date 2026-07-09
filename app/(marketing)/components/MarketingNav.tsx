'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMarketingLang } from './LangProvider';

const NAV_LINKS = [
  { he: "פיצ'רים",     href: '/features' },
  { he: 'ביצועים',     href: '/performance' },
  { he: 'מנוי',        href: '/pricing' },
] as const;

export default function MarketingNav() {
  useMarketingLang();
  const pathname = usePathname();

  return (
    <nav
      dir="rtl"
      className="sticky top-0 z-50 border-b border-[var(--border)]"
      style={{
        background: 'rgba(5,5,5,.82)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div
        className="wrap flex items-center justify-between relative max-[900px]:flex-wrap max-[900px]:justify-center max-[900px]:gap-y-[13px] max-[900px]:px-5 max-[900px]:py-[14px] max-[900px]:h-auto"
        style={{ height: 68 }}
      >

        {/* ── Logo → home ──────────────────────────────────────── */}
        <Link href="/" className="flex flex-col leading-none shrink-0" style={{ gap: 3 }}>
          <span
            className="text-white leading-none"
            style={{ fontFamily: 'var(--serif)', fontSize: 23, fontWeight: 800 }}
          >
            Onyx
          </span>
          <span
            className="text-[var(--gold)] leading-none uppercase"
            style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.34em' }}
          >
            Trading
          </span>
        </Link>

        {/* ── Center nav links (hidden ≤ 900px) ────────────────── */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden min-[900px]:flex items-center gap-8">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link${pathname === link.href ? ' active' : ''}`}
            >
              {link.he}
            </Link>
          ))}
        </div>

        {/* ── Controls ─────────────────────────────────────────── */}
        <div className="flex items-center gap-[10px] shrink-0 max-[900px]:basis-full max-[900px]:justify-center max-[900px]:flex-wrap">

          {/* Sign in — visible on all screen sizes */}
          <Link
            href="/sign-in"
            className="btn-ghost"
            style={{ padding: '8px 14px' } as React.CSSProperties}
          >
            התחברות
          </Link>

          {/* Subscribe CTA */}
          <Link
            href="/pricing"
            className="btn-gold max-[900px]:px-5 max-[900px]:py-[9px]"
          >
            לרכישת מנוי
          </Link>
        </div>
      </div>
    </nav>
  );
}
