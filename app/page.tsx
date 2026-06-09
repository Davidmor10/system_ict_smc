'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PricingCards } from './components/Pricing';
import LegalDisclaimer from './components/LegalDisclaimer';

// ─── Helpers ────────────────────────────────────────────────────────────────
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

// Scroll progress (rAF-throttled). Used only for the gate + dock; clarity of
// content is driven by reveal-on-enter so it never sticks mid-blur.
function useScroll() {
  const [s, setS] = useState({ y: 0, vh: 1 });
  useEffect(() => {
    let raf = 0;
    const update = () => { raf = 0; setS({ y: window.scrollY, vh: window.innerHeight || 1 }); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return s;
}

// One-way reveal: once on screen it resolves to a razor-sharp state and stays.
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  const [ref, shown] = useReveal();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0 blur-0' : 'opacity-0 translate-y-6 blur-[6px]'} ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Static candle mock (deterministic — hydration-safe) ────────────────────
const CANDLES: { h: number; up: boolean }[] = [
  { h: 40, up: true }, { h: 54, up: true }, { h: 46, up: false }, { h: 62, up: true },
  { h: 72, up: true }, { h: 57, up: false }, { h: 80, up: true }, { h: 66, up: false },
  { h: 84, up: true }, { h: 75, up: false }, { h: 93, up: true }, { h: 87, up: true },
  { h: 70, up: false }, { h: 90, up: true }, { h: 97, up: true }, { h: 81, up: false },
];

function ChartMock({ symbol, sub }: { symbol: string; sub: string }) {
  return (
    <div className="w-full h-full bg-[#000000] border border-[#1c1c1e] rounded-sm p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="font-serif text-sm font-bold text-white tracking-wide">{symbol}</span>
        <span className="text-[10px] font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em]">{sub}</span>
      </div>
      <div className="flex-1 flex items-end gap-1 min-h-0">
        {CANDLES.map((c, i) => (
          <div key={i} className="flex-1 flex items-end">
            <div className={`w-full rounded-[1px] ${c.up ? 'bg-white' : 'bg-[#3a3a3d]'}`} style={{ height: `${c.h}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Live system preview (moody mock + golden glow + laser sweep) ───────────
const PREVIEW_NEWS: { t: string; e: string; hi: boolean }[] = [
  { t: '08:30', e: 'CPI', hi: true },
  { t: '10:00', e: 'ISM', hi: false },
  { t: '14:00', e: 'FOMC', hi: true },
  { t: '08:30', e: 'PPI', hi: false },
];

function LivePreview() {
  const [ref, shown] = useReveal();
  return (
    <div ref={ref} className="relative mx-auto w-[min(94vw,1120px)]">
      {/* Deeply embedded golden glow */}
      <div
        className="absolute -inset-16 -z-10 rounded-[40px] blur-[90px] opacity-70"
        style={{ background: 'radial-gradient(50% 50% at 50% 45%, rgba(212,175,55,0.22), transparent 70%)' }}
        aria-hidden
      />

      <div
        className={`relative rounded-xl border border-[#1c1c1e] bg-[#050505] overflow-hidden shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0 blur-0' : 'opacity-0 translate-y-8 blur-[10px]'}`}
      >
        {/* Window chrome */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1c1c1e] bg-[#0d0d0f]">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#2a2a2d]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#2a2a2d]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#2a2a2d]" />
          </div>
          <span className="font-serif text-xs font-bold tracking-[0.2em] text-white/70 uppercase">Onyx Trading · Workspace</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#d4af37]" />
            <span className="text-[10px] font-bold font-mono text-[#d4af37] uppercase tracking-[0.2em]">Live</span>
          </span>
        </div>

        {/* Ticker */}
        <div className="flex items-center gap-6 px-5 py-3 border-b border-[#1c1c1e] bg-[#0d0d0f]">
          {[{ s: 'ES · S&P 500', p: '7,549.50', c: '+12.25' }, { s: 'NQ · Nasdaq', p: '20,078.50', c: '+48.75' }].map(q => (
            <div key={q.s} className="flex items-baseline gap-2.5">
              <span className="text-[10px] font-bold font-mono text-white/60 uppercase tracking-[0.2em]">{q.s}</span>
              <span className="text-lg font-bold font-mono text-white tabular-nums">{q.p}</span>
              <span className="text-xs font-bold font-mono text-bullish tabular-nums">{q.c}</span>
            </div>
          ))}
        </div>

        {/* Workspace body: macro rail + dual charts */}
        <div className="grid grid-cols-[130px_1fr_1fr] h-[clamp(240px,38vh,360px)]">
          <div className="border-r border-[#1c1c1e] bg-[#0d0d0f] p-3 flex flex-col gap-2.5" dir="rtl">
            <span className="text-[10px] font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em]">חדשות היום</span>
            {PREVIEW_NEWS.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${n.hi ? 'bg-bearish' : 'bg-[#d4af37]'}`} />
                <span className="text-xs font-bold font-mono text-[#d4af37] tabular-nums">{n.t}</span>
                <span className="text-xs font-bold font-mono text-white">{n.e}</span>
              </div>
            ))}
          </div>
          <div className="p-2.5 border-r border-[#1c1c1e]"><ChartMock symbol="ES" sub="S&P 500" /></div>
          <div className="p-2.5"><ChartMock symbol="NQ" sub="נאסד״ק" /></div>
        </div>

        {/* Matrix laser sweep (one-shot on reveal) */}
        {shown && <div className="laser-run absolute left-0 right-0 z-20 h-px bg-[#d4af37] [box-shadow:0_0_22px_5px_rgba(212,175,55,0.6)] pointer-events-none" />}

        {/* Moody dark lighting overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(70% 50% at 50% -8%, rgba(212,175,55,0.10), transparent 60%),' +
              'radial-gradient(120% 120% at 50% 0%, transparent 42%, rgba(0,0,0,0.66) 100%),' +
              'linear-gradient(to bottom, rgba(0,0,0,0.30), rgba(0,0,0,0) 28%, rgba(0,0,0,0.50))',
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ─── Capabilities data ──────────────────────────────────────────────────────
const CAPABILITIES: { k: string; title: string; body: string }[] = [
  { k: '01', title: 'דיברגנס SMT', body: 'זיהוי דיברגנס בזמן אמת בין ES ל־NQ בנקודות שיא ושפל — אישור מוסדי להיפוכי מגמה.' },
  { k: '02', title: 'מבנה מולטי־טיים־פריים', body: 'ניתוח BOS · CHoCH · MSS על פני D1 · H4 · H1 ופריים הביצוע, מסונתז להטיה אחת נעולה.' },
  { k: '03', title: 'מערכי FVG', body: 'פערי הוגנות, אימבלנס, iFVG ונקודות Consequent Encroachment (50%) ממופים על הגרף החי.' },
  { k: '04', title: 'בלוקי הזמנות ונזילות', body: 'מיפוי Order Blocks, sweeps של נזילות ובריכות אינדיוסמנט בטווחי הזמן הגבוהים.' },
  { k: '05', title: 'הטיית מאקרו יומית', body: 'הטיה מוסדית נעולה לנרות H4 ו־D1 שנסגרו — ללא רעש טיק, רק מבנה מאומת.' },
  { k: '06', title: 'ניהול סיכונים מובנה', body: 'מחשבון גודל פוזיציה לפי מפרט CME, מסונכרן ישירות למחירי הלייב של ES ו־NQ.' },
];

const SPECS = ['ES', 'NQ', 'CME Futures', '5M → D1', 'Real-time Sync', 'עברית · English'];

// ─── Landing ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { y, vh } = useScroll();
  const gate = clamp(y / (vh * 0.6));          // Onyx Gate vanish (tight)
  const ctaScale = 1.18 - clamp(y / vh) * 0.30;

  return (
    <main className="relative bg-[#000000] text-white overflow-x-hidden">

      {/* ════ ACT I — The Onyx Gate ════ */}
      <section className="relative h-[140vh]">
        <div className="sticky top-0 h-screen flex flex-col items-center justify-center overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 50% 45%, rgba(212,175,55,0.12), transparent 60%)', opacity: clamp(1 - gate * 1.2) }}
          />
          <h1
            className="font-serif font-bold text-[clamp(2.6rem,9vw,8rem)] leading-none text-[#d4af37] text-center select-none [text-shadow:0_0_60px_rgba(212,175,55,0.4)] will-change-transform"
            style={{
              transform: `scale(${1 + gate * 1.6})`,
              opacity: clamp(1 - gate * 1.2),
              letterSpacing: `${0.06 + gate * 0.45}em`,
              filter: `blur(${gate * 5}px)`,
            }}
          >
            ONYX TRADING
          </h1>
          <div
            className="mt-7 flex flex-col items-center gap-3 text-center"
            style={{ opacity: clamp(1 - gate * 2.4), transform: `translateY(${gate * -36}px)` }}
            dir="rtl"
          >
            <p className="font-serif text-2xl md:text-3xl font-bold text-white tracking-wide">מנוע מיפוי השוק המוסדי</p>
            <p className="text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.3em]">נזילות · מבנה · דיוק</p>
          </div>
          <div className="absolute bottom-24 flex flex-col items-center gap-2" style={{ opacity: clamp(1 - gate * 3) }} dir="rtl">
            <span className="text-sm font-bold font-mono text-white/60 uppercase tracking-[0.25em]">גלול כדי להיכנס</span>
            <span className="text-[#d4af37] text-lg animate-bounce">↓</span>
          </div>
        </div>
      </section>

      {/* ════ ACT II — Live System Preview ════ */}
      <section className="relative px-6 py-16 md:py-20">
        <Reveal className="max-w-3xl mx-auto text-center mb-12" >
          <span className="inline-block mb-5 px-4 py-1.5 border border-[#1c1c1e] text-xs font-bold font-mono tracking-[0.3em] text-[#d4af37] uppercase">
            The Workspace
          </span>
          <h2 className="font-serif text-[clamp(1.8rem,4.5vw,3rem)] font-bold text-white leading-tight" dir="rtl">
            שולחן מסחר מוסדי. <span className="text-[#d4af37]">בזמן אמת.</span>
          </h2>
        </Reveal>
        <LivePreview />
      </section>

      {/* ════ ACT III — Core: Liquidity & Risk (solid, bold) ════ */}
      <section className="relative px-6 py-16 md:py-20 border-t border-[#1c1c1e]" dir="rtl">
        <div
          className="absolute inset-0 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(60% 60% at 50% 40%, rgba(212,175,55,0.07), transparent 60%)' }}
        />
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 md:gap-14">
          <Reveal>
            <h3 className="font-serif font-black leading-none text-[#d4af37] text-[clamp(3rem,8vw,6rem)] [text-shadow:0_0_40px_rgba(212,175,55,0.3)]">נזילות</h3>
            <p className="mt-5 text-lg font-bold text-[#c0c0c0] leading-relaxed tracking-wide">
              איתור ומיפוי אלגוריתמי של מניפולציות שוק, sweeps של נזילות מוסדית ונקודות עניין בטווחי זמן גבוהים (HTF).
            </p>
          </Reveal>
          <Reveal delay={120}>
            <h3 className="font-serif font-black leading-none text-white text-[clamp(3rem,8vw,6rem)] [text-shadow:0_0_30px_rgba(192,192,192,0.18)]">ניהול סיכונים</h3>
            <p className="mt-5 text-lg font-bold text-[#c0c0c0] leading-relaxed tracking-wide">
              מחשבון ניהול סיכונים מובנה המסתנכרן ישירות למחירי הלייב של בורסת שיקגו למניעת טעויות אנוש בגודל הפוזיציה.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ════ ACT IV — Capabilities density grid ════ */}
      <section className="relative px-6 py-16 md:py-20 border-t border-[#1c1c1e]" dir="rtl">
        <Reveal className="max-w-5xl mx-auto mb-10 text-center">
          <span className="text-sm font-bold font-mono text-[#d4af37] uppercase tracking-[0.3em]">Core Capabilities</span>
          <h2 className="font-serif text-[clamp(1.8rem,4.5vw,3rem)] font-bold text-white leading-tight mt-3">ארסנל מוסדי מלא</h2>
        </Reveal>
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-sm overflow-hidden">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.k} delay={(i % 3) * 90} className="h-full">
              <div className="h-full bg-[#000000] p-6 hover:bg-[#0d0d0f] transition-colors duration-500 group">
                <span className="block font-mono text-sm font-bold text-[#d4af37] tracking-[0.3em] mb-4">{c.k}</span>
                <h4 className="font-serif text-xl font-bold text-white mb-3 leading-tight group-hover:text-[#d4af37] transition-colors duration-500">{c.title}</h4>
                <p className="text-base font-bold text-[#c0c0c0] leading-relaxed tracking-wide">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Specs strip */}
        <Reveal className="max-w-5xl mx-auto mt-8">
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 px-5 py-4 border border-[#1c1c1e] rounded-sm bg-[#0d0d0f]" dir="ltr">
            {SPECS.map((s, i) => (
              <span key={s} className="flex items-center gap-5">
                <span className="text-sm font-bold font-mono text-white/80 uppercase tracking-[0.18em]">{s}</span>
                {i < SPECS.length - 1 && <span className="h-3 w-px bg-[#1c1c1e]" />}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ════ ACT V — Pricing tiers (checkout funnel) ════ */}
      <section className="relative px-6 py-20 md:py-24 border-t border-[#1c1c1e] pb-40" dir="rtl">
        <div
          className="absolute inset-0 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(55% 55% at 50% 40%, rgba(212,175,55,0.10), transparent 60%)' }}
        />
        <Reveal className="max-w-3xl mx-auto text-center mb-14">
          <h2 className="font-serif text-[clamp(2rem,6vw,4.5rem)] font-bold text-white leading-[1.1]">
            כל הקצה המוסדי.<br /><span className="text-[#d4af37]">במסך אחד.</span>
          </h2>
          <p className="mt-6 text-lg font-bold text-[#c0c0c0] leading-relaxed tracking-wide">
            בחר את המסלול שלך והתחל לסחור עם הכלים של המוסדיים.
          </p>
        </Reveal>

        <Reveal>
          <PricingCards ctaHref="/checkout" ctaLabel="לרכישת מנוי ושדרוג המערכת ←" />
        </Reveal>

        <div className="text-center mt-10">
          <Link href="/dashboard" className="text-sm font-bold font-mono text-white/55 uppercase tracking-[0.18em] hover:text-[#d4af37] transition-colors duration-500">
            כניסה לדמו של שולחן המסחר ←
          </Link>
        </div>
        <p className="mt-6 text-center text-xs font-bold font-mono text-white/35 uppercase tracking-[0.2em]">
          נתוני הדגמה · לשימוש מחקרי וחינוכי בלבד
        </p>
      </section>

      {/* Legal disclaimer */}
      <LegalDisclaimer />

      {/* ════ Sticky Dock CTA (follows the user) ════ */}
      <Link
        href="/checkout"
        dir="rtl"
        className="fixed bottom-7 left-1/2 z-50 origin-bottom will-change-transform flex flex-col items-center gap-1 px-9 py-3.5 rounded-sm bg-[#d4af37] text-black font-bold [box-shadow:0_0_40px_rgba(212,175,55,0.45)] hover:[box-shadow:0_0_60px_rgba(212,175,55,0.7)] transition-shadow duration-500"
        style={{ transform: `translate(-50%, 0) scale(${ctaScale})` }}
      >
        <span className="font-serif text-lg font-bold tracking-wide leading-none">לרכישת מנוי ושדרוג המערכת ←</span>
        <span className="text-[10px] font-bold font-mono uppercase tracking-[0.3em] text-black/70">Upgrade · Onyx Trading</span>
      </Link>
    </main>
  );
}
