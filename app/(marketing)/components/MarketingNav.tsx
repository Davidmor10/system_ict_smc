'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserButton, useAuth } from '@clerk/nextjs';
import { useMarketingLang } from './LangProvider';
import './nav.css';

// ─────────────────────────────────────────────────────────────────────────────
// The marketing bar — one bar for every public page.
//
// It used to stand down on /pricing, which had a header of its own. The result
// was that walking from /performance into /pricing felt like leaving the site:
// a second lockup, a second "כניסה למערכת", and no way back. There is one bar
// now, and the pages carry content only.
//
// Two links, not three. The landing page already tours the product surface by
// surface, so a "פיצ'רים" tab said the same thing a third time.
// ─────────────────────────────────────────────────────────────────────────────

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const NAV_LINKS = [
  { he: 'ביצועים', href: '/performance' },
  { he: 'מנוי',    href: '/pricing' },
] as const;

function GuestControls() {
  return (
    <>
      <Link href="/sign-in" className="mn-quiet">התחברות</Link>
      <span className="mn-sep" aria-hidden />
      <Link href="/pricing" className="mn-cta">לרכישת מנוי</Link>
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
      <Link href="/dashboard" className="mn-cta">כניסה למערכת</Link>
      <UserButton />
    </>
  );
}

export default function MarketingNav() {
  useMarketingLang();
  const pathname = usePathname();

  // Lifted = the page has been scrolled, so the bar is sitting on content
  // rather than floating on the hero. It tightens, the ground goes opaque, and
  // the gold thread along the bottom edge fades in. At rest there is no edge at
  // all, which is what keeps it from reading as a toolbar.
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav dir="rtl" className="mn" data-lifted={lifted}>
      <div className="mn-in">
        {/* dir=ltr: the lockup is Latin and must read Onyx → TRADING. Left in
            the page's RTL flow it renders in the other order. */}
        <Link href="/" className="mn-mark" dir="ltr" aria-label="Onyx Trading">
          <span className="mn-mark-a">Onyx</span>
          <span className="mn-mark-b">TRADING</span>
        </Link>

        <div className="mn-links">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="mn-link"
              data-active={pathname === link.href}
              aria-current={pathname === link.href ? 'page' : undefined}
            >
              {link.he}
            </Link>
          ))}
        </div>

        {/* Two states. A signed-in visitor is offered the way in and their own
            account; pitching a subscription to someone who already holds one is
            the product failing to recognise them. */}
        <div className="mn-right">
          {CLERK_ENABLED ? <AuthControls /> : <GuestControls />}
        </div>
      </div>
    </nav>
  );
}
