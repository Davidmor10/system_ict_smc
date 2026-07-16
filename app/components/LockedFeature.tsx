// ─────────────────────────────────────────────────────────────────────────────
// Server component — wraps a Deluxe-only page's real content for a `free` user:
// renders it blurred and non-interactive underneath a centered upgrade overlay,
// instead of redirecting them away before they ever see what they're missing.
// `pro`/`deluxe` never reach this component (see the route-segment layouts).
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';

const GOLD = '#d4af37';
const BORDER = '#1c1c1e';

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export default function LockedFeature({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    // `relative` is scoped to this subtree only (the route's own content pane) —
    // the overlay below is `absolute` to it, never `fixed` to the viewport, so
    // the persistent Sidebar/MobileNav outside this component stay fully
    // clickable for a `free` user browsing the rest of the app.
    <div className="relative min-h-full">
      <div aria-hidden style={{ filter: 'blur(7px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.5 }}>
        {children}
      </div>

      <div className="absolute inset-0 z-10 flex justify-center px-6 pointer-events-none" style={{ paddingTop: '14vh' }}>
        <div
          className="pointer-events-auto flex flex-col items-center text-center gap-4 max-w-[440px] h-fit px-8 py-10 rounded-xl"
          style={{ background: '#0d0d0f', border: `1px solid ${BORDER}`, boxShadow: '0 24px 80px -20px rgba(0,0,0,0.6), 0 0 60px -20px rgba(212,175,55,0.25)' }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(212,175,55,0.08)', border: `1px solid rgba(212,175,55,0.3)`, boxShadow: '0 0 30px -8px rgba(212,175,55,0.4)' }}
          >
            <LockIcon />
          </div>
          <h2 className="m-0" style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>
            {title}
          </h2>
          <p className="m-0 text-[14px] leading-relaxed" style={{ color: '#c0c0c0' }}>
            {description}
          </p>
          <Link
            href="/checkout"
            className="mt-2 px-6 py-3 rounded-sm font-mono text-xs font-bold uppercase tracking-[0.14em] transition-colors"
            style={{ background: GOLD, color: '#000', boxShadow: '0 0 36px rgba(212,175,55,0.4)' }}
          >
            שדרוג ל-Deluxe ←
          </Link>
        </div>
      </div>
    </div>
  );
}
