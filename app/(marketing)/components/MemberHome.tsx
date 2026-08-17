'use client';

import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import SplashIntro from '../../components/SplashIntro';
import './member.css';

// ─────────────────────────────────────────────────────────────────────────────
// MemberHome — what "/" shows once you are signed in.
//
// Nothing here sells. A person who already pays does not need the pitch, and
// showing it to them reads as the product not knowing who they are. The page
// answers three things and stops: who am I signed in as, where did I leave off,
// and where do I want to go.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';

/** Every tier is paid, so `free` means "signed in, no subscription yet". */
const NO_PLAN = 'free';

const PLAN_LABEL: Record<string, string> = {
  starter: 'STARTER', pro: 'PRO', deluxe: 'DELUXE',
};

const RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, deluxe: 3 };

/** The destinations, with the plan each one actually needs.
 *
 *  Gated against the same ranks the dashboard enforces: a card that bounces the
 *  trader to /checkout is an advert wearing a shortcut's clothes, and this page
 *  does not sell. The numbering is applied AFTER filtering, so a Starter member
 *  reads 01·02·03 rather than 01·02·04 with a hole where Statistics would be. */
const DESTINATIONS: Array<{ href: string; title: string; desc: string; min: string }> = [
  { href: '/dashboard',         title: 'דשבורד',     desc: 'התובנה של היום והלוח החודשי',      min: 'starter' },
  { href: '/dashboard/journal', title: 'יומן',        desc: 'לתעד עסקה חדשה',                   min: 'starter' },
  { href: '/dashboard/stats',   title: 'סטטיסטיקה',   desc: 'עקומת ההון והמספרים שלך',          min: 'deluxe'  },
  { href: '/dashboard/reports', title: 'מאקרו',       desc: 'אירועים וחדשות שמזיזים את השוק',   min: 'starter' },
];

/** Where "continue where you left off" points.
 *
 *  There is no per-user "last visited" record yet, so this is the journal — the
 *  one destination a returning trader almost always wants. Kept as a named
 *  constant rather than inlined so the day that record exists, this is the only
 *  line that changes. */
const CONTINUE = { href: '/dashboard/journal', title: 'יומן — העסקה האחרונה שתיעדת' };

export default function MemberHome({ role, splashScope }: { role: string; splashScope?: string }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const name = user?.firstName || user?.username || '';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();

  const member = role !== NO_PLAN;
  const open = DESTINATIONS.filter(d => (RANK[role] ?? 0) >= RANK[d.min]);

  return (
    <div className="me">
      {/* The brand moment belongs to the first screen of a visit, whichever
          screen that turns out to be. A member who goes straight here never
          passes the landing page, and would otherwise never see it. Behind the
          login the scope is the Clerk session id, so it plays once per sign-in
          — member → dashboard is one visit, signing out and back in is a new
          one. */}
      <SplashIntro scope={splashScope} />

      <header className="me-head">
        <div className="me-mark">
          <span className="me-mark-a">Onyx</span>
          <span className="me-mark-b">TRADING</span>
        </div>

        <div className="me-head-right">
          <span className="me-plan" data-off={!member}>
            {D} {member ? PLAN_LABEL[role] ?? role.toUpperCase() : 'אין מנוי'}
          </span>
          {email && <span className="me-email" title={email}>{email}</span>}
          <span className="me-avatar">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : <span>{initial}</span>}
          </span>
        </div>
      </header>

      <section className="me-hero">
        <div className="me-hero-wash" aria-hidden />
        <div className="me-hero-grid" aria-hidden />

        <div className="me-hero-in">
          <span className="me-kicker">{D} {member ? 'אתה מחובר' : 'החשבון שלך מוכן'}</span>

          {/* Until Clerk resolves, greet without a name rather than flashing a
              placeholder that then changes under the reader. */}
          <h1 className="me-h1">
            {isLoaded && name ? `שלום, ${name}.` : 'שלום.'}
            <br />
            <span>{member ? 'המערכת מחכה לך.' : 'נשאר לבחור מסלול.'}</span>
          </h1>

          <p className="me-lead">
            {member
              ? 'כל מה שתיעדת שמור. תיכנס להמשיך מאיפה שעצרת, או קפוץ ישר למקום שאתה צריך.'
              : 'ההרשמה הושלמה, אבל עדיין אין מנוי פעיל על החשבון. בחר מסלול והמערכת נפתחת מיד.'}
          </p>

          <div className="me-cta">
            {member ? (
              <>
                <Link href="/dashboard" className="me-btn me-btn-primary">כניסה למערכת ←</Link>
                <Link href="/dashboard/journal" className="me-btn me-btn-secondary">לתעד עסקה</Link>
              </>
            ) : (
              <>
                <Link href="/pricing" className="me-btn me-btn-primary">בחירת מסלול ←</Link>
                <Link href="/checkout" className="me-btn me-btn-secondary">להשלמת התשלום</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {member && (
        <div className="me-continue-pad">
          <Link href={CONTINUE.href} className="me-continue">
            <span className="me-continue-txt">
              <span className="me-continue-kick">{D} המשך מאיפה שעצרת</span>
              <span className="me-continue-title">{CONTINUE.title}</span>
            </span>
            <span className="me-continue-arrow" aria-hidden>←</span>
          </Link>
        </div>
      )}

      {/* No destinations without a subscription — every one of them is gated,
          and offering a door the gate closes is worse than offering none. */}
      {member && open.length > 0 && (
        <div className="me-grid-pad">
          <div className="me-grid">
            {open.map((d, i) => (
              <Link key={d.href} href={d.href} className="me-dest">
                <span className="me-dest-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="me-dest-t">{d.title}</span>
                <span className="me-dest-d">{d.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <footer className="me-foot">
        <span className="me-disclaimer">מסחר כולל סיכון · הכלים לשימוש לימודי בלבד</span>
        <span className="me-foot-right">
          {member && <Link href="/dashboard/settings" className="me-foot-link">הגדרות חשבון</Link>}
          <button type="button" className="me-signout" onClick={() => signOut({ redirectUrl: '/' })}>
            התנתקות
          </button>
        </span>
      </footer>
    </div>
  );
}
