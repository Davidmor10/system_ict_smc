'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from '../components/LangProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang   = 'he' | 'en';
type BiStr  = { he: string; en: string };
type CellV  = 'check' | 'cross' | 'dash' | string; // string = literal display value

// ─── Plan data ────────────────────────────────────────────────────────────────

const PLANS = [
  {
    key: 'basic', featured: false,
    tag:      { he: 'היכרות',           en: 'Introduction'          } as BiStr,
    name:     { he: 'BASIC',            en: 'BASIC'                 } as BiStr,
    amt:      { he: 'חינם',             en: 'Free'                  } as BiStr,
    amtColor: 'var(--bull-t)',
    unit:     null as BiStr | null,
    features: [
      { text: { he: 'חשבון חינמי להיכרות עם המערכת',          en: 'Free account to explore the system'            } as BiStr, on: true  },
      { text: { he: 'טעימה מהביצועים הציבוריים והדאשבורד',     en: 'Taste of public performance & dashboard'       } as BiStr, on: true  },
      { text: { he: 'ללא יומן מסחר, סטאפים וחוקים',            en: 'No journal, setups or rules'                   } as BiStr, on: false },
      { text: { he: 'ללא סטטיסטיקות ומאמן AI',                 en: 'No statistics or AI coach'                     } as BiStr, on: false },
    ],
    cta:      { he: 'התחל בחינם',               en: 'Get Started Free'       } as BiStr,
    href:     '/sign-up',
    ctaGold:  false,
    fine:     { he: 'ללא כרטיס אשראי',          en: 'No credit card required' } as BiStr,
  },
  {
    key: 'pro', featured: true,
    tag:      { he: 'לסוחר הפעיל',      en: 'For the Active Trader' } as BiStr,
    name:     { he: 'PRO',              en: 'PRO'                   } as BiStr,
    amt:      { he: '99',               en: '99'                    } as BiStr,
    amtColor: '#fff',
    unit:     { he: '₪ / חודש',         en: '₪ / mo'               } as BiStr,
    features: [
      { text: { he: 'גישה מלאה לדאשבורד ולניתוח יומן המסחר',      en: 'Full dashboard access & journal analysis'     } as BiStr, on: true  },
      { text: { he: 'יומן מסחר מלא',                              en: 'Full trade journal'                           } as BiStr, on: true  },
      { text: { he: 'ספר הסטאפים והחוקים פתוח',                   en: 'Setups & rules unlocked'                      } as BiStr, on: true  },
      { text: { he: 'ללא עמוד הסטטיסטיקה והאנליטיקס',             en: 'No statistics & analytics page'               } as BiStr, on: false },
      { text: { he: 'ללא מאמן ה-AI',                              en: 'No AI coach'                                  } as BiStr, on: false },
    ],
    cta:      { he: 'הצטרף ל-PRO',              en: 'Join PRO'              } as BiStr,
    href:     '/checkout?plan=pro',
    ctaGold:  true,
    fine:     { he: 'חיוב חודשי · ביטול בכל עת', en: 'Monthly billing · Cancel anytime' } as BiStr,
  },
  {
    key: 'deluxe', featured: false,
    tag:      { he: 'ללא תקרות',        en: 'No Limits'             } as BiStr,
    name:     { he: 'DELUXE',           en: 'DELUXE'                } as BiStr,
    amt:      { he: '199',              en: '199'                   } as BiStr,
    amtColor: '#fff',
    unit:     { he: '₪ / חודש',         en: '₪ / mo'               } as BiStr,
    features: [
      { text: { he: 'כל מה שיש ב-PRO — בלי שום הגבלה',           en: 'Everything in PRO — with no limits'           } as BiStr, on: true  },
      { text: { he: 'עמוד הסטטיסטיקה והאנליטיקס המלא',            en: 'Full statistics & analytics page'             } as BiStr, on: true  },
      { text: { he: 'מאמן ה-AI ואנליטיקת ה-AI',                  en: 'AI coach & AI analytics'                      } as BiStr, on: true  },
      { text: { he: 'כל הפיצ׳רים פתוחים, נוכחיים ועתידיים',       en: 'All features open, current and future'        } as BiStr, on: true  },
      { text: { he: 'תמיכה מועדפת ועדיפות בעדכונים',              en: 'Priority support & update priority'           } as BiStr, on: true  },
    ],
    cta:      { he: 'הצטרף ל-DELUXE',           en: 'Join DELUXE'           } as BiStr,
    href:     '/checkout?plan=deluxe',
    ctaGold:  false,
    fine:     { he: 'חיוב חודשי · ביטול בכל עת', en: 'Monthly billing · Cancel anytime' } as BiStr,
  },
] as const;

// ─── Comparison table rows ────────────────────────────────────────────────────

type TableRow = { feat: BiStr; b: CellV; p: CellV; d: CellV };

const TABLE_ROWS: TableRow[] = [
  { feat: { he: 'טעימה מהביצועים הציבוריים',         en: 'Public performance preview'     }, b: 'check', p: 'check', d: 'check'   },
  { feat: { he: 'גישה לדאשבורד',                     en: 'Dashboard access'               }, b: 'dash',  p: 'check', d: 'check'   }, // basic cell overridden to "taste" per lang
  { feat: { he: 'יומן מסחר',                         en: 'Trade journal'                  }, b: 'cross', p: 'check', d: 'check'   },
  { feat: { he: 'סטאפים וחוקים',                     en: 'Setups & rules'                 }, b: 'cross', p: 'check', d: 'check'   },
  { feat: { he: 'עמוד סטטיסטיקה ואנליטיקס',         en: 'Statistics & analytics'         }, b: 'cross', p: 'cross', d: 'check'   },
  { feat: { he: 'מאמן AI ואנליטיקת AI',              en: 'AI coach & analytics'           }, b: 'cross', p: 'cross', d: 'check'   },
  { feat: { he: 'תמיכה',                             en: 'Support'                        }, b: '—',     p: '—',     d: '—'       }, // overridden per lang below
];

// ─── I18N ─────────────────────────────────────────────────────────────────────

const I18N = {
  badge:    { he: 'מסלולי מנוי',   en: 'Membership Plans' },
  h1_html:  {
    he: 'בחר את הרמה<br>שמתאימה <span style="color:var(--gold)">לקצב שלך.</span>',
    en: 'Choose the level<br>that fits <span style="color:var(--gold)">your pace.</span>',
  },
  hero_sub: {
    he: 'כל המסלולים בנויים על אותו לב מערכת. ההבדל הוא רק כמה רחוק אתה לוקח את זה — מהיכרות ראשונית, דרך יומן וניתוח מלא, ועד כל הסטטיסטיקות והבינה של המערכת. תמיד אפשר לשדרג, ואין התחייבות.',
    en: "Every plan is built on the same core. The difference is only how far you take it — from a first look, through the full journal and analysis, to every statistic and the AI intelligence. Always upgradeable, no commitment.",
  },
  pop:      { he: 'הכי פופולרי',   en: 'Most Popular' },

  // TABLE
  tbl_kicker: { he: 'השוואה מלאה',   en: 'Full Comparison' },
  tbl_h2:     { he: 'השוואה מלאה',   en: 'Full Comparison' },
  tbl_sub:    { he: 'בדיוק מה מקבלים בכל מסלול', en: 'Exactly what you get in each plan' },
  tbl_col0:   { he: 'פיצ׳ר',          en: 'Feature'          },
  // dashboard row — basic gets a "taste"
  r_dash_b: { he: 'טעימה', en: 'Taste' },
  // support row text
  r7_b: { he: 'בסיסית',         en: 'Basic'          },
  r7_p: { he: 'מהירה',           en: 'Fast'           },
  r7_d: { he: 'מועדפת · VIP',   en: 'Priority · VIP' },

  // FAQ
  faq_kicker: { he: 'שאלות נפוצות',   en: 'FAQ' },
  faq_h2:     { he: 'שאלות נפוצות',   en: 'Frequently Asked Questions' },
  faq_sub:    { he: 'מה שכדאי לדעת לפני שמצטרפים', en: 'What you should know before joining' },
  faq_q1: { he: 'מה ההבדל המרכזי בין PRO ל-DELUXE?', en: 'What\'s the main difference between PRO and DELUXE?' },
  faq_a1: {
    he: 'ב-PRO אתה מקבל גישה מלאה לדאשבורד, ליומן המסחר, לסטאפים ולחוקים — כל מה שצריך כדי לתעד ולנהל את המסחר. ב-DELUXE נפתח גם עמוד הסטטיסטיקה והאנליטיקס, אנליטיקת ה-AI ומאמן ה-AI — כלומר כל שכבת הבינה של המערכת.',
    en: 'With PRO you get full access to the dashboard, the trade journal, setups and rules — everything you need to log and manage your trading. With DELUXE the statistics & analytics page, AI analytics and the AI coach open up too — the entire intelligence layer of the system.',
  },
  faq_q2: { he: 'אפשר לשדרג מ-PRO ל-DELUXE באמצע?', en: 'Can I upgrade from PRO to DELUXE mid-cycle?' },
  faq_a2: {
    he: 'בהחלט. השדרוג מיידי — ברגע שתעבור ל-DELUXE כל ההגבלות נפתחות, ותחויב רק על ההפרש היחסי עד סוף החודש.',
    en: 'Absolutely. The upgrade is immediate — the moment you switch to DELUXE all limits open up, and you\'re only charged the prorated difference until month end.',
  },
  faq_q3: { he: 'יש התחייבות לתקופה?', en: 'Is there a commitment period?' },
  faq_a3: {
    he: 'אין. כל המסלולים בתשלום חודשי וניתנים לביטול בכל רגע. אם ביטלת — תישאר עם הגישה עד סוף החודש ששולם.',
    en: 'None. All plans are monthly and cancellable at any moment. If you cancel — you keep access until the end of the paid month.',
  },
  faq_q4: { he: 'מה כולל החשבון החינמי?', en: 'What does the free account include?' },
  faq_a4: {
    he: 'BASIC נותן לך להיכנס, להכיר את הממשק ולקבל טעימה מהביצועים הציבוריים ומהדאשבורד — בלי גישה ליומן המסחר, לסטאפים, לחוקים או לשכבת ה-AI.',
    en: 'BASIC lets you sign in, explore the interface, and get a taste of the public performance and dashboard — without access to the trade journal, setups, rules, or the AI layer.',
  },

  // CTA
  cta_kicker:  { he: 'מוכן להתחיל?', en: 'Ready to Start?' },
  cta_h2_html: {
    he: 'תפסיק לנחש.<br>תתחיל לסחור לפי ה<span style="color:var(--gold)">מודל.</span>',
    en: 'Stop guessing.<br>Start trading the <span style="color:var(--gold)">model.</span>',
  },
  cta_body: {
    he: 'הצטרף עכשיו, והמסוף נפתח לך מיד. אפשר להתחיל ב-PRO ולשדרג מתי שתרצה — או לקפוץ ישר ל-DELUXE בלי תקרות.',
    en: 'Join now and the terminal opens for you immediately. Start with PRO and upgrade whenever you want — or jump straight to DELUXE with no limits.',
  },
  cta_pro:    { he: 'הצטרף ל-PRO →',   en: 'Join PRO →'        },
  cta_deluxe: { he: 'שדרג ל-DELUXE',    en: 'Upgrade to DELUXE' },
  cta_lock:   { he: 'הגישה נפתחת מיד עם סיום התשלום · אפשר לבטל בכל רגע', en: 'Access opens immediately after payment · Cancel anytime' },
} as const;

type K = keyof typeof I18N;

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

function TableCell({ v, rtl }: { v: CellV; rtl: boolean }) {
  if (v === 'check') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(74,124,89,.18)', color: 'var(--bull-t)', fontSize: 11, fontWeight: 800 }}>✓</span>
  );
  if (v === 'cross') return (
    <span style={{ color: 'rgba(255,255,255,.22)', fontSize: 14, fontWeight: 600 }}>✕</span>
  );
  if (v === 'dash') return (
    <span style={{ color: 'rgba(255,255,255,.22)', fontSize: 14 }}>—</span>
  );
  return (
    <span dir={rtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.75)' }}>
      {v}
    </span>
  );
}

function FAQItem({ q, a, rtl }: { q: string; a: string; rtl: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border2)', background: 'rgba(13,13,15,.4)' }}>
      <button className="w-full flex items-center justify-between gap-5 p-6"
        dir={rtl ? 'rtl' : 'ltr'}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.35, textAlign: 'start' }}>
          {q}
        </span>
        <span style={{
          flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'rgba(212,175,55,.15)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${open ? 'rgba(212,175,55,.3)' : 'rgba(255,255,255,.1)'}`,
          color: open ? 'var(--gold)' : 'rgba(255,255,255,.5)',
          fontSize: 16, fontWeight: 700, lineHeight: 1,
          transition: 'transform 220ms ease, background 220ms, border-color 220ms',
          transform: open ? 'rotate(45deg)' : 'none',
        }}>+</span>
      </button>
      {open && (
        <div className="px-6 pb-6 border-t" dir={rtl ? 'rtl' : 'ltr'} style={{ borderColor: 'var(--border2)' }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.9, color: 'rgba(255,255,255,.5)', paddingTop: 18 }}>
            {a}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="relative overflow-hidden text-center" style={{ paddingTop: 118, paddingBottom: 104 }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(212,175,55,.1), transparent 60%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px)',
        backgroundSize: '62px 62px',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%,black,transparent)',
        maskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%,black,transparent)',
      }} />
      <div className="wrap">
        <span className="kicker mb-8" style={{ display: 'inline-flex' }}>{t('badge')}</span>
        <h1 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto"
          style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.8rem,4.8vw,4.8rem)', fontWeight: 800, lineHeight: 1.08, maxWidth: '16ch' }}
          dangerouslySetInnerHTML={{ __html: t('h1_html') }} />
        <p dir={rtl ? 'rtl' : 'ltr'} className="mx-auto mt-8"
          style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(1rem,1.8vw,1.12rem)', lineHeight: 1.8, color: 'rgba(255,255,255,.52)', maxWidth: 680 }}>
          {t('hero_sub')}
        </p>
      </div>
    </section>
  );
}

// ─── PLAN CARDS ───────────────────────────────────────────────────────────────

function PlanCards({ t, rtl, lang }: { t: (k: K) => string; rtl: boolean; lang: Lang }) {
  const tl = (b: BiStr) => b[lang];
  return (
    <section className="border-t border-[var(--border)]">
      <div className="wrap" style={{ paddingTop: 80, paddingBottom: 96 }}>
        <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 22, alignItems: 'stretch' }}>
          {PLANS.map(plan => (
            <div key={plan.key} className="relative" style={{ paddingTop: plan.featured ? 22 : 0 }}>
              {/* Popular badge - floats above card */}
              {plan.featured && (
                <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 10, whiteSpace: 'nowrap' }}>
                  <span className="rounded-full px-4 py-1" style={{
                    fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '.16em',
                    color: '#000', background: 'var(--gold)',
                    boxShadow: '0 0 18px rgba(212,175,55,.5)',
                  }}>{t('pop')}</span>
                </div>
              )}

              {/* Card */}
              <div className="flex flex-col h-full hover:-translate-y-1 transition-transform duration-300 rounded-[14px] border"
                style={{
                  background: plan.featured ? 'rgba(212,175,55,.04)' : 'rgba(13,13,15,.55)',
                  borderColor: plan.featured ? 'rgba(212,175,55,.45)' : 'var(--border2)',
                  padding: '34px 30px',
                  boxShadow: plan.featured ? '0 0 60px rgba(212,175,55,.15), inset 0 0 0 1px rgba(212,175,55,.08)' : 'none',
                }}>

                {/* Tag */}
                <span className="self-start rounded px-2.5 py-1 mb-5" style={{
                  fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '.18em',
                  color: 'var(--gold)', background: 'rgba(212,175,55,.1)',
                  border: '1px solid rgba(212,175,55,.2)',
                }}>{tl(plan.tag)}</span>

                {/* Plan name */}
                <p dir="ltr" style={{
                  fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 800, lineHeight: 1,
                  color: plan.featured ? 'var(--gold)' : '#fff', marginBottom: 20,
                }}>{tl(plan.name)}</p>

                {/* Price */}
                <div dir="ltr" className="flex items-baseline gap-2 pb-6 mb-6 border-b" style={{ borderColor: 'var(--border2)' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 44, fontWeight: 800, lineHeight: 1, color: plan.amtColor }}>
                    {tl(plan.amt)}
                  </span>
                  {plan.unit && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.38)' }}>
                      {tl(plan.unit)}
                    </span>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-4 flex-1 mb-8">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-3" dir={rtl ? 'rtl' : 'ltr'}>
                      <span style={{
                        flexShrink: 0, marginTop: 2,
                        width: 18, height: 18, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: f.on ? 'rgba(74,124,89,.18)' : 'rgba(255,255,255,.05)',
                        fontSize: 9, fontWeight: 800,
                        color: f.on ? 'var(--bull-t)' : 'rgba(255,255,255,.22)',
                      }}>
                        {f.on ? '✓' : '✕'}
                      </span>
                      <span style={{
                        fontFamily: 'var(--sans)', fontSize: '0.88rem', lineHeight: 1.6,
                        color: f.on ? 'rgba(255,255,255,.78)' : 'rgba(255,255,255,.28)',
                      }}>
                        {tl(f.text)}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Link href={plan.href}
                  className={plan.ctaGold ? 'btn-gold' : 'btn-ghost'}
                  style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: 10 }}>
                  {tl(plan.cta)}
                </Link>

                {/* Fine print */}
                <p className="text-center" style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: '.06em' }}>
                  {tl(plan.fine)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── COMPARISON TABLE ─────────────────────────────────────────────────────────

function ComparisonTable({ t, rtl, lang }: { t: (k: K) => string; rtl: boolean; lang: Lang }) {
  const tl = (b: BiStr) => b[lang];

  // Override text-only cells per lang
  const resolveCell = (row: TableRow, col: 'b' | 'p' | 'd'): CellV => {
    const v = row[col];
    // Dashboard row — basic is a limited "taste"
    if (row.feat.en === 'Dashboard access' && col === 'b') {
      return t('r_dash_b');
    }
    // Support row
    if (row.feat.en === 'Support') {
      if (col === 'b') return t('r7_b');
      if (col === 'p') return t('r7_p');
      if (col === 'd') return t('r7_d');
    }
    return v;
  };

  const thStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.14em', color: 'rgba(255,255,255,.55)', padding: '18px 20px',
    textAlign: 'center', whiteSpace: 'pre-line',
  };

  return (
    <section className="border-t border-[var(--border)]" style={{ paddingTop: 80, paddingBottom: 96 }}>
      <div className="wrap">
        <Reveal>
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('tbl_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="sec-title text-white mb-2">{t('tbl_h2')}</h2>
          <p dir={rtl ? 'rtl' : 'ltr'} className="sec-sub mb-10">{t('tbl_sub')}</p>
        </Reveal>

        <Reveal delay={80}>
          {/* horizontal scroll on mobile */}
          <div className="overflow-x-auto rounded-[14px] border" style={{ borderColor: 'var(--border2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 580 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
                  <th style={{ ...thStyle, textAlign: rtl ? 'right' : 'left', paddingInlineStart: 28 }}>
                    {t('tbl_col0')}
                  </th>
                  {/* BASIC */}
                  <th style={thStyle}>BASIC<br /><span style={{ color: 'var(--bull-t)', fontSize: 10 }}>{lang === 'he' ? 'חינם' : 'Free'}</span></th>
                  {/* PRO — highlighted */}
                  <th style={{ ...thStyle, background: 'rgba(212,175,55,.06)', borderInline: '1px solid rgba(212,175,55,.18)' }}>
                    PRO<br /><span style={{ color: 'var(--gold)', fontSize: 10 }}>{lang === 'he' ? '99 ₪' : '₪99'}</span>
                  </th>
                  {/* DELUXE */}
                  <th style={thStyle}>DELUXE<br /><span style={{ color: 'rgba(255,255,255,.45)', fontSize: 10 }}>{lang === 'he' ? '199 ₪' : '₪199'}</span></th>
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < TABLE_ROWS.length - 1 ? '1px solid var(--border2)' : undefined }}>
                    {/* Feature label */}
                    <td dir={rtl ? 'rtl' : 'ltr'} style={{
                      padding: '16px 20px', paddingInlineStart: 28,
                      fontFamily: 'var(--sans)', fontSize: '0.88rem', fontWeight: 500,
                      color: 'rgba(255,255,255,.72)',
                    }}>
                      {tl(row.feat)}
                    </td>
                    {/* BASIC */}
                    <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                      <TableCell v={resolveCell(row, 'b')} rtl={rtl} />
                    </td>
                    {/* PRO — highlighted */}
                    <td style={{ padding: '16px 20px', textAlign: 'center', background: 'rgba(212,175,55,.04)', borderInline: '1px solid rgba(212,175,55,.12)' }}>
                      <TableCell v={resolveCell(row, 'p')} rtl={rtl} />
                    </td>
                    {/* DELUXE */}
                    <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                      <TableCell v={resolveCell(row, 'd')} rtl={rtl} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function FAQ({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const items = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3') },
    { q: t('faq_q4'), a: t('faq_a4') },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ paddingTop: 80, paddingBottom: 96 }}>
      <div className="wrap">
        <Reveal>
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('faq_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="sec-title text-white mb-2">{t('faq_h2')}</h2>
          <p dir={rtl ? 'rtl' : 'ltr'} className="sec-sub mb-10">{t('faq_sub')}</p>
        </Reveal>

        <Reveal delay={80}>
          <div className="space-y-3 mx-auto" style={{ maxWidth: 780 }}>
            {items.map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} rtl={rtl} />
            ))}
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
        style={{ background: 'radial-gradient(circle at 50% 40%, rgba(212,175,55,.1), transparent 65%)' }} />
      <div className="wrap">
        <Reveal>
          <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('cta_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto mt-4"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.4rem,5vw,4rem)', fontWeight: 800, lineHeight: 1.12, maxWidth: '18ch' }}
            dangerouslySetInnerHTML={{ __html: t('cta_h2_html') }} />
          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6 mx-auto"
            style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', lineHeight: 1.75, color: 'rgba(255,255,255,.52)', maxWidth: 560 }}>
            {t('cta_body')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link href="/checkout?plan=pro"    className="btn-lg-gold">{t('cta_pro')}</Link>
            <Link href="/checkout?plan=deluxe" className="btn-lg-ghost">{t('cta_deluxe')}</Link>
          </div>
          <p className="mt-8"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.28)', letterSpacing: '.08em' }}>
            {t('cta_lock')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const { lang } = useMarketingLang();
  const rtl = lang === 'he';
  const t = (key: K): string => (I18N[key] as Record<Lang, string>)[lang];

  return (
    <>
      <Hero             t={t} rtl={rtl} />
      <PlanCards        t={t} rtl={rtl} lang={lang} />
      <ComparisonTable  t={t} rtl={rtl} lang={lang} />
      <FAQ              t={t} rtl={rtl} />
      <FinalCta         t={t} rtl={rtl} />
    </>
  );
}
