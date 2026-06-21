'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from '../components/LangProvider';

// ─── I18N ─────────────────────────────────────────────────────────────────────

const I18N = {
  // HERO
  badge:    { he: 'נתונים חיים · מתעדכן בזמן אמת',      en: 'Live Data · Updated in Real Time' },
  h1_html:  {
    he: 'מספרים אמיתיים.<br>בלי <span style="color:var(--gold)">לייפות.</span>',
    en: 'Real numbers.<br>No <span style="color:var(--gold)">dressing up.</span>',
  },
  hero_sub: {
    he: 'לפני שאתה משלם — תראה את האמת. אלה הביצועים המצרפיים של המערכת, פתוחים לכולם. הנה טעימה מהמספרים החיים; התמונה המלאה — חיתוך לפי סשן, מודל ויום, התפלגות R ומגמות — נפתחת עם המנוי.',
    en: 'Before you pay — see the truth. These are the system\'s aggregate performance numbers, open to everyone. Here\'s a taste of the live numbers; the full picture — broken down by session, model, and day, R distribution and trends — unlocks with a subscription.',
  },

  // PUBLIC STATS
  pub_kicker: { he: 'טעימה ציבורית',    en: 'Public Preview' },
  pub_h2:     { he: 'מה שכולם רואים',   en: 'What Everyone Sees' },
  s1_v: { he: '68.4%', en: '68.4%' },
  s1_l: { he: 'אחוז הצלחה',              en: 'Win Rate' },
  s1_s: { he: 'מתוך 1,240 עסקאות מתועדות', en: 'Out of 1,240 documented trades' },
  s2_v: { he: '2.31',  en: '2.31'  },
  s2_l: { he: 'פרופיט פקטור',            en: 'Profit Factor' },
  s2_s: { he: 'יחס רווח גולמי להפסד',    en: 'Gross profit to loss ratio' },
  s3_v: { he: '+18.6R', en: '+18.6R' },
  s3_l: { he: 'נטו 30 יום',              en: 'Net 30 Days' },
  s3_s: { he: 'תשואה מצטברת ב-R',        en: 'Cumulative return in R' },
  s4_v: { he: 'NY AM', en: 'NY AM' },
  s4_l: { he: 'הסשן המוביל',             en: 'Top Session' },
  s4_s: { he: 'חלון התוחלת הגבוהה',      en: 'Highest expectancy window' },
  pub_ts: {
    he: '◷ עודכן לאחרונה לפני 4 דקות · מבוסס על כל העסקאות המתועדות במערכת',
    en: '◷ Last updated 4 minutes ago · Based on all documented trades in the system',
  },

  // LOCKED SECTION
  lock_kicker: { he: 'DELUXE בלבד',  en: 'DELUXE Only' },
  lock_h2:     { he: 'התמונה המלאה', en: 'The Full Picture' },
  lock_badge:  { he: 'הסטטיסטיקה המלאה — נפתחת עם מנוי', en: 'Full statistics — unlocks with a subscription' },
  lock_sub:    {
    he: 'חיתוך מלא לפי סשן, מודל, יישור ביאס ויום בשבוע — בדיוק מה עובד, מתי, וכמה.',
    en: 'Full breakdown by session, model, bias alignment, and day of week — exactly what works, when, and how much.',
  },
  ov_title: { he: 'הנתונים המלאים נעולים', en: 'Full Data Locked' },
  ov_body:  {
    he: 'עמוד הסטטיסטיקה והאנליטיקס המלא — כולל ווין רייט לפי סשן ומודל, התפלגות R ומגמות ביצועים — זמין למנויי DELUXE.',
    en: 'The full statistics and analytics page — including win rate by session and model, R distribution, and performance trends — is available to DELUXE subscribers.',
  },
  ov_c1:   { he: 'חיתוך לפי סשן ומודל',   en: 'Breakdown by session & model' },
  ov_c2:   { he: 'התפלגות R ותוחלת',       en: 'R distribution & expectancy' },
  ov_c3:   { he: 'מגמות לאורך זמן',         en: 'Performance trends over time' },
  ov_cta:  { he: 'שדרג ל-DELUXE לפתיחה →', en: 'Upgrade to DELUXE to Unlock →' },
  ov_fine: { he: 'כלול במסלול DELUXE · 199 ₪ לחודש · ביטול בכל עת', en: 'Included in DELUXE plan · ₪199/mo · Cancel anytime' },

  // DUMMY content (blurred — kept bilingual for consistency)
  d_chart: { he: 'ווין רייט לפי סשן', en: 'Win Rate by Session' },
  d1_v: { he: '74%',  en: '74%'  }, d1_l: { he: 'Win by Session', en: 'Win by Session' },
  d2_v: { he: 'REV',  en: 'REV'  }, d2_l: { he: 'Best Model',     en: 'Best Model'     },
  d3_v: { he: '1.84', en: '1.84' }, d3_l: { he: 'Avg R',          en: 'Avg R'          },
  d4_v: { he: '+0.9', en: '+0.9' }, d4_l: { he: 'Expectancy',     en: 'Expectancy'     },

  // FINAL CTA
  cta_kicker:  { he: 'מוכן לראות הכל?',   en: 'Ready to See Everything?' },
  cta_h2_html: {
    he: 'המספרים מדברים.<br>תן <span style="color:var(--gold)">להם לעבוד בשבילך.</span>',
    en: 'The numbers speak.<br>Let <span style="color:var(--gold)">them work for you.</span>',
  },
  cta_body: {
    he: 'הסטטיסטיקה המלאה, ההתפלגות, המגמות — הכל ממתין לך מיד עם הגישה.',
    en: 'Full statistics, distribution, trends — everything waiting for you the moment you get access.',
  },
  cta_gold:  { he: 'שדרג ל-DELUXE →',  en: 'Upgrade to DELUXE →' },
  cta_ghost: { he: 'השוואת מסלולים',    en: 'Compare Plans' },
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
      { threshold: 0.08 }
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

// ─── Dummy bar chart (lives behind blur) ──────────────────────────────────────

const BAR_H = [65, 88, 72, 58, 92, 78, 84, 70];
const BAR_L = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'LDN', 'AM', 'PM'];

function DummyChart({ title }: { title: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border2)', background: '#000' }}>
      <p style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.55)', marginBottom: 20 }}>
        {title}
      </p>
      <div className="flex items-end gap-2" style={{ height: 100 }}>
        {BAR_H.map((h, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="w-full rounded-t-sm" style={{
              height: h,
              background: 'linear-gradient(to top, rgba(212,175,55,.8), rgba(212,175,55,.22))',
            }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'rgba(255,255,255,.3)' }}>
              {BAR_L[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dummy stat cards (lives behind blur) ─────────────────────────────────────

function DummyCards({ t }: { t: (k: K) => string }) {
  const cards = [
    { v: t('d1_v'), l: t('d1_l'), gold: true  },
    { v: t('d2_v'), l: t('d2_l'), gold: false },
    { v: t('d3_v'), l: t('d3_l'), gold: false },
    { v: t('d4_v'), l: t('d4_l'), gold: true  },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px mb-4" style={{ background: 'var(--border2)' }}>
      {cards.map((c, i) => (
        <div key={i} className="p-6 text-center" style={{ background: 'var(--bg2)' }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 32, fontWeight: 800, lineHeight: 1, color: c.gold ? 'var(--gold)' : 'rgba(255,255,255,.8)' }}>
            {c.v}
          </p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.16em', color: 'rgba(255,255,255,.35)', marginTop: 8 }}>
            {c.l}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Lock Overlay ─────────────────────────────────────────────────────────────

function LockOverlay({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const checks = [t('ov_c1'), t('ov_c2'), t('ov_c3')];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8"
      style={{ background: 'radial-gradient(ellipse at center, rgba(5,5,5,.55), rgba(5,5,5,.92))' }}>
      <div className="flex flex-col items-center text-center" style={{ maxWidth: 500 }}>
        {/* Hex icon */}
        <div className="flex items-center justify-center mb-6" style={{
          width: 60, height: 60, borderRadius: '50%',
          background: 'rgba(212,175,55,.1)',
          border: '1px solid rgba(212,175,55,.3)',
          boxShadow: '0 0 32px rgba(212,175,55,.2)',
        }}>
          <span style={{ fontSize: 24, color: 'var(--gold)' }}>⬡</span>
        </div>

        <h3 dir={rtl ? 'rtl' : 'ltr'}
          style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.5rem,2.8vw,2.2rem)', fontWeight: 800, lineHeight: 1.18, color: '#fff', marginBottom: 14 }}>
          {t('ov_title')}
        </h3>

        <p dir={rtl ? 'rtl' : 'ltr'}
          style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', lineHeight: 1.7, color: 'rgba(255,255,255,.54)', marginBottom: 24 }}>
          {t('ov_body')}
        </p>

        {/* Checklist row */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-8">
          {checks.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>✓</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.1em', color: 'rgba(255,255,255,.62)' }}>
                {c}
              </span>
            </div>
          ))}
        </div>

        <Link href="/pricing" className="btn-lg-gold" style={{ marginBottom: 14 }}>
          {t('ov_cta')}
        </Link>

        <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.28)', letterSpacing: '.08em' }}>
          {t('ov_fine')}
        </p>
      </div>
    </div>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="relative overflow-hidden text-center" style={{ paddingTop: 118, paddingBottom: 104 }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(74,124,89,.12), transparent 60%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px)',
        backgroundSize: '62px 62px',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%,black,transparent)',
        maskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%,black,transparent)',
      }} />
      <div className="wrap">
        {/* Live badge */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ background: 'var(--bull-t)' }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.2em', color: 'var(--bull-t)' }}>
            {t('badge')}
          </span>
        </div>

        <h1 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto"
          style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.8rem,4.8vw,4.8rem)', fontWeight: 800, lineHeight: 1.08, maxWidth: '14ch' }}
          dangerouslySetInnerHTML={{ __html: t('h1_html') }} />

        <p dir={rtl ? 'rtl' : 'ltr'} className="mx-auto mt-8"
          style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(1rem,1.8vw,1.15rem)', lineHeight: 1.75, color: 'rgba(255,255,255,.55)', maxWidth: 680 }}>
          {t('hero_sub')}
        </p>
      </div>
    </section>
  );
}

// ─── Public Stats ─────────────────────────────────────────────────────────────

function PublicStats({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const stats = [
    { v: t('s1_v'), l: t('s1_l'), s: t('s1_s'), color: '#fff'              },
    { v: t('s2_v'), l: t('s2_l'), s: t('s2_s'), color: 'var(--gold)'       },
    { v: t('s3_v'), l: t('s3_l'), s: t('s3_s'), color: 'var(--bull-t)'     },
    { v: t('s4_v'), l: t('s4_l'), s: t('s4_s'), color: '#fff'              },
  ];

  return (
    <section className="border-t border-[var(--border)]" style={{ paddingBottom: 72 }}>
      <div className="wrap" style={{ paddingTop: 80 }}>
        <Reveal>
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('pub_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="sec-title text-white mb-12">{t('pub_h2')}</h2>
        </Reveal>

        <Reveal delay={80}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl border overflow-hidden"
            style={{ background: 'var(--border2)', borderColor: 'var(--border2)' }}>
            {stats.map((s, i) => (
              <div key={i} className="flex flex-col items-center justify-center text-center px-6 py-10"
                style={{ background: 'var(--bg2)' }}>
                <p dir="ltr"
                  style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.2rem,3.8vw,3rem)', fontWeight: 800, lineHeight: 1, color: s.color }}>
                  {s.v}
                </p>
                <p className="mt-3"
                  style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.55)' }}>
                  {s.l}
                </p>
                <p dir={rtl ? 'rtl' : 'ltr'} className="mt-2"
                  style={{ fontFamily: 'var(--sans)', fontSize: '0.78rem', lineHeight: 1.5, color: 'rgba(255,255,255,.32)' }}>
                  {s.s}
                </p>
              </div>
            ))}
          </div>

          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-5 text-center"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.28)', letterSpacing: '.06em' }}>
            {t('pub_ts')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Locked Section ───────────────────────────────────────────────────────────

function LockedSection({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)]" style={{ paddingTop: 80, paddingBottom: 96 }}>
      <div className="wrap">
        <Reveal>
          <div dir={rtl ? 'rtl' : 'ltr'} className="flex flex-wrap items-center gap-4 mb-4">
            <h2 className="sec-title text-white">{t('lock_h2')}</h2>
            <span className="shrink-0 rounded px-2.5 py-1" style={{
              fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.16em',
              color: 'var(--gold)', background: 'rgba(212,175,55,.1)',
              border: '1px solid rgba(212,175,55,.22)',
            }}>
              {t('lock_badge')}
            </span>
          </div>
          <p dir={rtl ? 'rtl' : 'ltr'} className="sec-sub mb-10" style={{ maxWidth: 600 }}>
            {t('lock_sub')}
          </p>
        </Reveal>

        <Reveal delay={100}>
          {/* Relative container — blur content sits inside, overlay sits on top */}
          <div className="relative rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border2)', minHeight: 460 }}>
            {/* Blurred dummy layer */}
            <div style={{
              filter: 'blur(7px)',
              opacity: 0.5,
              pointerEvents: 'none',
              userSelect: 'none',
              padding: '28px 28px 32px',
            }}>
              <DummyCards t={t} />
              <DummyChart title={t('d_chart')} />
            </div>

            {/* Lock overlay */}
            <LockOverlay t={t} rtl={rtl} />
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
          <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('cta_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto mt-4"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.4rem,5vw,4rem)', fontWeight: 800, lineHeight: 1.12, maxWidth: '18ch' }}
            dangerouslySetInnerHTML={{ __html: t('cta_h2_html') }} />
          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6 mx-auto"
            style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', lineHeight: 1.7, color: 'rgba(255,255,255,.52)', maxWidth: 500 }}>
            {t('cta_body')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link href="/pricing" className="btn-lg-gold">{t('cta_gold')}</Link>
            <Link href="/pricing" className="btn-lg-ghost">{t('cta_ghost')}</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const { lang } = useMarketingLang();
  const rtl = lang === 'he';
  const t = (key: K): string => (I18N[key] as Record<Lang, string>)[lang];

  return (
    <>
      <Hero          t={t} rtl={rtl} />
      <PublicStats   t={t} rtl={rtl} />
      <LockedSection t={t} rtl={rtl} />
      <FinalCta      t={t} rtl={rtl} />
    </>
  );
}
