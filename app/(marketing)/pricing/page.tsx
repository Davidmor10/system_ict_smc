'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from '../components/LangProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang   = 'he' | 'en';
type BiStr  = { he: string; en: string };
type CellV  = 'check' | 'cross' | 'dash' | string; // string = literal display value

// ─── Plan data ────────────────────────────────────────────────────────────────

// Four plans laid out left-to-right: Free / Starter / Pro (featured) / Deluxe.
// Pro sits in the middle so it reads as "the smart center", not "the top
// price". Starter is deliberately narrow in feature-copy: it's the smallest
// paid step so it's easy to say yes to. The value-per-shekel step FROM
// Starter TO Pro (49→99 for a whole new tier of AI Analytics) is what does
// the actual selling — the copy on the Pro card leans into that.
const PLANS = [
  {
    key: 'free', featured: false,
    tag:      { he: 'היכרות',           en: 'Introduction'          } as BiStr,
    name:     { he: 'FREE',             en: 'FREE'                  } as BiStr,
    amt:      { he: 'חינם',             en: 'Free'                  } as BiStr,
    amtColor: 'var(--bull-t)',
    unit:     null as BiStr | null,
    features: [
      { text: { he: 'חשבון חינמי להיכרות עם המערכת',          en: 'Free account to explore the system'            } as BiStr, on: true  },
      { text: { he: 'דאשבורד, יומן מסחר, סטאפים וחוקים — גישה מלאה', en: 'Dashboard, trade journal, setups & rules — full access' } as BiStr, on: true  },
      { text: { he: 'ללא ניתוח AI, אנליטיקס או מאמן AI',       en: 'No AI insights, analytics or coach'            } as BiStr, on: false },
    ],
    cta:      { he: 'התחל בחינם',               en: 'Get Started Free'       } as BiStr,
    href:     '/sign-up',
    ctaGold:  false,
    fine:     { he: 'ללא כרטיס אשראי',          en: 'No credit card required' } as BiStr,
  },
  {
    key: 'starter', featured: false,
    tag:      { he: 'הצעד הראשון',       en: 'First Step'            } as BiStr,
    name:     { he: 'STARTER',          en: 'STARTER'               } as BiStr,
    amt:      { he: '49',               en: '49'                    } as BiStr,
    amtColor: '#fff',
    unit:     { he: '₪ / חודש',         en: '₪ / mo'               } as BiStr,
    features: [
      { text: { he: 'כל מה שיש ב-FREE',                             en: 'Everything in FREE'                           } as BiStr, on: true  },
      { text: { he: 'פאנל AI Insight נפתח ביומן — תובנה לכל עסקה', en: 'AI Insight panel unlocked — one takeaway per trade' } as BiStr, on: true  },
      { text: { he: 'ללא עמוד ה-AI Analytics',                     en: 'No AI Analytics page'                         } as BiStr, on: false },
      { text: { he: 'ללא המאמן האישי',                              en: 'No AI Coach'                                  } as BiStr, on: false },
    ],
    cta:      { he: 'הצטרף ל-STARTER',          en: 'Join STARTER'          } as BiStr,
    href:     '/checkout?plan=starter',
    ctaGold:  false,
    fine:     { he: 'חיוב חודשי · ביטול בכל עת', en: 'Monthly billing · Cancel anytime' } as BiStr,
  },
  {
    key: 'pro', featured: true,
    tag:      { he: 'מרוויח בערך פי שניים ב-50 ₪ בלבד יותר', en: 'Twice the value for ₪50 more' } as BiStr,
    name:     { he: 'PRO',              en: 'PRO'                   } as BiStr,
    amt:      { he: '99',               en: '99'                    } as BiStr,
    amtColor: 'var(--gold)',
    unit:     { he: '₪ / חודש',         en: '₪ / mo'               } as BiStr,
    features: [
      { text: { he: 'כל מה שיש ב-STARTER',                         en: 'Everything in STARTER'                        } as BiStr, on: true  },
      { text: { he: 'עמוד ה-AI Analytics המלא נפתח',               en: 'Full AI Analytics page unlocked'              } as BiStr, on: true  },
      { text: { he: 'זיהוי דפוסים חוזרים + סימולטור תרחישים + דוח שבועי', en: 'Pattern memory + what-if simulator + weekly report' } as BiStr, on: true  },
      { text: { he: 'ללא המאמן האישי',                              en: 'No AI Coach'                                  } as BiStr, on: false },
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
      { text: { he: 'כל מה שיש ב-PRO',                              en: 'Everything in PRO'                            } as BiStr, on: true  },
      { text: { he: 'המאמן האישי נפתח — שיחה שקוראת את היומן שלך', en: 'Personal AI Coach unlocked — chat that reads your journal' } as BiStr, on: true  },
      { text: { he: 'היסטוריית שיחות עם המאמן, נשמרת פר סוחר',     en: 'Coach chat history saved per trader'          } as BiStr, on: true  },
      { text: { he: 'עדיפות בעדכונים ובפיצ׳רים חדשים',             en: 'Priority on updates & new features'           } as BiStr, on: true  },
    ],
    cta:      { he: 'הצטרף ל-DELUXE',           en: 'Join DELUXE'           } as BiStr,
    href:     '/checkout?plan=deluxe',
    ctaGold:  false,
    fine:     { he: 'חיוב חודשי · ביטול בכל עת', en: 'Monthly billing · Cancel anytime' } as BiStr,
  },
] as const;

// ─── Comparison table rows ────────────────────────────────────────────────────

// f=Free, s=Starter, p=Pro, d=Deluxe (single-letter column keys keep the
// table rendering loop compact).
type TableRow = { feat: BiStr; f: CellV; s: CellV; p: CellV; d: CellV };

const TABLE_ROWS: TableRow[] = [
  { feat: { he: 'דאשבורד, יומן מסחר, סטאפים וחוקים', en: 'Dashboard, journal, setups & rules' }, f: 'check', s: 'check', p: 'check', d: 'check' },
  { feat: { he: 'מחברת סוחר וסנכרון מכשירים',        en: 'Trader notebook & device sync'  }, f: 'check', s: 'check', p: 'check', d: 'check' },
  { feat: { he: 'AI Insight ביומן (תובנה לכל עסקה)', en: 'AI Insight in journal (per-trade takeaway)' }, f: 'cross', s: 'check', p: 'check', d: 'check' },
  { feat: { he: 'עמוד AI Analytics המלא',            en: 'Full AI Analytics page'         }, f: 'cross', s: 'cross', p: 'check', d: 'check' },
  { feat: { he: 'זיהוי דפוסים + סימולטור + דוח שבועי + ארכיון', en: 'Patterns + simulator + weekly report & archive' }, f: 'cross', s: 'cross', p: 'check', d: 'check' },
  { feat: { he: 'המאמן האישי (שיחה שקוראת את היומן)', en: 'Personal AI Coach (chat reads your journal)' }, f: 'cross', s: 'cross', p: 'cross', d: 'check' },
  { feat: { he: 'תמיכה',                             en: 'Support'                        }, f: '—',     s: '—',     p: '—',     d: '—'     }, // overridden per lang below
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
  // Support row per-lang labels — four tiers, four levels of support.
  r7_f: { he: 'קהילתית',         en: 'Community'      },
  r7_s: { he: 'בסיסית',         en: 'Basic'          },
  r7_p: { he: 'מהירה',           en: 'Fast'           },
  r7_d: { he: 'מועדפת · VIP',   en: 'Priority · VIP' },

  // FAQ — the central question is now Starter vs Pro (the value-jump
  // between them is what actually drives revenue).
  faq_kicker: { he: 'שאלות נפוצות',   en: 'FAQ' },
  faq_h2:     { he: 'שאלות נפוצות',   en: 'Frequently Asked Questions' },
  faq_sub:    { he: 'מה שכדאי לדעת לפני שמצטרפים', en: 'What you should know before joining' },
  faq_q1: { he: 'מה ההבדל בין STARTER ל-PRO?', en: 'What\'s the difference between STARTER and PRO?' },
  faq_a1: {
    he: 'STARTER (49 ₪) פותח את פאנל ה-AI Insight ביומן — תובנה קצרה שהמערכת מוציאה על כל עסקה שתיעדת. PRO (99 ₪) לוקח את זה שלב הלאה: כל עמוד ה-AI Analytics המלא נפתח — זיהוי דפוסים חוזרים, סימולטור תרחישים ("מה היה קורה אם רק סחרתי בסשן NY?"), דוח שבועי מלא עם ארכיון היסטורי. בגלל שההפרש הוא 50 ₪ בלבד תמורת שכבה שלמה של יכולות, PRO יוצא כמעט תמיד המסלול המשתלם ביותר.',
    en: 'STARTER (₪49) opens the AI Insight panel in the journal — a short takeaway the system generates on every trade you log. PRO (₪99) takes it a full layer further: the entire AI Analytics page unlocks — recurring pattern detection, a what-if simulator ("what if I only traded the NY session?"), a full weekly report with historical archive. Because the gap is only ₪50 for a whole new tier of capability, PRO almost always ends up being the highest-value plan.',
  },
  faq_q2: { he: 'ואז מתי בכלל לעבור ל-DELUXE?', en: 'So when does DELUXE make sense?' },
  faq_a2: {
    he: 'DELUXE (199 ₪) מוסיף מעל ה-PRO את המאמן האישי — שיחה שקוראת את היומן שלך בזמן אמת ועונה על שאלות מסחר בהתבסס על הנתונים והמושגים האמיתיים שלך. אם אתה מרגיש שאתה צריך שותף לחשיבה שיודע את היומן שלך על בוריו — DELUXE הוא הבחירה. אחרת PRO מספיק בהחלט.',
    en: 'DELUXE (₪199) adds the personal AI Coach on top of everything PRO has — a chat that reads your journal live and answers trading questions grounded in your actual data and concepts. If you feel you need a thinking partner that knows your journal inside out — DELUXE is the pick. Otherwise PRO is more than enough.',
  },
  faq_q3: { he: 'יש התחייבות? אפשר לשדרג/לבטל?', en: 'Any commitment? Can I upgrade or cancel?' },
  faq_a3: {
    he: 'אין התחייבות. כל המסלולים בתשלום חודשי, ניתנים לביטול בכל רגע, ומשדרגים בין המסלולים באמצע חודש בפרו־רייטה. אם ביטלת — תישאר עם הגישה עד סוף החודש ששולם.',
    en: 'No commitment. All plans are monthly, cancellable anytime, and upgrades between tiers mid-cycle are prorated. If you cancel — you keep access until the end of the paid month.',
  },
  faq_q4: { he: 'מה כולל החשבון החינמי?', en: 'What does the free account include?' },
  faq_a4: {
    he: 'FREE נותן לך גישה מלאה וחינמית לדאשבורד, ליומן המסחר, למחברת, לסטאפים ולחוקים. מה שנשאר לתשלום זו שכבת ה-AI: תובנה אישית ליומן ב-STARTER, אנליטיקס מלא ב-PRO, ומאמן אישי ב-DELUXE.',
    en: 'FREE gives you full, free access to the dashboard, the trade journal, the notebook, setups and rules. What stays paid is the AI layer: per-trade insights on STARTER, full analytics on PRO, and the personal coach on DELUXE.',
  },

  // CTA
  cta_kicker:  { he: 'מוכן להתחיל?', en: 'Ready to Start?' },
  cta_h2_html: {
    he: 'תפסיק לנחש.<br>תתחיל לסחור לפי ה<span style="color:var(--gold)">מודל.</span>',
    en: 'Stop guessing.<br>Start trading the <span style="color:var(--gold)">model.</span>',
  },
  cta_body: {
    he: 'הצטרף עכשיו, והמסוף נפתח לך מיד. הרוב מתחיל ב-PRO — היחס ערך/מחיר הכי טוב בסולם. תמיד אפשר לשדרג ל-DELUXE (או להתחיל קטן עם STARTER) בהמשך.',
    en: 'Join now and the terminal opens immediately. Most people start on PRO — the best value on the ladder. You can always upgrade to DELUXE later (or start small with STARTER).',
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4" style={{ gap: 18, alignItems: 'stretch' }}>
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

  // Override text-only cells per lang. Support-row labels are the only
  // per-lang overrides that don't fit as a raw check/cross/dash.
  const resolveCell = (row: TableRow, col: 'f' | 's' | 'p' | 'd'): CellV => {
    const v = row[col];
    if (row.feat.en === 'Support') {
      if (col === 'f') return t('r7_f');
      if (col === 's') return t('r7_s');
      if (col === 'p') return t('r7_p');
      if (col === 'd') return t('r7_d');
    }
    return v;
  };

  const thStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.14em', color: 'rgba(255,255,255,.55)', padding: '18px 16px',
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
          {/* horizontal scroll on mobile — 4 columns need real width */}
          <div className="overflow-x-auto rounded-[14px] border" style={{ borderColor: 'var(--border2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
                  <th style={{ ...thStyle, textAlign: rtl ? 'right' : 'left', paddingInlineStart: 28 }}>
                    {t('tbl_col0')}
                  </th>
                  <th style={thStyle}>FREE<br /><span style={{ color: 'var(--bull-t)', fontSize: 10 }}>{lang === 'he' ? 'חינם' : 'Free'}</span></th>
                  <th style={thStyle}>STARTER<br /><span style={{ color: 'rgba(255,255,255,.45)', fontSize: 10 }}>{lang === 'he' ? '49 ₪' : '₪49'}</span></th>
                  {/* PRO — highlighted */}
                  <th style={{ ...thStyle, background: 'rgba(212,175,55,.06)', borderInline: '1px solid rgba(212,175,55,.18)' }}>
                    PRO<br /><span style={{ color: 'var(--gold)', fontSize: 10 }}>{lang === 'he' ? '99 ₪' : '₪99'}</span>
                  </th>
                  <th style={thStyle}>DELUXE<br /><span style={{ color: 'rgba(255,255,255,.45)', fontSize: 10 }}>{lang === 'he' ? '199 ₪' : '₪199'}</span></th>
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < TABLE_ROWS.length - 1 ? '1px solid var(--border2)' : undefined }}>
                    <td dir={rtl ? 'rtl' : 'ltr'} style={{
                      padding: '16px 20px', paddingInlineStart: 28,
                      fontFamily: 'var(--sans)', fontSize: '0.88rem', fontWeight: 500,
                      color: 'rgba(255,255,255,.72)',
                    }}>
                      {tl(row.feat)}
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'center' }}>
                      <TableCell v={resolveCell(row, 'f')} rtl={rtl} />
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'center' }}>
                      <TableCell v={resolveCell(row, 's')} rtl={rtl} />
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'center', background: 'rgba(212,175,55,.04)', borderInline: '1px solid rgba(212,175,55,.12)' }}>
                      <TableCell v={resolveCell(row, 'p')} rtl={rtl} />
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'center' }}>
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
