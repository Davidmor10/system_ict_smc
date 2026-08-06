'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TIERS, PricingCards } from '../components/Pricing';
import LegalDisclaimer from '../components/LegalDisclaimer';
import { useLanguage } from '../hooks/useLanguage';

/** Wrapped in Suspense because useSearchParams() forces the tree into
    dynamic rendering under Next 16 — without the wrapper, the whole
    checkout page CSR-bails at the marketing edge. */
export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutInner />
    </Suspense>
  );
}

function CheckoutInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  // Pre-select from ?plan=... — the marketing /pricing page links here with
  // ?plan=pro / ?plan=deluxe. Falls back to 'pro' (the intended default).
  const planParam = searchParams.get('plan');
  const initialTier = planParam && TIERS.some(t => t.id === planParam) ? planParam : 'pro';
  const [selected, setSelected] = useState<string>(initialTier);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const tier = TIERS.find(tr => tr.id === selected) ?? TIERS[0];

  // Start a real Stripe Checkout session; fall back to the demo confirmation
  // whenever Stripe isn't configured yet or the request fails.
  async function startCheckout() {
    setLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url as string;
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-[#000000] text-white flex flex-col">

      {/* Header */}
      <header className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-[#1c1c1e] bg-[#0d0d0f] shrink-0">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="font-serif text-lg font-bold tracking-[0.06em] text-white" style={{ fontStyle: 'normal' }}>Onyx</span>
          <span className="font-mono text-[10px] font-bold tracking-[0.34em] text-[#d4af37] uppercase">Trading</span>
        </Link>
        <Link href="/" dir="rtl" className="text-sm font-bold font-mono text-white/55 uppercase tracking-[0.18em] hover:text-[#d4af37] transition-colors duration-500">
          → חזרה לדף הבית
        </Link>
      </header>

      {/* Body */}
      <section className="relative flex-1 px-6 py-16 md:py-20" dir="rtl">
        <div
          className="absolute inset-0 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(55% 50% at 50% 30%, rgba(212,175,55,0.10), transparent 60%)' }}
        />

        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="text-sm font-bold font-mono text-[#d4af37] uppercase tracking-[0.3em]">Checkout</span>
          <h1 className="font-serif text-[clamp(2rem,5.5vw,3.5rem)] font-bold text-white leading-tight mt-3">
            שדרוג המערכת
          </h1>
          <p className="mt-4 text-lg font-bold text-[#c0c0c0] leading-relaxed tracking-wide">
            בחר את המסלול שמתאים לך. גישה מיידית לכל הכלים של המוסדיים.
          </p>
        </div>

        {/* Selectable tiers */}
        <PricingCards selectedId={selected} onSelect={setSelected} />

        {/* Order summary + continue */}
        <div className="max-w-md mx-auto mt-10 rounded-xl border border-[#d4af37]/30 bg-[#0d0d0f] p-7 [box-shadow:0_0_60px_-18px_rgba(212,175,55,0.4)]" dir="rtl">
          <div className="flex items-center justify-between pb-4 border-b border-[#1c1c1e]">
            <span className="text-sm font-bold font-mono text-white/55 uppercase tracking-[0.2em]">המסלול שנבחר</span>
            <span className="font-serif text-lg font-bold text-[#d4af37]">{t(tier.nameKey)}</span>
          </div>
          <p className="text-base font-bold text-[#c0c0c0] leading-relaxed mt-4">{t(tier.subtitleKey)}</p>

          {submitted ? (
            <div className="mt-6 flex flex-col gap-4 text-center">
              <p className="text-base font-bold text-white leading-relaxed">
                מערכת התשלומים המאובטחת תיפתח בקרוב.<br />בינתיים, גישת ההדגמה המלאה פתוחה עבורך.
              </p>
              <Link
                href="/dashboard"
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-sm bg-[#d4af37] text-black font-serif text-base font-bold [box-shadow:0_0_36px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_56px_rgba(212,175,55,0.65)] transition-shadow duration-500"
              >
                כניסה לשולחן המסחר ←
              </Link>
            </div>
          ) : (
            <button
              onClick={startCheckout}
              disabled={loading}
              className="mt-6 flex items-center justify-center gap-2 w-full py-3.5 rounded-sm bg-[#d4af37] text-black font-serif text-base font-bold [box-shadow:0_0_36px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_56px_rgba(212,175,55,0.65)] transition-shadow duration-500 disabled:opacity-60 disabled:cursor-wait"
            >
              {loading ? 'מעבד…' : 'המשך לתשלום מאובטח ←'}
            </button>
          )}

          <p className="mt-4 text-center text-xs font-bold font-mono text-white/35 uppercase tracking-[0.18em]">
            תשלום מאובטח · ביטול בכל עת
          </p>
        </div>
      </section>

      {/* Legal disclaimer */}
      <LegalDisclaimer />
    </main>
  );
}
