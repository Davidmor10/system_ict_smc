'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMarketingLang } from './LangProvider';

const NAV_LINKS = [
  { he: 'מנוע הפרקטל', en: 'Fractal Engine', href: '/fractal-engine' },
  { he: "פיצ'רים",     en: 'Features',       href: '/features' },
  { he: 'ביצועים',     en: 'Performance',    href: '/performance' },
  { he: 'מנוי',        en: 'Pricing',        href: '/pricing' },
] as const;

export default function MarketingNav() {
  const { lang, setLang } = useMarketingLang();
  const pathname = usePathname();
  const rtl = lang === 'he';

  return (
    <nav
      dir={rtl ? 'rtl' : 'ltr'}
      className="sticky top-0 z-50 border-b border-[var(--border)]"
      style={{
        height: 68,
        background: 'rgba(5,5,5,.82)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div className="wrap flex items-center justify-between relative" style={{ height: 68 }}>

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
              {lang === 'he' ? link.he : link.en}
            </Link>
          ))}
        </div>

        {/* ── Controls ─────────────────────────────────────────── */}
        <div className="flex items-center gap-3 shrink-0">

          {/* Language toggle pill */}
          <div
            className="flex rounded-full overflow-hidden border border-[var(--border2)]"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}
          >
            {(['he', 'en'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="px-3 py-1 uppercase tracking-[.12em] transition-colors duration-200"
                style={{
                  background: lang === l ? 'var(--gold)' : 'transparent',
                  color:      lang === l ? '#000'        : 'rgba(255,255,255,.55)',
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Sign in */}
          <Link href="/sign-in" className="btn-ghost hidden min-[900px]:inline-flex">
            {lang === 'he' ? 'התחברות' : 'Sign In'}
          </Link>

          {/* Subscribe CTA */}
          <Link href="/pricing" className="btn-gold">
            {lang === 'he' ? 'לרכישת מנוי' : 'Subscribe'}
          </Link>
        </div>
      </div>
    </nav>
  );
}
