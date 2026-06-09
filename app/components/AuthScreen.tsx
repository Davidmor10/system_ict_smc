'use client';

import { SignIn, SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { clerkAppearance } from '../lib/clerkAppearance';

const ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function NotConfigured() {
  return (
    <div className="max-w-md text-center rounded-xl border border-[#d4af37]/40 bg-[#0d0d0f] p-10 [box-shadow:0_0_60px_-18px_rgba(212,175,55,0.4)]" dir="rtl">
      <span className="text-[#d4af37] text-4xl">◈</span>
      <h2 className="mt-5 font-serif text-xl font-bold text-white leading-relaxed">מערכת ההזדהות בהקמה</h2>
      <p className="mt-3 text-sm font-bold text-white/55 leading-relaxed">
        חיבור Clerk עדיין לא הוגדר. הוסף את מפתחות ה-API בקובץ <span className="text-[#d4af37]">.env.local</span> כדי להפעיל את ההרשמה וההתחברות.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-sm bg-[#d4af37] text-black font-serif text-base font-bold [box-shadow:0_0_30px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_50px_rgba(212,175,55,0.6)] transition-shadow duration-500"
      >
        כניסה לדמו ←
      </Link>
    </div>
  );
}

export default function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <main className="min-h-screen bg-[#000000] flex flex-col items-center justify-center px-6 py-16">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 50% 35%, rgba(212,175,55,0.08), transparent 60%)' }}
        aria-hidden
      />

      <Link href="/" className="relative mb-10 flex items-baseline gap-2.5">
        <span className="font-serif text-2xl font-bold text-white tracking-[0.04em]">Onyx</span>
        <span className="font-mono text-xs font-bold tracking-[0.34em] text-[#d4af37] uppercase">Trading</span>
      </Link>

      <div className="relative">
        {ENABLED ? (
          mode === 'sign-in' ? (
            <SignIn appearance={clerkAppearance} signUpUrl="/sign-up" forceRedirectUrl="/dashboard" />
          ) : (
            <SignUp appearance={clerkAppearance} signInUrl="/sign-in" forceRedirectUrl="/dashboard" />
          )
        ) : (
          <NotConfigured />
        )}
      </div>
    </main>
  );
}
