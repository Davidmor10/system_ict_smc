'use client';

import { SignIn, SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { clerkAppearance } from '../lib/clerkAppearance';
import { useLanguage } from '../hooks/useLanguage';

const ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function NotConfigured({ he }: { he: boolean }) {
  return (
    <div
      className="max-w-md text-center rounded-xl border border-[#d4af37]/40 bg-[#0d0d0f] p-10 [box-shadow:0_0_60px_-18px_rgba(212,175,55,0.4)]"
      dir={he ? 'rtl' : 'ltr'}
    >
      <span className="text-[#d4af37] text-4xl">◈</span>
      <h2 className="mt-5 font-serif text-xl font-bold text-white leading-relaxed">
        {he ? 'מערכת ההזדהות בהקמה' : 'Authentication Not Configured'}
      </h2>
      <p className="mt-3 text-sm font-bold text-white/55 leading-relaxed">
        {he ? (
          <>חיבור Clerk עדיין לא הוגדר. הוסף את מפתחות ה-API בקובץ <span className="text-[#d4af37]">.env.local</span> כדי להפעיל את ההרשמה וההתחברות.</>
        ) : (
          <>Clerk not yet configured. Add API keys to <span className="text-[#d4af37]">.env.local</span> to enable authentication.</>
        )}
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-sm bg-[#d4af37] text-black font-serif text-base font-bold [box-shadow:0_0_30px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_50px_rgba(212,175,55,0.6)] transition-shadow duration-500"
      >
        {he ? 'כניסה לדמו ←' : '→ Enter Demo'}
      </Link>
    </div>
  );
}

const FEATURES = {
  he: ['מנוע ביאס · ICT / SMC', 'ציר סשנים חי', 'יומן וניתוח קצה'],
  en: ['Bias Engine · ICT / SMC', 'Live Session Timeline', 'Journal & Edge Analytics'],
};

export default function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { lang } = useLanguage();
  const he = lang === 'he';
  const dir = he ? 'rtl' : 'ltr';

  const heading = mode === 'sign-in'
    ? (he ? 'כניסה ל-Onyx' : 'Sign in to Onyx')
    : (he ? 'צור חשבון Onyx' : 'Create your Onyx account');

  const subheading = mode === 'sign-in'
    ? (he ? 'ברוך שובך — התחבר כדי להמשיך' : 'Welcome back — sign in to continue')
    : (he ? 'הצטרף למערכת המסחר המוסדית' : 'Join the institutional trading terminal');

  return (
    <main
      className="min-h-screen bg-[#050505] grid grid-cols-1 min-[881px]:grid-cols-[1.05fr_0.95fr]"
      dir={dir}
    >
      {/* ── LEFT · brand panel (hidden on mobile) ── */}
      <section className="relative hidden min-[881px]:flex flex-col justify-between overflow-hidden border-e border-[#1c1c1e] px-[72px] pt-16 pb-11 bg-[linear-gradient(155deg,#0b0b0c_0%,#070708_60%,#050505_100%)]">
        {/* gold radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(circle at 26% 30%, rgba(212,175,55,0.11), transparent 55%)' }}
          aria-hidden
        />
        {/* hairline grid texture, masked */}
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          aria-hidden
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)',
            backgroundSize: '64px 64px',
            WebkitMaskImage: 'radial-gradient(circle at 30% 50%, #000, transparent 78%)',
            maskImage: 'radial-gradient(circle at 30% 50%, #000, transparent 78%)',
          }}
        />

        {/* wordmark */}
        <Link href="/" className="relative z-10 flex items-baseline gap-[11px]">
          <span className="font-serif text-[30px] font-extrabold tracking-[0.04em] text-white">Onyx</span>
          <span className="font-mono text-xs font-bold uppercase tracking-[0.36em] text-[#d4af37]">Trading</span>
        </Link>

        {/* lead copy */}
        <div className="relative z-10">
          <h1 className="font-serif text-[52px] font-bold leading-[1.1] tracking-[0.01em] text-white">
            {he ? (
              <>סחר לפי המודל.<br />לא לפי <span className="text-[#d4af37]">הרעש.</span></>
            ) : (
              <>Trade the model.<br />Not the <span className="text-[#d4af37]">noise.</span></>
            )}
          </h1>
          <p className="mt-6 max-w-[380px] font-mono text-[13.5px] font-medium leading-[1.8] tracking-[0.02em] text-white/[0.46]">
            {he
              ? 'מסוף מסחר מוסדי לחוזי ES ו-NQ — ביאס יומי המנוקד מול מודל הכניסה שלך, ציר סשנים חי, ויומן שמראה מה באמת עובד.'
              : 'An institutional trading terminal for ES & NQ futures — a daily bias scored against your own entry model, a live session timeline, and a journal that tells you what actually works.'}
          </p>

          {/* feature rows */}
          <div className="mt-[46px] border-t border-[#1c1c1e]">
            {FEATURES[he ? 'he' : 'en'].map(f => (
              <div key={f} className="flex items-center gap-[14px] border-b border-[#1c1c1e] py-[17px] px-0.5">
                <span className="shrink-0 text-xs text-[#d4af37]">◈</span>
                <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white/[0.78]">{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ticker */}
        <div className="relative z-10 flex items-center gap-[11px] font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
          <span className="h-[7px] w-[7px] rounded-full bg-[#6fa580] [box-shadow:0_0_9px_#6fa580]" />
          <span>{he ? 'מערכת פעילה' : 'System Live'}</span>
          <span className="text-[#52525b]">·</span><span>CME</span>
          <span className="text-[#52525b]">·</span><span>ES</span>
          <span className="text-[#52525b]">·</span><span>NQ</span>
          <span className="text-[#52525b]">·</span><span>Real-Time</span>
        </div>
      </section>

      {/* ── RIGHT · auth card ── */}
      <section className="flex items-center justify-center px-6 py-16 sm:px-20 bg-[#050505] max-[880px]:pb-[calc(56px+env(safe-area-inset-bottom,0px))]">
        <div className="w-full max-w-[392px]">
          {/* mobile-only wordmark */}
          <Link href="/" className="min-[881px]:hidden mb-10 flex items-baseline justify-center gap-[11px]">
            <span className="font-serif text-[25px] font-extrabold tracking-[0.04em] text-white">Onyx</span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.34em] text-[#d4af37]">Trading</span>
          </Link>

          {/* custom bilingual heading (Clerk's own header is hidden via appearance) */}
          <div className="mb-[34px] text-center">
            <h2 className="font-serif text-[30px] max-[880px]:text-[26px] font-bold tracking-[0.02em] text-white">{heading}</h2>
            <p className="font-mono text-[12px] max-[880px]:text-[12.5px] font-medium tracking-[0.04em] text-white/45 mt-[11px]">{subheading}</p>
          </div>

          {ENABLED ? (
            mode === 'sign-in' ? (
              <SignIn appearance={clerkAppearance} signUpUrl="/sign-up" forceRedirectUrl="/dashboard" />
            ) : (
              <SignUp appearance={clerkAppearance} signInUrl="/sign-in" forceRedirectUrl="/dashboard" />
            )
          ) : (
            <NotConfigured he={he} />
          )}
        </div>
      </section>
    </main>
  );
}
