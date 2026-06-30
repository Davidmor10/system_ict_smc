'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';

// Fixed top navigation for the landing page. Auth entry points sit top-right
// and are visible immediately (no scrolling). Background transitions from
// transparent to solid Onyx as the user scrolls past the gate.
//
// Renders Clerk components, so it must live inside <ClerkProvider> — the
// landing page only mounts it when Clerk is configured.
export default function Header() {
  const { isLoaded, isSignedIn } = useAuth();
  const { t, toggle } = useLanguage();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const ghost =
    'px-5 py-2 rounded-xl border border-[#d4af37]/50 text-[#d4af37] font-mono text-xs font-bold uppercase tracking-[0.18em] hover:bg-[#d4af37]/10 hover:border-[#d4af37] transition-all duration-200';
  const solid =
    'px-5 py-2 rounded-xl bg-[#d4af37] text-black font-mono text-xs font-bold uppercase tracking-[0.18em] [box-shadow:0_0_24px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_40px_rgba(212,175,55,0.65)] transition-all duration-200';

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-200 ${
        scrolled
          ? 'bg-[#0d0d0f] border-b border-[#1c1c1e] [box-shadow:0_8px_30px_-12px_rgba(0,0,0,0.85)]'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="flex items-center justify-between h-16 px-6 md:px-10">
        {/* Branding (unchanged Onyx wordmark) */}
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="font-serif text-lg font-bold tracking-[0.06em] text-white" style={{ fontStyle: 'normal' }}>
            Onyx
          </span>
          <span className="font-mono text-[10px] font-bold tracking-[0.34em] text-[#d4af37] uppercase">Trading</span>
        </Link>

        {/* Language toggle + auth entry */}
        <nav className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label="Toggle language"
            className="px-2.5 py-1.5 rounded-xl border border-[#1c1c1e] text-white/60 font-mono text-xs font-bold uppercase tracking-[0.18em] hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-all duration-200"
          >
            {t('lang_other')}
          </button>
          {!isLoaded ? null : isSignedIn ? (
            <Link href="/dashboard" className={solid}>
              <span className="hidden sm:inline">{t('hdr_workspace')} </span>←
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={`${ghost} hidden sm:inline-flex`}>
                {t('hdr_signin')}
              </Link>
              <Link href="/sign-up" className={solid}>
                {t('hdr_signup')}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
