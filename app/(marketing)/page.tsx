'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from './components/LangProvider';
import EnginePanel from './components/EnginePanel';

// ─── I18N ─────────────────────────────────────────────────────────────────────

const I18N = {
  // HERO
  badge:         { he: 'מסוף מסחר מוסדי לחוזי ES ו-NQ', en: 'Institutional ES & NQ Terminal' },
  h1_html:       {
    he: 'סחר לפי המודל.<br>לא לפי <span style="color:var(--gold)">הרעש.</span>',
    en: 'Trade the model.<br>Not the <span style="color:var(--gold)">noise.</span>',
  },
  hero_sub: {
    he: 'מנוע הפרקטל קורא את השוק בזמן אמת ומחשב לך ביאס יומי מבוסס — בדיוק לפי מודל הכניסה שאתה כבר סוחר. הוא בודק את כיוון המגמה, אישור IFVG על רגל המניפולציה וסוג הסטאפ בכל סשן, ומגיש הכרעה אחת ברורה: לאן השוק נוטה היום וכמה ביטחון יש מאחורי זה. בלי תחושות בטן, בלי רעש.',
    en: 'The Fractal Engine scores a daily bias against your own entry model — confluence by confluence — across every session. One terminal for analysis, execution discipline, and the journal that proves what works.',
  },
  cta_perf:  { he: 'לצפייה בביצועים החיים ←', en: 'View Live Performance →' },
  cta_sub:   { he: 'לרכישת מנוי',              en: 'Subscribe' },
  meta1:     { he: 'נתוני CME בזמן אמת',       en: 'CME Real-Time' },
  meta2:     { he: 'מבוסס מתודולוגיית ICT ו-SMC', en: 'ICT · SMC Model' },
  meta3:     { he: 'מעקב על פני 4 סשנים',      en: '4 Sessions Tracked' },

  // FRACTAL ENGINE
  fe_kicker: { he: 'מנוע הפרקטל', en: 'The Fractal Engine' },
  fe_h3_html: {
    he: 'ביאס יומי אחד,<br>מנוקד לפי קונפלואנס.',
    en: 'A daily bias,<br>scored by confluence.',
  },
  fe_lead: {
    he: 'במקום להעמיס עליך עשרות אינדיקטורים, המנוע שוקל רק את מה שחשוב למודל שלך — כיוון המגמה, אישור ה-IFVG על רגל המניפולציה, וסוג הסטאפ (ריברסל או המשכיות) — ומתרגם אותם לציון ביטחון אחד. אתה רואה בדיוק על מה הביאס מבוסס, סשן אחר סשן, מאסיה ועד ניו יורק.',
    en: 'Instead of overloading you with dozens of indicators, the engine weighs only what matters to your model — trend direction, IFVG confirmation on the manipulation leg, and setup type — and translates it into one confidence score. You see exactly what the bias is based on, session by session, from Asia to New York.',
  },
  fe_b1: {
    he: 'אישור IFVG על רגל המניפולציה — בטווח 1, 2, 3 או 5 דקות',
    en: 'IFVG confirmation on the manipulation leg — across 1, 2, 3, or 5-minute timeframes',
  },
  fe_b2: {
    he: 'ציר סשנים חי שמסמן מתי אסיה, לונדון וניו יורק (AM/PM) נפתחים ונסגרים',
    en: 'Live session axis marking when Asia, London, and New York (AM/PM) open and close',
  },
  fe_b3: {
    he: 'כל הכרעת ביאס מגיעה עם מד ביטחון שקוף — אתה תמיד יודע למה, אף פעם לא קופסה שחורה',
    en: 'Every bias decision comes with a transparent confidence meter — you always know why, never a black box',
  },
  fe_live:   { he: 'חי',           en: 'Live' },
  fe_bias_l: { he: 'ביאס יומי',   en: 'Daily Bias' },
  fe_bias_v: { he: 'עולה',         en: 'BULLISH' },
  fe_bias_m: { he: 'לונדון ← ניו יורק AM · המשכיות', en: 'London → NY AM · Continuation' },
  fe_c_tl:   { he: 'מגמה',         en: 'Trend' },
  fe_c_tv:   { he: 'עולה',         en: 'Bullish' },
  fe_c_cl:   { he: 'אישור',        en: 'Confirm' },
  fe_c_cv:   { he: 'IFVG 2M',      en: 'IFVG 2M' },
  fe_c_sl:   { he: 'סטאפ',         en: 'Setup' },
  fe_c_sv:   { he: 'המשכיות',      en: 'Continuation' },
  fe_c_el:   { he: 'סשן',          en: 'Session' },
  fe_c_ev:   { he: 'NY AM',        en: 'NY AM' },

  // FEATURES
  feat_kicker:   { he: 'יכולות',       en: 'Capabilities' },
  feat_title:    { he: 'מה יש בפנים', en: "What's Inside" },
  feat_sub_html: {
    he: 'כל מה שהמודל צריך.<br>כלום ממה שלא.',
    en: "Everything the model needs.<br>Nothing it doesn't.",
  },
  feat1_t: { he: 'ניתוח שוק וקביעת ביאס', en: 'Market Analysis & Bias' },
  feat1_b: {
    he: "צ'קליסט קונפלואנס חי עובר אתך תנאי-תנאי וקובע ביאס יומי מדורג — מכיוון המגמה, מאישור ה-IFVG ומסוג הסטאפ. הכל מיושר למודל הריברסל או ההמשכיות שאתה סוחר.",
    en: 'A live confluence checklist walks you condition by condition, establishing a graded daily bias — from trend direction, IFVG confirmation, and setup type. All aligned to the reversal or continuation model you trade.',
  },
  feat2_t: { he: 'סטטיסטיקות מערכת',      en: 'System Statistics' },
  feat2_b: {
    he: 'המערכת חותכת לך את אחוזי ההצלחה לפי סשן, סוג סטאפ, יישור מול הביאס ויום בשבוע — ומראה שחור על גבי לבן אילו מודלים באמת מרוויחים לך כסף, ואילו רק שורפים אותו.',
    en: 'The system breaks down win rates by session, setup type, bias alignment, and day of week — showing you in black and white which models actually make money, and which only burn it.',
  },
  feat3_t: { he: 'יומן מסחר ונעילת הגנה', en: 'Trade Journal & Risk Lock' },
  feat3_b: {
    he: 'כל עסקה נחתמת אוטומטית עם הסשן, השעה והביאס. עוקבים אחרי R ו-P&L בדולרים, ויש נעילת הגנה שעוצרת אותך אחרי גבול ההפסד היומי.',
    en: 'Every trade is automatically stamped with session, time, and bias. Track R and P&L in dollars, with a risk lock that stops you after your daily loss limit.',
  },

  // STATS
  stats_kicker: { he: 'ביצועים',           en: 'Performance' },
  stats_title:  { he: 'ביצועים חיים',     en: 'Live Performance' },
  stats_sub:    { he: 'מספרים, לא סיפורים.', en: 'Numbers, not stories.' },
  stats_body:   { he: 'נתונים מצרפיים בזמן אמת מכל העסקאות המתועדות במערכת.', en: 'Real-time aggregate data from all documented trades in the system.' },
  st1_v: { he: '68.4%',   en: '68.4%' },
  st1_l: { he: 'אחוז הצלחה', en: 'Win Rate' },
  st1_s: { he: 'מתוך 1,240 עסקאות מתועדות', en: 'from 1,240 documented trades' },
  st2_v: { he: '2.31',    en: '2.31' },
  st2_l: { he: 'פרופיט פקטור', en: 'Profit Factor' },
  st2_s: { he: 'יחס רווח גולמי להפסד', en: 'gross profit-to-loss ratio' },
  st3_v: { he: 'NY AM',   en: 'NY AM' },
  st3_l: { he: 'הסשן המוביל', en: 'Top Session' },
  st3_s: { he: 'חלון הזמן עם התוחלת הגבוהה', en: 'highest expected-value window' },
  st4_v: { he: '+18.6R',  en: '+18.6R' },
  st4_l: { he: 'נטו 30 יום', en: 'Net 30 Days' },
  st4_s: { he: 'תשואה מצטברת ב-R', en: 'cumulative R-return' },
  stats_cta:    { he: 'לצפייה בכל הסטטיסטיקות ←', en: 'View All Statistics →' },

  // FINAL CTA
  cta2_kicker:  { he: 'מנוי',  en: 'Subscribe' },
  cta2_h2_html: {
    he: 'די לנחש.<br>תתחיל לסחור לפי ה<span style="color:var(--gold)">מודל.</span>',
    en: 'Stop guessing.<br>Start trading the <span style="color:var(--gold)">model.</span>',
  },
  cta2_body:  {
    he: 'גישה מלאה למנוע הפרקטל, ניתוח הביאס היומי, סטטיסטיקות המערכת ויומן המסחר.',
    en: 'Full access to the Fractal Engine, daily bias analysis, system statistics, and the trade journal.',
  },
  cta2_main:  { he: 'להרשמה ולפתיחת גישה ←', en: 'Sign Up & Unlock Access →' },
  cta2_ghost: { he: 'קודם תראה את הביצועים', en: 'See the Performance First' },
  lock_row:   {
    he: '⬡ הגישה נפתחת מיד עם סיום התשלום · אפשר לבטל בכל רגע',
    en: '⬡ Access unlocks immediately · Cancel anytime',
  },
} as const;

type K = keyof typeof I18N;
type Lang = 'he' | 'en';

// ─── Scroll reveal ─────────────────────────────────────────────────────────────

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
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
    >
      {children}
    </div>
  );
}

// ─── SEP ──────────────────────────────────────────────────────────────────────

function Sep() {
  return <span className="mx-3" style={{ color: 'rgba(255,255,255,.15)' }}>·</span>;
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="relative overflow-hidden text-center" style={{ paddingTop: 118, paddingBottom: 104 }}>

      {/* Gold radial glow — top center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(212,175,55,.11), transparent 60%)' }}
      />
      {/* Subtle grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px)',
          backgroundSize: '62px 62px',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%, black, transparent)',
          maskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%, black, transparent)',
        }}
      />

      <div className="wrap">
        {/* Badge */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span
            className="h-2 w-2 rounded-full animate-pulse shrink-0"
            style={{ background: 'var(--bull-t)' }}
          />
          <span
            className="uppercase tracking-[.2em]"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.55)' }}
          >
            {t('badge')}
          </span>
        </div>

        {/* H1 */}
        <h1
          dir={rtl ? 'rtl' : 'ltr'}
          className="text-white mx-auto"
          style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(3rem,5.6vw,5.6rem)', fontWeight: 800, lineHeight: 1.08, maxWidth: '15ch' }}
          dangerouslySetInnerHTML={{ __html: t('h1_html') }}
        />

        {/* Sub */}
        <p
          dir={rtl ? 'rtl' : 'ltr'}
          className="mx-auto mt-8"
          style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(1rem,1.8vw,1.15rem)', lineHeight: 1.75, color: 'rgba(255,255,255,.55)', maxWidth: 680 }}
        >
          {t('hero_sub')}
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
          <Link href="/performance" className="btn-lg-gold">{t('cta_perf')}</Link>
          <Link href="/pricing"     className="btn-lg-ghost">{t('cta_sub')}</Link>
        </div>

        {/* Meta row */}
        <p
          className="mt-10 flex flex-wrap items-center justify-center"
          style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.2em', color: 'rgba(255,255,255,.36)' }}
        >
          <span>{t('meta1')}</span><Sep /><span>{t('meta2')}</span><Sep /><span>{t('meta3')}</span>
        </p>
      </div>
    </section>
  );
}

// ─── ENGINE ───────────────────────────────────────────────────────────────────

function Engine({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const bullets = [t('fe_b1'), t('fe_b2'), t('fe_b3')] as const;

  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <div
          className="grid grid-cols-1 lg:grid-cols-2 items-center"
          style={{ gap: 56 }}
        >
          {/* ── Text ── */}
          <Reveal>
            <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('fe_kicker')}</span>
            <h2
              dir={rtl ? 'rtl' : 'ltr'}
              className="text-white mt-4"
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.8rem,2.8vw,2.4rem)', fontWeight: 800, lineHeight: 1.2 }}
              dangerouslySetInnerHTML={{ __html: t('fe_h3_html') }}
            />
            <p
              dir={rtl ? 'rtl' : 'ltr'}
              className="mt-6"
              style={{ fontFamily: 'var(--sans)', fontSize: '1.025rem', lineHeight: 1.75, color: 'rgba(255,255,255,.55)' }}
            >
              {t('fe_lead')}
            </p>
            <ul className="mt-8 space-y-4">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-3" dir={rtl ? 'rtl' : 'ltr'}>
                  <span className="mt-0.5 shrink-0" style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>✦</span>
                  <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.65, color: 'rgba(255,255,255,.72)' }}>{b}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          {/* ── Panel ── */}
          <Reveal delay={140}>
            <EnginePanel />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── FEATURES ─────────────────────────────────────────────────────────────────

const FEAT_CARDS = [
  { icon: '◈', tk: 'feat1_t', bk: 'feat1_b' },
  { icon: '▦', tk: 'feat2_t', bk: 'feat2_b' },
  { icon: '⬡', tk: 'feat3_t', bk: 'feat3_b' },
] as const;

function Features({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-14">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('feat_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('feat_title')}</h2>
          <p
            className="sec-sub mt-3 mx-auto"
            style={{ maxWidth: 480 }}
            dangerouslySetInnerHTML={{ __html: t('feat_sub_html') }}
          />
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 22 }}>
          {FEAT_CARDS.map((card, i) => (
            <Reveal key={i} delay={i * 80}>
              <div
                className="rounded-[11px] border h-full transition-all duration-300 hover:-translate-y-1"
                dir={rtl ? 'rtl' : 'ltr'}
                style={{
                  background: 'rgba(13,13,15,.5)',
                  borderColor: 'var(--border)',
                  padding: '32px 28px',
                }}
              >
                <div
                  className="flex items-center justify-center rounded-lg mb-6"
                  style={{ width: 46, height: 46, background: 'rgba(212,175,55,.1)' }}
                >
                  <span style={{ fontSize: 20, color: 'var(--gold)' }}>{card.icon}</span>
                </div>
                <h3 className="text-white"
                  style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 700, marginBottom: 10 }}>
                  {t(card.tk)}
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

// ─── STATS ────────────────────────────────────────────────────────────────────

const STAT_KEYS = [
  { v: 'st1_v', l: 'st1_l', s: 'st1_s' },
  { v: 'st2_v', l: 'st2_l', s: 'st2_s' },
  { v: 'st3_v', l: 'st3_l', s: 'st3_s' },
  { v: 'st4_v', l: 'st4_l', s: 'st4_s' },
] as const;

function Stats({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section style={{ background: 'var(--bg2)', padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-12">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('stats_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('stats_title')}</h2>
          <p className="mt-3" dir={rtl ? 'rtl' : 'ltr'}
            style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', fontWeight: 600, color: 'rgba(255,255,255,.55)' }}>
            {t('stats_sub')}
          </p>
          <p className="sec-sub mt-2">{t('stats_body')}</p>
        </Reveal>

        <Reveal>
          <div
            className="grid grid-cols-2 md:grid-cols-4 border border-[var(--border)] gap-px"
            style={{ background: 'var(--border)' }}
          >
            {STAT_KEYS.map((sk, i) => (
              <div key={i} className="p-8" dir={rtl ? 'rtl' : 'ltr'} style={{ background: 'var(--bg2)' }}>
                <p dir="ltr"
                  style={{ fontFamily: 'var(--serif)', fontSize: 42, fontWeight: 800, lineHeight: 1, color: 'var(--gold)' }}>
                  {t(sk.v)}
                </p>
                <p className="mt-2 text-white uppercase"
                  style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, letterSpacing: '.12em' }}>
                  {t(sk.l)}
                </p>
                <p className="mt-1"
                  style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: '.04em' }}>
                  {t(sk.s)}
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-center mt-8">
            <Link href="/performance" className="btn-ghost">{t('stats_cta')}</Link>
          </div>
        </Reveal>
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
          <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('cta2_kicker')}</span>
          <h2
            dir={rtl ? 'rtl' : 'ltr'}
            className="text-white mx-auto mt-4"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.4rem,5vw,4rem)', fontWeight: 800, lineHeight: 1.12, maxWidth: '18ch' }}
            dangerouslySetInnerHTML={{ __html: t('cta2_h2_html') }}
          />
          <p
            dir={rtl ? 'rtl' : 'ltr'}
            className="mt-6 mx-auto"
            style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', lineHeight: 1.7, color: 'rgba(255,255,255,.52)', maxWidth: 520 }}
          >
            {t('cta2_body')}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link href="/pricing"     className="btn-lg-gold">{t('cta2_main')}</Link>
            <Link href="/performance" className="btn-lg-ghost">{t('cta2_ghost')}</Link>
          </div>

          <p className="mt-8"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.28)', letterSpacing: '.08em' }}>
            {t('lock_row')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { lang } = useMarketingLang();
  const rtl = lang === 'he';
  const t = (key: K): string => (I18N[key] as Record<Lang, string>)[lang];

  return (
    <>
      <Hero     t={t} rtl={rtl} />
      <Engine   t={t} rtl={rtl} />
      <Features t={t} rtl={rtl} />
      <Stats    t={t} rtl={rtl} />
      <FinalCta t={t} rtl={rtl} />
    </>
  );
}
