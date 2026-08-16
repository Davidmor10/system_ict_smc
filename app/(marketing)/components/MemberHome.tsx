'use client';

import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import './landing.css';

// ─────────────────────────────────────────────────────────────────────────────
// MemberHome — what "/" shows once you are signed in.
//
// Nothing here sells. A person who already pays does not need the pitch, and
// showing it to them reads as the product not knowing who they are. This page
// answers three things and stops: who am I signed in as, what plan do I have,
// and how do I get in or out.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';

const PLAN_LABEL: Record<string, string> = {
  free: 'FREE', starter: 'STARTER', pro: 'PRO', deluxe: 'DELUXE',
};

/** Only the destinations this plan can actually open. A tile that bounces the
 *  trader to /checkout is an advert wearing a shortcut's clothes. */
const LINKS: Array<{ href: string; t: string; b: string; min: string }> = [
  { href: '/dashboard',              t: 'דשבורד',        b: 'התובנה של היום והלוח החודשי', min: 'free' },
  { href: '/dashboard/journal',      t: 'יומן',           b: 'לתעד עסקה חדשה',              min: 'free' },
  { href: '/dashboard/stats',        t: 'סטטיסטיקה',      b: 'עקומת ההון והמספרים שלך',     min: 'deluxe' },
  { href: '/dashboard/ai-analytics', t: 'אנליטיקת AI',    b: 'דפוסים ודוח שבועי',           min: 'pro' },
  { href: '/dashboard/coach',        t: 'Onyx Trainer',   b: 'לשאול על המסחר שלך',          min: 'deluxe' },
  { href: '/dashboard/playbook',     t: 'סטאפים',         b: 'ספר הסטאפים והחוקים',         min: 'free' },
];

const RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, deluxe: 3 };

export default function MemberHome({ role }: { role: string }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const name = user?.firstName || user?.username || '';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();
  const open = LINKS.filter(l => RANK[role] >= RANK[l.min]);

  return (
    <div className="lp">
      <div className="lp-member">
        <div className="wrap">
          <div className="lp-member-card lp-in">

            <div className="lp-member-top">
              <div className="lp-avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : <span>{initial}</span>}
              </div>
              <div className="lp-member-who">
                <div className="lp-member-hi">
                  {/* Until Clerk resolves, greet without a name rather than
                      flashing a placeholder name that then changes. */}
                  {isLoaded && name ? `שלום, ${name}` : 'שלום'}
                </div>
                {email && <div className="lp-member-mail">{email}</div>}
              </div>
              <span className="lp-badge">{D} {PLAN_LABEL[role] ?? 'FREE'}</span>
            </div>

            <div className="lp-member-mid">
              <span className="lp-kicker">{D} אתה מחובר</span>
              <h2 className="lp-h2" style={{ fontSize: 'clamp(1.4rem, 2.6vw, 1.9rem)' }}>
                המערכת מחכה לך.
              </h2>
              <p className="lp-lead" style={{ fontSize: '0.96rem' }}>
                כל מה שתיעדת שמור. תיכנס להמשיך מאיפה שעצרת, או קפוץ ישר למקום שאתה צריך.
              </p>

              <div className="lp-cta" style={{ marginTop: 26 }}>
                <Link href="/dashboard" className="btn-lg-gold">כניסה למערכת</Link>
                <Link href="/dashboard/journal" className="btn-lg-ghost">לתעד עסקה</Link>
              </div>

              <div className="lp-member-links">
                {open.map(l => (
                  <Link className="lp-link" key={l.href} href={l.href}>
                    <i>{D}</i>
                    <b>{l.t}</b>
                    <span>{l.b}</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="lp-member-foot">
              <Link
                href="/dashboard/settings"
                style={{ fontSize: 13, color: 'var(--lp-ink-3)' }}
              >
                הגדרות חשבון
              </Link>
              <button
                type="button"
                className="lp-signout"
                onClick={() => signOut({ redirectUrl: '/' })}
              >
                התנתקות
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
