'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton, useAuth } from '@clerk/nextjs';
import { useMarketingLang } from './LangProvider';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const NAV_LINKS = [
  { he: "פיצ'רים",     href: '/features' },
  { he: 'ביצועים',     href: '/performance' },
  { he: 'מנוי',        href: '/pricing' },
] as const;

function GuestControls() {
  return (
    <>
      <Link href="/sign-in" className="btn-ghost" style={{ padding: '8px 14px' } as React.CSSProperties}>
        התחברות
      </Link>
      <Link href="/pricing" className="btn-gold max-[900px]:px-5 max-[900px]:py-[9px]">
        לרכישת מנוי
      </Link>
    </>
  );
}

/** Clerk v7 dropped the <SignedIn>/<SignedOut> wrappers in favour of
 *  resource-based checks, so the two states are chosen here.
 *
 *  This lives in its own component because useAuth() throws outside a
 *  <ClerkProvider>, and the root layout only mounts the provider once a
 *  publishable key exists. A hook cannot be called conditionally — a
 *  conditionally MOUNTED component can. Until Clerk resolves, `isSignedIn` is
 *  undefined and the guest controls show, which is the right guess on a public
 *  page. */
function AuthControls() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <GuestControls />;
  return (
    <>
      <Link href="/dashboard" className="btn-gold max-[900px]:px-5 max-[900px]:py-[9px]">
        כניסה למערכת
      </Link>
      <UserButton />
    </>
  );
}

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
        {/* Two states. A signed-in visitor is offered the way in and their own
            account; pitching a subscription to someone who already holds one
            is the product failing to recognise them. */}
        <div className="flex items-center gap-[10px] shrink-0 max-[900px]:basis-full max-[900px]:justify-center max-[900px]:flex-wrap">
          {CLERK_ENABLED ? <AuthControls /> : <GuestControls />}
        </div>
      </div>
    </nav>
  );
}
