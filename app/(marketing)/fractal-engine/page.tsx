'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from '../components/LangProvider';
import EnginePanel from '../components/EnginePanel';

// ─── I18N ─────────────────────────────────────────────────────────────────────

const I18N = {
  // HERO
  badge:    { he: 'הליבה של Onyx', en: 'The Core of Onyx' },
  h1_html:  {
    he: 'המוח שמאחורי<br>כל <span style="color:var(--gold)">הכרעה.</span>',
    en: 'The mind behind<br>every <span style="color:var(--gold)">verdict.</span>',
  },
  hero_sub: {
    he: "מנוע הפרקטל הוא הלב הפועם של המערכת. הוא לא מנחש ולא מנבא — הוא קורא את אותם סימנים שאתה כבר מחפש בגרף, רק מהר יותר, עקבי יותר, וללא רגש. כל בוקר הוא מגיש לך הכרעה אחת מנומקת: לאן השוק נוטה, ולמה.",
    en: "The Fractal Engine is the beating heart of the system. It doesn't guess or predict — it reads the same signals you already look for on the chart, only faster, more consistently, and without emotion. Every morning it delivers one reasoned verdict: where the market leans, and why.",
  },

  // HOW IT WORKS
  how_kicker: { he: 'תהליך',                       en: 'Process' },
  how_title:  { he: 'איך זה עובד',                 en: 'How It Works' },
  how_sub:    { he: 'משלושה קלטים — להכרעה אחת', en: 'From three inputs — to one verdict' },
  s1_tag:     { he: 'קלט',                          en: 'Input' },
  s1_title:   { he: 'קורא את השוק',                en: 'Reads the Market' },
  s1_body:    {
    he: 'המנוע מזהה את כיוון המגמה — עולה, יורד או צידי — ומחפש אישור IFVG על רגל המניפולציה, בטווחי 1, 2, 3 או 5 דקות.',
    en: 'The engine identifies trend direction — bullish, bearish, or sideways — and looks for IFVG confirmation on the manipulation leg, across 1, 2, 3, or 5-minute timeframes.',
  },
  s2_tag:     { he: 'עיבוד',                        en: 'Processing' },
  s2_title:   { he: 'שוקל קונפלואנס',              en: 'Weighs Confluence' },
  s2_body:    {
    he: 'כל רכיב מקבל משקל לפי המודל שלך — המגמה, אישור ה-IFVG, סוג הסטאפ (ריברסל או המשכיות) והסשן.',
    en: 'Each component is weighted according to your model — the trend, IFVG confirmation, setup type (reversal or continuation), and session.',
  },
  s3_tag:     { he: 'פלט',                          en: 'Output' },
  s3_title:   { he: 'מגבש ביאס',                  en: 'Forms the Bias' },
  s3_body:    {
    he: 'התוצאה: הכרעה אחת ברורה — עולה, יורד או ניטרלי.',
    en: 'The result: one clear verdict — bullish, bearish, or neutral.',
  },

  // LIVE DEMO
  demo_kicker:  { he: 'הכרעה חיה', en: 'Live Verdict' },
  demo_h3_html: {
    he: 'לא עוד אינדיקטור.<br>הכרעה שאתה מבין.',
    en: "Not another indicator.<br>A verdict you understand.",
  },
  demo_lead: {
    he: 'כל הקונפלואנסים — כיוון המגמה, אישור ה-IFVG, סוג הסטאפ והסשן — מזוקקים לכרטיס אחד. אתה תמיד יודע על מה הביאס נשען, ולמה.',
    en: 'All confluences — trend direction, IFVG confirmation, setup type, and session — distilled into one card. You always know what the bias rests on, and why.',
  },

  // WHAT THE ENGINE WEIGHS
  weighs_kicker: { he: 'קונפלואנסים',                    en: 'Confluences' },
  weighs_title:  { he: 'מה המנוע שוקל',                 en: 'What the Engine Weighs' },
  weighs_sub:    { he: 'הקונפלואנסים שבונים את הביאס', en: 'The confluences that build the bias' },
  w1_tag:   { he: 'מגמה',                  en: 'Trend' },
  w1_title: { he: 'כיוון המגמה',           en: 'Trend Direction' },
  w1_body:  {
    he: 'המנוע מזהה אם השוק עולה, יורד או נע הצידה — הבסיס שממנו נגזרת הטיית הביאס.',
    en: 'The engine identifies whether the market is bullish, bearish, or moving sideways — the foundation from which the bias is derived.',
  },
  w2_tag:   { he: 'אישור',                 en: 'Confirmation' },
  w2_title: { he: 'IFVG · רגל מניפולציה', en: 'IFVG · Manipulation Leg' },
  w2_body:  {
    he: 'האישור לכניסה הוא IFVG על רגל המניפולציה — בטווח 1, 2, 3 או 5 דקות. זה הטריגר שעליו נשענת הכניסה.',
    en: 'Entry confirmation is an IFVG on the manipulation leg — at the 1, 2, 3, or 5-minute timeframe. This is the trigger the entry rests on.',
  },
  w3_tag:   { he: 'סטאפ',               en: 'Setup' },
  w3_title: { he: 'ריברסל או המשכיות', en: 'Reversal or Continuation' },
  w3_body:  {
    he: 'שני הסטאפים: ריברסל — לקיחת נזילות והיפוך; המשכיות — כניסה לגאפ של 15 או 5 דקות.',
    en: 'Two setups: reversal — liquidity sweep and reversal; continuation — entry into a 15 or 5-minute gap.',
  },
  w4_tag:   { he: 'סשן',       en: 'Session' },
  w4_title: { he: 'עיתוי וסשן', en: 'Timing & Session' },
  w4_body:  {
    he: 'לא כל שעה נולדה שווה. המנוע משקלל באיזה חלון אתה נמצא — אסיה, לונדון, ניו יורק AM/PM — ומכוונן את ההכרעה בהתאם.',
    en: "Not every hour is created equal. The engine weights which window you're in — Asia, London, New York AM/PM — and calibrates the verdict accordingly.",
  },

  // FINAL CTA
  cta_h2_html: {
    he: 'תן למנוע<br>לעשות את <span style="color:var(--gold)">העבודה.</span>',
    en: 'Let the engine<br>do the <span style="color:var(--gold)">work.</span>',
  },
  cta_body:  {
    he: 'מנוע הפרקטל זמין בכל מסלול בתשלום — גישה מיידית, ביטול בכל רגע.',
    en: 'The Fractal Engine is available on every paid plan — immediate access, cancel anytime.',
  },
  cta_gold:  { he: 'לרכישת מנוי ←',     en: 'Subscribe →' },
  cta_ghost: { he: 'צפה בביצועים',       en: 'View Performance' },
  lock:      { he: 'זמין במסלולי PRO ו-DELUXE · ביטול בכל עת', en: 'Available on PRO & DELUXE plans · Cancel anytime' },
} as const;

type K = keyof typeof I18N;
type Lang = 'he' | 'en';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.1 },
    );
    io.observe(el); return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}>
      {children}
    </div>
  );
}

function GoldTag({ label }: { label: string }) {
  return (
    <span className="inline-block rounded px-2 py-0.5" style={{
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '.18em',
      color: 'var(--gold)', background: 'rgba(212,175,55,.1)',
      border: '1px solid rgba(212,175,55,.2)',
    }}>
      {label}
    </span>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="relative overflow-hidden text-center" style={{ paddingTop: 118, paddingBottom: 104 }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(212,175,55,.11), transparent 60%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px)',
        backgroundSize: '62px 62px',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%,black,transparent)',
        maskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%,black,transparent)',
      }} />

      <div className="wrap">
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ background: 'var(--bull-t)' }} />
          <span className="uppercase tracking-[.2em]"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.55)' }}>
            {t('badge')}
          </span>
        </div>

        <h1 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto"
          style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.8rem,4.8vw,4.8rem)', fontWeight: 800, lineHeight: 1.08, maxWidth: '15ch' }}
          dangerouslySetInnerHTML={{ __html: t('h1_html') }} />

        <p dir={rtl ? 'rtl' : 'ltr'} className="mx-auto mt-8"
          style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(1rem,1.8vw,1.15rem)', lineHeight: 1.75, color: 'rgba(255,255,255,.55)', maxWidth: 660 }}>
          {t('hero_sub')}
        </p>
      </div>
    </section>
  );
}

// ─── HOW IT WORKS ─────────────────────────────────────────────────────────────

const STEPS: { num: string; tk: K; ttk: K; bk: K }[] = [
  { num: '01', tk: 's1_tag', ttk: 's1_title', bk: 's1_body' },
  { num: '02', tk: 's2_tag', ttk: 's2_title', bk: 's2_body' },
  { num: '03', tk: 's3_tag', ttk: 's3_title', bk: 's3_body' },
];

function HowItWorks({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-12">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('how_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('how_title')}</h2>
          <p className="sec-sub mt-3">{t('how_sub')}</p>
        </Reveal>

        <Reveal>
          <div className="flex flex-col md:flex-row items-stretch gap-4 md:gap-0" dir={rtl ? 'rtl' : 'ltr'}>
            {STEPS.flatMap((step, i) => {
              const card = (
                <div key={step.num} className="flex-1 rounded-xl border p-8"
                  style={{ background: 'rgba(13,13,15,.5)', borderColor: 'var(--border)' }}>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <span style={{ fontFamily: 'var(--serif)', fontSize: 40, fontWeight: 800, lineHeight: 1, color: 'rgba(212,175,55,.28)' }}>
                      {step.num}
                    </span>
                    <GoldTag label={t(step.tk)} />
                  </div>
                  <h3 className="text-white mb-3"
                    style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>
                    {t(step.ttk)}
                  </h3>
                  <p style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.7, color: 'rgba(255,255,255,.52)' }}>
                    {t(step.bk)}
                  </p>
                </div>
              );
              if (i < STEPS.length - 1) {
                return [
                  card,
                  <div key={`arr-${i}`} className="hidden md:flex items-center justify-center px-3 shrink-0">
                    <span style={{
                      color: 'rgba(212,175,55,.38)', fontSize: 22, lineHeight: 1,
                      display: 'inline-block', transform: rtl ? 'scaleX(-1)' : undefined,
                    }}>→</span>
                  </div>,
                ];
              }
              return [card];
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── LIVE DEMO ────────────────────────────────────────────────────────────────

function LiveDemo({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)] relative overflow-hidden" style={{ padding: '96px 0' }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 50%, rgba(212,175,55,.07), transparent 65%)' }} />

      <div className="wrap">
        <div className="grid grid-cols-1 lg:grid-cols-2 items-center" style={{ gap: 56 }}>

          {/* Text */}
          <Reveal>
            <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('demo_kicker')}</span>
            <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mt-4"
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.8rem,2.8vw,2.4rem)', fontWeight: 800, lineHeight: 1.2 }}
              dangerouslySetInnerHTML={{ __html: t('demo_h3_html') }} />
            <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6"
              style={{ fontFamily: 'var(--sans)', fontSize: '1.025rem', lineHeight: 1.75, color: 'rgba(255,255,255,.55)' }}>
              {t('demo_lead')}
            </p>
          </Reveal>

          {/* Panel */}
          <Reveal delay={140}>
            <EnginePanel />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── WHAT THE ENGINE WEIGHS ───────────────────────────────────────────────────

const WEIGH_CARDS: { icon: string; tk: K; ttk: K; bk: K }[] = [
  { icon: '◈', tk: 'w1_tag', ttk: 'w1_title', bk: 'w1_body' },
  { icon: '▤', tk: 'w2_tag', ttk: 'w2_title', bk: 'w2_body' },
  { icon: '⌗', tk: 'w3_tag', ttk: 'w3_title', bk: 'w3_body' },
  { icon: '◷', tk: 'w4_tag', ttk: 'w4_title', bk: 'w4_body' },
];

function WhatItWeighs({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-12">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('weighs_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('weighs_title')}</h2>
          <p className="sec-sub mt-3">{t('weighs_sub')}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-[22px]">
          {WEIGH_CARDS.map((card, i) => (
            <Reveal key={i} delay={(i % 2) * 80}>
              <div className="rounded-[11px] border h-full p-8" dir={rtl ? 'rtl' : 'ltr'}
                style={{ background: 'rgba(13,13,15,.5)', borderColor: 'var(--border)' }}>
                {/* icon + tag */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex items-center justify-center rounded-lg shrink-0"
                    style={{ width: 46, height: 46, background: 'rgba(212,175,55,.1)' }}>
                    <span style={{ fontSize: 20, color: 'var(--gold)' }}>{card.icon}</span>
                  </div>
                  <GoldTag label={t(card.tk)} />
                </div>
                <h3 className="text-white mb-3"
                  style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 700, lineHeight: 1.3 }}>
                  {t(card.ttk)}
                </h3>
                <p style={{ fontFamily: 'var(--sans)', fontSize: '0.925rem', lineHeight: 1.72, color: 'rgba(255,255,255,.52)' }}>
                  {t(card.bk)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FINAL CTA ────────────────────────────────────────────────────────────────

function FinalCta({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)] relative overflow-hidden text-center" style={{ padding: '96px 0' }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 40%, rgba(212,175,55,.09), transparent 65%)' }} />

      <div className="wrap">
        <Reveal>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.4rem,5vw,4rem)', fontWeight: 800, lineHeight: 1.12, maxWidth: '18ch' }}
            dangerouslySetInnerHTML={{ __html: t('cta_h2_html') }} />
          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6 mx-auto"
            style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', lineHeight: 1.7, color: 'rgba(255,255,255,.52)', maxWidth: 500 }}>
            {t('cta_body')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link href="/pricing"     className="btn-lg-gold">{t('cta_gold')}</Link>
            <Link href="/performance" className="btn-lg-ghost">{t('cta_ghost')}</Link>
          </div>
          <p className="mt-8"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.28)', letterSpacing: '.08em' }}>
            {t('lock')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FractalEnginePage() {
  const { lang } = useMarketingLang();
  const rtl = lang === 'he';
  const t = (key: K): string => (I18N[key] as Record<Lang, string>)[lang];

  return (
    <>
      <Hero         t={t} rtl={rtl} />
      <HowItWorks   t={t} rtl={rtl} />
      <LiveDemo     t={t} rtl={rtl} />
      <WhatItWeighs t={t} rtl={rtl} />
      <FinalCta     t={t} rtl={rtl} />
    </>
  );
}
