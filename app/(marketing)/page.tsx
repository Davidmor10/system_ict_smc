'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from './components/LangProvider';

// ─── I18N ─────────────────────────────────────────────────────────────────────

type Lang = 'he' | 'en';
type BiStr = { he: string; en: string };

const I18N = {
  // HERO
  hero_badge:  { he: 'נבנה לסוחרי חוזים · ES · NQ', en: 'Built for futures traders · ES · NQ' },
  hero_h1: {
    he: 'תבין את המסחר שלך.<br>תשלוט <span style="color:var(--gold)">בעצמך.</span>',
    en: 'Understand your trading.<br>Master <span style="color:var(--gold)">yourself.</span>',
  },
  hero_sub: {
    he: 'Onyx הוא לא עוד יומן מסחר. הוא שותף שלומד אותך לאורך חודשים — ומראה לך מה באמת עובד, איפה אתה מאבד עקביות, ואיפה נמצא היתרון האמיתי שלך. הוא לא מחליף אותך. הוא עוזר לך להשתפר.',
    en: "Onyx isn't another trading journal. It's a partner that studies you over months — showing you what actually works, where you lose consistency, and where your real edge lives. It doesn't replace you. It helps you improve.",
  },
  hero_cta1:   { he: 'התחל תקופת ניסיון', en: 'Start Free Trial' },
  hero_cta2:   { he: 'איך זה עובד',        en: 'See How It Works' },
  hero_m1:     { he: 'ES · NQ בלבד',       en: 'ES · NQ only' },
  hero_m2:     { he: 'שיטת ICT · SMC',     en: 'ICT · SMC method' },
  hero_m3:     { he: 'AI שלומד אותך',      en: 'AI that learns you' },

  // PROBLEM
  prob_kicker: { he: 'הבעיה', en: 'The Problem' },
  prob_h2: {
    he: 'רוב הסוחרים לא נכשלים<br>בגלל חוסר <span style="color:var(--gold)">באסטרטגיה.</span>',
    en: "Most traders don't fail<br>for lack of a <span style=\"color:var(--gold)\">strategy.</span>",
  },
  prob_body: {
    he: 'הם נכשלים כי הם לא מבינים את עצמם. אותו סטאפ מנצח בבוקר ומדמם אחר הצהריים. אותה טעות חוזרת חודשים. האסטרטגיה אף פעם לא הייתה החלק החסר — ההיכרות עם עצמך הייתה.',
    en: "They fail because they don't understand themselves. The same setup wins in the morning and bleeds in the afternoon. The same mistake repeats for months. Strategy was never the missing piece — self-knowledge was.",
  },
  prob_c1_t: { he: 'טעות שחוזרת', en: 'A repeating mistake' },
  prob_c1_b: { he: 'אותה שגיאה מופיעה שוב ושוב — בלי שאף אחד מצביע עליה בזמן אמת.', en: 'The same error shows up again and again — with nothing pointing it out in real time.' },
  prob_c2_t: { he: 'יתרון שמסתתר', en: 'A hidden edge' },
  prob_c2_b: { he: 'היתרון האמיתי שלך חבוי בתנאים מאוד ספציפיים שאתה אפילו לא רואה.', en: 'Your real edge is buried in very specific conditions you never even see.' },
  prob_c3_t: { he: 'עקביות שנשברת', en: 'Consistency that breaks' },
  prob_c3_b: { he: 'הביצועים נשברים ברגעים צפויים — סשן מסוים, עסקה שלישית ביום, אחרי הפסד.', en: 'Performance breaks at predictable moments — a certain session, the third trade of the day, after a loss.' },

  // ECOSYSTEM
  eco_kicker: { he: 'המערכת', en: 'The Ecosystem' },
  eco_h2: {
    he: 'מערכת אחת.<br>כל חלק <span style="color:var(--gold)">מחובר.</span>',
    en: 'One system.<br>Every part <span style="color:var(--gold)">connected.</span>',
  },
  eco_sub: { he: 'לא חמישה כלים נפרדים — אורגניזם אחד שבו כל עסקה מזינה את הבא.', en: "Not five separate tools — one organism where every trade feeds the next." },
  eco1_t: { he: 'יומן מסחר', en: 'Trading Journal' },
  eco1_b: { he: 'כל עסקה נחתמת עם סשן, שעה, סטאפ ומצב רגשי — בסיס הנתונים שממנו הכל נבנה.', en: 'Every trade is stamped with session, time, setup and emotion — the data everything else is built on.' },
  eco2_t: { he: 'מאמן AI', en: 'AI Coach' },
  eco2_b: { he: 'שיחה חיה עם מנתח שמכיר רק את הנתונים שלך, ועונה עליהם בכנות.', en: 'A live conversation with an analyst that knows only your data — and answers from it honestly.' },
  eco3_t: { he: 'סטטיסטיקות', en: 'Statistics' },
  eco3_b: { he: 'אחוזי הצלחה חתוכים לפי סשן, סטאפ, יישור ביאס ויום — שחור על גבי לבן.', en: 'Win rates cut by session, setup, bias alignment and day — in black and white.' },
  eco4_t: { he: 'תוכנית מסחר', en: 'Trading Plan' },
  eco4_b: { he: 'הכללים והסטאפים שלך במקום אחד, מול הביצועים בפועל של כל אחד מהם.', en: 'Your rules and setups in one place, against how each one actually performs.' },
  eco5_t: { he: 'אינטליגנציית סוחר', en: 'Trader Intelligence' },
  eco5_b: { he: 'שכבת ה-AI שלומדת אותך לאורך זמן ובונה פרופיל מתפתח של הסוחר שאתה.', en: 'The AI layer that studies you over time and builds an evolving profile of the trader you are.' },

  // AI INTELLIGENCE
  ai_kicker: { he: 'אינטליגנציה', en: 'AI Intelligence' },
  ai_h2: {
    he: 'AI שלומד אותך,<br>עסקה אחרי <span style="color:var(--gold)">עסקה.</span>',
    en: 'An AI that learns you,<br>trade after <span style="color:var(--gold)">trade.</span>',
  },
  ai_body: {
    he: 'כל עסקה שאתה מתעד מלמדת את המערכת עוד משהו עליך. היא מזהה דפוסים חוזרים, מנסחת השערה על היתרון שלך, ומחדדת אותה ככל שנכנסים נתונים. לא קופסה שחורה — כל תובנה מגיעה עם המספר שמאחוריה.',
    en: 'Every trade you log teaches the system something about you. It surfaces recurring patterns, forms a hypothesis about your edge, and sharpens it as more data arrives. Never a black box — every insight comes with the number behind it.',
  },
  ai_p1_t: { he: 'שיחות', en: 'Conversations' },
  ai_p1_b: { he: 'שאל כל דבר על המסחר שלך וקבל תשובה מבוססת נתונים, לא עצה גנרית.', en: 'Ask anything about your trading and get a data-backed answer, not generic advice.' },
  ai_p2_t: { he: 'תגליות', en: 'Discoveries' },
  ai_p2_b: { he: 'המערכת מצביעה על דברים שלא ידעת — צירופי תנאים שבהם אתה חזק או חלש.', en: "The system points out things you didn't know — condition combos where you're strong or weak." },
  ai_p3_t: { he: 'דפוסים', en: 'Patterns' },
  ai_p3_b: { he: 'דפוסים חוזרים נמדדים לאורך זמן: מתחזקים, נחלשים או נעלמים.', en: 'Recurring patterns tracked over time: strengthening, weakening, or fading.' },
  ai_p4_t: { he: 'שיפור', en: 'Improvement' },
  ai_p4_b: { he: 'ציון יתרון וציון למידה מראים אם אתה באמת משתפר, לא רק מרגיש ככה.', en: "An edge score and a learning score show whether you're truly improving, not just feeling it." },

  // JOURNEY
  jr_kicker: { he: 'המסע', en: 'The Journey' },
  jr_h2:     { he: 'מעגל אחד שסוגר את עצמו.', en: 'One loop that closes itself.' },
  jr_sub:    { he: 'כל סיבוב עושה אותך סוחר קצת יותר טוב מהקודם.', en: 'Each turn makes you a slightly better trader than the last.' },
  jr_s1: { he: 'תכנון', en: 'Planning' },
  jr_s2: { he: 'מסחר', en: 'Trading' },
  jr_s3: { he: 'תיעוד', en: 'Journal' },
  jr_s4: { he: 'ה-AI לומד', en: 'AI learns' },
  jr_s5: { he: 'דפוסים מתגלים', en: 'Patterns found' },
  jr_s6: { he: 'הסוחר משתפר', en: 'You improve' },

  // FEATURES
  feat_kicker: { he: 'יכולות', en: 'Capabilities' },
  feat_h2:     { he: 'כל מה שהמודל צריך.', en: 'Everything the model needs.' },
  feat_sub:    { he: 'חמש יכולות ליבה, בנויות זו לתוך זו.', en: 'Five core capabilities, built into one another.' },
  f1_t: { he: 'יומן מסחר', en: 'Journal' },
  f1_b: { he: 'תיעוד עשיר עם יציאות מרובות, תגיות אישור ומצב רגשי — הסשן והתוצאה נגזרים אוטומטית.', en: 'Rich logging with multi-leg exits, confirmation tags and emotional state — session and result derived automatically.' },
  f2_t: { he: 'מאמן AI', en: 'AI Coach' },
  f2_b: { he: 'מנתח שיחה שמעוגן אך ורק בעובדות שלך, ויודע להפריד בין מה שהוא יודע למה שעדיין לא.', en: 'A conversational analyst grounded only in your facts, that separates what it knows from what it cannot yet.' },
  f3_t: { he: 'סטטיסטיקות', en: 'Statistics' },
  f3_b: { he: 'פירוק ביצועים לפי כל חתך — סשן, סטאפ, כיוון, שעה, יום — עם רמת ביטחון לכל מספר.', en: 'Performance broken down by every slice — session, setup, direction, hour, day — with a confidence level on each number.' },
  f4_t: { he: 'תוכנית מסחר', en: 'Trading Plan' },
  f4_b: { he: 'ספר הסטאפים והכללים שלך, מחובר ישירות לתוצאות בפועל של כל אחד מהם.', en: 'Your playbook of setups and rules, wired straight to how each one actually performs.' },
  f5_t: { he: 'אינטליגנציית סוחר', en: 'Trader Intelligence' },
  f5_b: { he: 'פרופיל מתמשך שמתעדכן מכל עסקה: זיכרון דפוסים, השערת יתרון וציוני התקדמות.', en: 'A persistent profile that updates from every trade: pattern memory, an edge hypothesis, and progression scores.' },

  // TESTIMONIALS
  tst_kicker: { he: 'סוחרים', en: 'Traders' },
  tst_h2:     { he: 'נבנה לסוחרים רציניים.', en: 'Built for serious traders.' },
  tst_sub:    { he: 'לא לקהל הרחב — למי שמתייחס למסחר כמו למקצוע.', en: 'Not for the crowd — for those who treat trading as a craft.' },
  tst1_q: { he: 'לראשונה ראיתי שחור על לבן שאני שורף את היום בעסקה השלישית. פשוט הפסקתי לקחת אותה.', en: 'For the first time I saw in black and white that I burn my day on the third trade. I simply stopped taking it.' },
  tst1_a: { he: 'סוחר ES במשרה מלאה', en: 'Full-time ES trader' },
  tst2_q: { he: 'זה לא עוד יומן. זה כמו מנטור ששם לב לדברים שאני מפספס על עצמי.', en: "It's not another journal. It's like a mentor that notices what I miss about myself." },
  tst2_a: { he: 'סוחר NQ, שנתיים בשוק', en: 'NQ trader, two years in' },
  tst3_q: { he: 'ציון היתרון גרם לי סוף סוף להפריד בין מזל למיומנות. שינה לי את החודש.', en: 'The edge score finally made me separate luck from skill. It changed my month.' },
  tst3_a: { he: 'סוחר בחברת פרופ', en: 'Prop firm trader' },
  tst_note: { he: 'ציטוטים להמחשה — יוחלפו בהמלצות אמיתיות לפני העלייה לאוויר.', en: 'Illustrative quotes — to be replaced with real testimonials before launch.' },

  // PRICING
  pr_kicker: { he: 'מסלולים', en: 'Pricing' },
  pr_h2:     { he: 'התחל בחינם. שדרג כשתרצה.', en: 'Start free. Upgrade when you want.' },
  pr_sub:    { he: 'אותו לב מערכת בכל מסלול — ההבדל הוא רק כמה רחוק אתה לוקח את זה.', en: 'The same core in every plan — the difference is only how far you take it.' },
  pr_basic_n: { he: 'BASIC', en: 'BASIC' },
  pr_basic_p: { he: 'חינם', en: 'Free' },
  pr_basic_d: { he: 'היכרות עם המערכת', en: 'Explore the system' },
  pr_pro_n:   { he: 'PRO', en: 'PRO' },
  pr_pro_d:   { he: 'לסוחר הפעיל', en: 'For the active trader' },
  pr_deluxe_n:{ he: 'DELUXE', en: 'DELUXE' },
  pr_deluxe_d:{ he: 'ללא תקרות', en: 'No limits' },
  pr_mo:      { he: '₪ / חודש', en: '₪ / mo' },
  pr_start:   { he: 'התחל בחינם', en: 'Start Free' },
  pr_join:    { he: 'הצטרף', en: 'Join' },
  pr_all:     { he: 'להשוואת כל המסלולים ←', en: 'Compare all plans →' },
  pr_pop:     { he: 'הכי פופולרי', en: 'Most Popular' },

  // FAQ
  faq_kicker: { he: 'שאלות נפוצות', en: 'FAQ' },
  faq_h2:     { he: 'שאלות נפוצות', en: 'Frequently asked' },
  faq_q1: { he: 'זה עוד יומן מסחר?', en: 'Is this just another trading journal?' },
  faq_a1: { he: 'לא. יומן הוא נקודת ההתחלה, לא המטרה. Onyx לוקח את מה שאתה מתעד ובונה ממנו הבנה מתפתחת של הסוחר שאתה — דפוסים, יתרון וכיוון שיפור. היומן הוא רק הדלק.', en: 'No. The journal is the starting point, not the goal. Onyx takes what you log and builds an evolving understanding of the trader you are — patterns, edge, and direction of improvement. The journal is just the fuel.' },
  faq_q2: { he: 'המערכת נותנת המלצות קנייה או מכירה?', en: 'Does it give buy or sell signals?' },
  faq_a2: { he: 'אף פעם. Onyx לא מנבא את השוק ולא אומר לך מה לסחור. הוא מסביר את ההיסטוריה שלך ומחדד את ההחלטות שלך — ההכרעה תמיד שלך.', en: 'Never. Onyx does not predict the market or tell you what to trade. It explains your history and sharpens your decisions — the call is always yours.' },
  faq_q3: { he: 'למי זה מתאים?', en: 'Who is this for?' },
  faq_a3: { he: 'לסוחרי חוזים עתידיים על נאסד"ק ו-S&P (NQ ו-ES) שעובדים לפי שיטת ICT ו-SMC. זה לא נבנה לקריפטו או לפורקס — כל פרט מכוון לסוחר החוזים הרציני.', en: 'Futures traders on the Nasdaq and S&P (NQ and ES) working with the ICT and SMC method. It was not built for crypto or forex — every detail is aimed at the serious futures trader.' },
  faq_q4: { he: 'כמה נתונים צריך כדי שזה יהיה שימושי?', en: 'How much data before it becomes useful?' },
  faq_a4: { he: 'אתה מקבל ערך כבר מהעסקאות הראשונות, אבל ככל שאתה מתעד יותר, ההבנה מתחדדת. Onyx תמיד ישר איתך לגבי מתי מדגם קטן מדי כדי לקבוע מסקנה.', en: "You get value from the first trades, but the more you log, the sharper it gets. Onyx is always honest with you about when a sample is too small to conclude." },

  // FINAL CTA
  cta_h2: {
    he: 'זה לא עוד<br>יומן <span style="color:var(--gold)">מסחר.</span>',
    en: "This is not another<br>trading <span style=\"color:var(--gold)\">journal.</span>",
  },
  cta_body: { he: 'זה תוכנה שנבנתה לסוחר החוזים הרציני. התחל בחינם — בלי כרטיס אשראי — ותראה בעצמך.', en: 'This is software built for the serious futures trader. Start free — no credit card — and see for yourself.' },
  cta_main:  { he: 'התחל תקופת ניסיון', en: 'Start Free Trial' },
  cta_ghost: { he: 'צפה במסלולים', en: 'View Pricing' },
  cta_lock:  { he: 'ללא כרטיס אשראי · ביטול בכל עת', en: 'No credit card · Cancel anytime' },
} as const;

type K = keyof typeof I18N;

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
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
    >
      {children}
    </div>
  );
}

function Sep() {
  return <span className="mx-3" style={{ color: 'rgba(255,255,255,.15)' }}>·</span>;
}

// ─── Hero mockup: dashboard preview + floating AI panels ────────────────────────

function HeroMockup({ tl, rtl }: { tl: (b: BiStr) => string; rtl: boolean }) {
  const B = (he: string, en: string): BiStr => ({ he, en });
  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: 560 }}>
      {/* rotating conic glow behind */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div className="onyx-orbit" style={{
          width: '78%', height: '78%',
          background: 'conic-gradient(from 0deg, transparent, rgba(212,175,55,.14), transparent 40%)',
          filter: 'blur(38px)', borderRadius: '50%',
        }} />
      </div>

      {/* main dashboard card */}
      <div className="onyx-glow relative rounded-2xl border overflow-hidden" dir="ltr" style={{ background: 'rgba(10,10,12,.85)', borderColor: 'var(--border2)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border2)', background: 'rgba(0,0,0,.4)' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,.62)' }}>
            Onyx · Intelligence
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--bull-t)' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.16em', color: 'var(--bull-t)', textTransform: 'uppercase' }}>Live</span>
          </span>
        </div>

        <div className="p-5">
          {/* edge score */}
          <div className="rounded-xl border p-5" style={{ background: '#000', borderColor: 'var(--border2)' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,.38)' }}>Edge Score</p>
            <div className="flex items-end gap-3 mt-2">
              <span style={{ fontFamily: 'var(--serif)', fontSize: 48, fontWeight: 800, lineHeight: 1, color: 'var(--gold)' }}>74</span>
              <span className="mb-1" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--bull-t)' }}>▲ +6 · 30d</span>
            </div>
            <div className="flex gap-1 mt-4">
              {[85, 60, 92, 45, 78, 70, 88].map((h, i) => (
                <div key={i} className="flex-1 rounded-sm" style={{ height: 34 }}>
                  <div className="w-full rounded-sm" style={{ height: `${h}%`, marginTop: `${34 - (34 * h / 100)}px`, background: i === 2 ? 'var(--gold)' : 'rgba(212,175,55,.28)' }} />
                </div>
              ))}
            </div>
          </div>

          {/* 2x2 stat cells */}
          <div className="grid grid-cols-2 mt-3 gap-px" style={{ background: 'var(--border2)' }}>
            {[
              { l: tl(B('הסשן החזק', 'Top session')), v: 'NY AM', g: true },
              { l: tl(B('אחוז הצלחה', 'Win rate')), v: '68%', g: false },
              { l: tl(B('פרופיט פקטור', 'Profit factor')), v: '2.31', g: false },
              { l: tl(B('חולשה', 'Weak spot')), v: tl(B('עסקה 3', 'Trade #3')), g: true },
            ].map((c, i) => (
              <div key={i} className="p-3.5" style={{ background: '#000' }}>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)' }}>{c.l}</p>
                <p className="mt-1" dir="ltr" style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: c.g ? 'var(--gold)' : 'rgba(255,255,255,.85)' }}>{c.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* floating AI coach bubble — top */}
      <div className="onyx-float absolute hidden sm:block" style={{ top: -26, [rtl ? 'left' : 'right']: -30, width: 232 }}>
        <div className="rounded-xl border p-3.5" style={{ background: 'rgba(14,13,10,.94)', borderColor: 'rgba(212,175,55,.3)', boxShadow: '0 20px 50px -20px rgba(0,0,0,.8)' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span style={{ color: 'var(--gold)', fontSize: 11 }}>◈</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(212,175,55,.8)' }}>Onyx Coach</span>
          </div>
          <p dir={rtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'var(--sans)', fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,.8)' }}>
            {tl(B('בדקתי 42 עסקאות. אתה חזק ב-NY AM — 71% מול 52% בשאר היום.', "I checked 42 trades. You're strong in NY AM — 71% vs 52% the rest of the day."))}
          </p>
        </div>
      </div>

      {/* floating pattern card — bottom */}
      <div className="onyx-float onyx-float-delay absolute hidden sm:block" style={{ bottom: -22, [rtl ? 'right' : 'left']: -26, width: 210 }}>
        <div className="rounded-xl border p-3.5" style={{ background: 'rgba(10,12,10,.94)', borderColor: 'rgba(74,124,89,.35)', boxShadow: '0 20px 50px -20px rgba(0,0,0,.8)' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--bull-t)' }}>
            {tl(B('דפוס התגלה', 'Pattern found'))}
          </span>
          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-1.5" style={{ fontFamily: 'var(--sans)', fontSize: 12, lineHeight: 1.55, color: 'rgba(255,255,255,.82)' }}>
            {tl(B('IFVG + המשכיות = 2.4R ממוצע', 'IFVG + continuation = 2.4R avg'))}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({ t, tl, rtl }: { t: (k: K) => string; tl: (b: BiStr) => string; rtl: boolean }) {
  return (
    <section className="relative overflow-hidden" style={{ paddingTop: 96, paddingBottom: 104 }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(212,175,55,.12), transparent 58%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px)',
        backgroundSize: '62px 62px',
        WebkitMaskImage: 'radial-gradient(ellipse 85% 60% at 50% 0%,black,transparent)',
        maskImage: 'radial-gradient(ellipse 85% 60% at 50% 0%,black,transparent)',
      }} />

      <div className="wrap">
        <div className="grid grid-cols-1 lg:grid-cols-2 items-center" style={{ gap: 64 }}>
          {/* copy */}
          <div className={rtl ? 'text-right' : 'text-left'}>
            <Reveal>
              <div className="flex items-center gap-2 mb-7" style={{ justifyContent: rtl ? 'flex-end' : 'flex-start' }}>
                <span className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ background: 'var(--bull-t)' }} />
                <span className="uppercase" style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.2em', color: 'rgba(255,255,255,.55)' }}>{t('hero_badge')}</span>
              </div>
              <h1 dir={rtl ? 'rtl' : 'ltr'} className="text-white"
                style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.6rem,4.6vw,4.4rem)', fontWeight: 800, lineHeight: 1.07 }}
                dangerouslySetInnerHTML={{ __html: t('hero_h1') }} />
              <p dir={rtl ? 'rtl' : 'ltr'} className="mt-7"
                style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(1rem,1.5vw,1.12rem)', lineHeight: 1.75, color: 'rgba(255,255,255,.55)', maxWidth: 540, marginInline: rtl ? '0 0' : '0' }}>
                {t('hero_sub')}
              </p>
              <div className="flex flex-wrap items-center gap-4 mt-9" style={{ justifyContent: rtl ? 'flex-end' : 'flex-start' }}>
                <Link href="/sign-up" className="btn-lg-gold">{t('hero_cta1')}</Link>
                <a href="#how" className="btn-lg-ghost">{t('hero_cta2')}</a>
              </div>
              <p className="mt-9 flex flex-wrap items-center" style={{ justifyContent: rtl ? 'flex-end' : 'flex-start', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.16em', color: 'rgba(255,255,255,.36)' }}>
                <span>{t('hero_m1')}</span><Sep /><span>{t('hero_m2')}</span><Sep /><span>{t('hero_m3')}</span>
              </p>
            </Reveal>
          </div>

          {/* mockup */}
          <Reveal delay={160} className="mt-4 lg:mt-0">
            <HeroMockup tl={tl} rtl={rtl} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── PROBLEM ──────────────────────────────────────────────────────────────────

function Problem({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const cards = [
    { t: t('prob_c1_t'), b: t('prob_c1_b'), icon: '↻' },
    { t: t('prob_c2_t'), b: t('prob_c2_b'), icon: '◈' },
    { t: t('prob_c3_t'), b: t('prob_c3_b'), icon: '⚡' },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mx-auto" >
          <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('prob_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto mt-4"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.9rem,3.4vw,2.9rem)', fontWeight: 800, lineHeight: 1.15, maxWidth: '18ch' }}
            dangerouslySetInnerHTML={{ __html: t('prob_h2') }} />
          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6 mx-auto"
            style={{ fontFamily: 'var(--sans)', fontSize: '1.08rem', lineHeight: 1.8, color: 'rgba(255,255,255,.55)', maxWidth: 640 }}>
            {t('prob_body')}
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 mt-14" style={{ gap: 22 }}>
          {cards.map((c, i) => (
            <Reveal key={i} delay={i * 90}>
              <div className="card-lift rounded-[13px] border h-full" dir={rtl ? 'rtl' : 'ltr'}
                style={{ background: 'rgba(13,13,15,.5)', borderColor: 'var(--border)', padding: '30px 28px' }}>
                <div className="flex items-center justify-center rounded-lg mb-5" style={{ width: 44, height: 44, background: 'rgba(212,175,55,.1)' }}>
                  <span style={{ fontSize: 19, color: 'var(--gold)' }}>{c.icon}</span>
                </div>
                <h3 className="text-white" style={{ fontFamily: 'var(--serif)', fontSize: '1.18rem', fontWeight: 700, marginBottom: 9 }}>{c.t}</h3>
                <p style={{ fontFamily: 'var(--sans)', fontSize: '0.92rem', lineHeight: 1.7, color: 'rgba(255,255,255,.5)' }}>{c.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ECOSYSTEM ────────────────────────────────────────────────────────────────

function Ecosystem({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const items = [
    { t: t('eco1_t'), b: t('eco1_b'), icon: '▤' },
    { t: t('eco2_t'), b: t('eco2_b'), icon: '◈' },
    { t: t('eco3_t'), b: t('eco3_b'), icon: '▦' },
    { t: t('eco4_t'), b: t('eco4_b'), icon: '⬡' },
    { t: t('eco5_t'), b: t('eco5_b'), icon: '✦' },
  ];
  return (
    <section id="how" className="border-t border-[var(--border)]" style={{ background: 'var(--bg2)', padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('eco_kicker')}</span>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto mt-4"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.9rem,3.4vw,2.9rem)', fontWeight: 800, lineHeight: 1.15 }}
            dangerouslySetInnerHTML={{ __html: t('eco_h2') }} />
          <p className="sec-sub mt-4 mx-auto" style={{ maxWidth: 520 }}>{t('eco_sub')}</p>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-14" style={{ gap: 20 }}>
          {items.map((it, i) => (
            <Reveal key={i} delay={i * 70} className={i === 4 ? 'lg:col-start-2' : ''}>
              <div className="card-lift rounded-[13px] border h-full" dir={rtl ? 'rtl' : 'ltr'}
                style={{ background: 'rgba(5,5,6,.6)', borderColor: 'var(--border2)', padding: '28px 26px' }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center rounded-lg" style={{ width: 40, height: 40, background: 'rgba(212,175,55,.1)' }}>
                    <span style={{ fontSize: 17, color: 'var(--gold)' }}>{it.icon}</span>
                  </div>
                  <h3 className="text-white" style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 700 }}>{it.t}</h3>
                </div>
                <p style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.7, color: 'rgba(255,255,255,.5)' }}>{it.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── AI INTELLIGENCE ──────────────────────────────────────────────────────────

function Intelligence({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const panels = [
    { t: t('ai_p1_t'), b: t('ai_p1_b') },
    { t: t('ai_p2_t'), b: t('ai_p2_b') },
    { t: t('ai_p3_t'), b: t('ai_p3_b') },
    { t: t('ai_p4_t'), b: t('ai_p4_b') },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <div className="grid grid-cols-1 lg:grid-cols-2 items-center" style={{ gap: 56 }}>
          <Reveal>
            <span className="kicker mb-5" style={{ display: 'inline-flex' }}>{t('ai_kicker')}</span>
            <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mt-4"
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.8rem,2.8vw,2.5rem)', fontWeight: 800, lineHeight: 1.18 }}
              dangerouslySetInnerHTML={{ __html: t('ai_h2') }} />
            <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6"
              style={{ fontFamily: 'var(--sans)', fontSize: '1.02rem', lineHeight: 1.8, color: 'rgba(255,255,255,.55)' }}>
              {t('ai_body')}
            </p>
            <div className="grid grid-cols-2 mt-8" style={{ gap: 16 }}>
              {panels.map((p, i) => (
                <div key={i} dir={rtl ? 'rtl' : 'ltr'} className="rounded-xl border p-4"
                  style={{ background: 'rgba(13,13,15,.5)', borderColor: 'var(--border2)' }}>
                  <p className="text-white" style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--gold)' }}>{p.t}</p>
                  <p className="mt-2" style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', lineHeight: 1.6, color: 'rgba(255,255,255,.5)' }}>{p.b}</p>
                </div>
              ))}
            </div>
          </Reveal>

          {/* chat mockup */}
          <Reveal delay={140}>
            <IntelligenceChat rtl={rtl} tl={(b) => b[rtl ? 'he' : 'en']} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function IntelligenceChat({ rtl, tl }: { rtl: boolean; tl: (b: BiStr) => string }) {
  const B = (he: string, en: string): BiStr => ({ he, en });
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(10,10,12,.8)', borderColor: 'var(--border2)', boxShadow: '0 0 70px -18px rgba(212,175,55,.16)' }}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'var(--border2)', background: 'rgba(0,0,0,.4)' }}>
        <span style={{ color: 'var(--gold)' }}>◈</span>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 700, color: '#fff' }}>Onyx Coach</span>
      </div>
      <div className="p-5 space-y-3.5">
        <div dir={rtl ? 'rtl' : 'ltr'} className={rtl ? 'text-right' : 'text-left'}>
          <div className="inline-block rounded-2xl px-4 py-2.5" style={{ background: 'rgba(212,175,55,.12)', border: '1px solid rgba(212,175,55,.25)', maxWidth: '85%' }}>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 13.5, color: '#fff' }}>{tl(B('איפה אני מאבד עקביות?', 'Where do I lose consistency?'))}</p>
          </div>
        </div>
        <div dir={rtl ? 'rtl' : 'ltr'}>
          <div className="rounded-2xl px-4 py-3" style={{ background: '#0a0a0b', border: '1px solid var(--border)' }}>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 13.5, lineHeight: 1.7, color: 'rgba(255,255,255,.82)' }}>
              {tl(B('בדקתי את 128 העסקאות שלך. העקביות נשברת אחר הצהריים — ב-NY PM אתה יורד ל-41% הצלחה על 34 עסקאות, מול 68% ב-NY AM.', "I checked your 128 trades. Consistency breaks in the afternoon — in NY PM you drop to 41% over 34 trades, vs 68% in NY AM."))}
            </p>
            <p className="mt-2.5" style={{ fontFamily: 'var(--sans)', fontSize: 13.5, lineHeight: 1.7, color: 'rgba(255,255,255,.82)' }}>
              {tl(B('זה עוד לא מסקנה חד-משמעית, אבל זה סימן ברור ששווה לשים לב אליו.', "That's not a firm conclusion yet, but it's a clear signal worth watching."))}
            </p>
            <div className="flex gap-1.5 mt-3.5" dir="ltr">
              {[true, true, true, false].map((on, i) => (
                <div key={i} className="h-1 flex-1 rounded-full" style={{ background: on ? 'var(--gold)' : 'rgba(255,255,255,.12)' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── JOURNEY ──────────────────────────────────────────────────────────────────

function Journey({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const steps = [t('jr_s1'), t('jr_s2'), t('jr_s3'), t('jr_s4'), t('jr_s5'), t('jr_s6')];
  return (
    <section className="border-t border-[var(--border)]" style={{ background: 'var(--bg2)', padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('jr_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('jr_h2')}</h2>
          <p className="sec-sub mt-3 mx-auto" style={{ maxWidth: 460 }}>{t('jr_sub')}</p>
        </Reveal>

        <Reveal delay={80}>
          <div className="flex flex-wrap items-stretch justify-center gap-3 mt-14" dir="ltr">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="rounded-xl border flex flex-col items-center justify-center text-center"
                  style={{
                    background: i === 5 ? 'rgba(212,175,55,.08)' : 'rgba(5,5,6,.6)',
                    borderColor: i === 5 ? 'rgba(212,175,55,.4)' : 'var(--border2)',
                    padding: '18px 16px', width: 128, minHeight: 92,
                  }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: i === 5 ? 'var(--gold)' : 'rgba(255,255,255,.32)' }}>0{i + 1}</span>
                  <span className="mt-1.5" style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 700, color: i === 5 ? 'var(--gold)' : '#fff' }}>{s}</span>
                </div>
                {i < steps.length - 1 && (
                  <span className="hidden lg:block" style={{ color: 'rgba(212,175,55,.5)', fontSize: 16 }}>→</span>
                )}
              </div>
            ))}
          </div>
          <div className="mx-auto mt-8 rounded-full onyx-shimmer" style={{ height: 2, maxWidth: 720, background: 'rgba(212,175,55,.12)' }} />
        </Reveal>
      </div>
    </section>
  );
}

// ─── FEATURES ─────────────────────────────────────────────────────────────────

function Features({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const cards = [
    { t: t('f1_t'), b: t('f1_b'), icon: '▤' },
    { t: t('f2_t'), b: t('f2_b'), icon: '◈' },
    { t: t('f3_t'), b: t('f3_b'), icon: '▦' },
    { t: t('f4_t'), b: t('f4_b'), icon: '⬡' },
    { t: t('f5_t'), b: t('f5_b'), icon: '✦' },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-14">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('feat_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('feat_h2')}</h2>
          <p className="sec-sub mt-3 mx-auto" style={{ maxWidth: 460 }}>{t('feat_sub')}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" style={{ gap: 20 }}>
          {cards.map((c, i) => (
            <Reveal key={i} delay={i * 70}>
              <div className="card-lift rounded-[13px] border h-full" dir={rtl ? 'rtl' : 'ltr'}
                style={{ background: 'rgba(13,13,15,.5)', borderColor: 'var(--border)', padding: '30px 28px' }}>
                <div className="flex items-center justify-center rounded-lg mb-5" style={{ width: 44, height: 44, background: 'rgba(212,175,55,.1)' }}>
                  <span style={{ fontSize: 19, color: 'var(--gold)' }}>{c.icon}</span>
                </div>
                <h3 className="text-white" style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 700, marginBottom: 9 }}>{c.t}</h3>
                <p style={{ fontFamily: 'var(--sans)', fontSize: '0.92rem', lineHeight: 1.7, color: 'rgba(255,255,255,.5)' }}>{c.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── TESTIMONIALS ─────────────────────────────────────────────────────────────

function Testimonials({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const items = [
    { q: t('tst1_q'), a: t('tst1_a') },
    { q: t('tst2_q'), a: t('tst2_a') },
    { q: t('tst3_q'), a: t('tst3_a') },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ background: 'var(--bg2)', padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-14">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('tst_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('tst_h2')}</h2>
          <p className="sec-sub mt-3 mx-auto" style={{ maxWidth: 460 }}>{t('tst_sub')}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 20 }}>
          {items.map((it, i) => (
            <Reveal key={i} delay={i * 80}>
              <figure className="rounded-[13px] border h-full flex flex-col" dir={rtl ? 'rtl' : 'ltr'}
                style={{ background: 'rgba(5,5,6,.6)', borderColor: 'var(--border2)', padding: '30px 28px' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 40, lineHeight: 0.5, color: 'rgba(212,175,55,.5)' }}>&ldquo;</span>
                <blockquote className="flex-1 mt-3" style={{ fontFamily: 'var(--serif)', fontSize: '1.08rem', fontWeight: 600, lineHeight: 1.6, color: 'rgba(255,255,255,.85)' }}>
                  {it.q}
                </blockquote>
                <figcaption className="mt-5" style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gold)' }}>
                  {it.a}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
        <p className="text-center mt-6" style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.24)', letterSpacing: '.06em' }}>
          {t('tst_note')}
        </p>
      </div>
    </section>
  );
}

// ─── PRICING TEASER ───────────────────────────────────────────────────────────

function PricingTeaser({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const plans = [
    { n: t('pr_basic_n'), price: t('pr_basic_p'), unit: '', d: t('pr_basic_d'), href: '/sign-up', cta: t('pr_start'), gold: false, feat: false },
    { n: t('pr_pro_n'), price: '99', unit: t('pr_mo'), d: t('pr_pro_d'), href: '/checkout?plan=pro', cta: t('pr_join'), gold: true, feat: true },
    { n: t('pr_deluxe_n'), price: '199', unit: t('pr_mo'), d: t('pr_deluxe_d'), href: '/checkout?plan=deluxe', cta: t('pr_join'), gold: false, feat: false },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-14">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('pr_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('pr_h2')}</h2>
          <p className="sec-sub mt-3 mx-auto" style={{ maxWidth: 500 }}>{t('pr_sub')}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 items-stretch" style={{ gap: 20 }}>
          {plans.map((p, i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="relative rounded-[14px] border h-full flex flex-col card-lift" dir={rtl ? 'rtl' : 'ltr'}
                style={{
                  background: p.feat ? 'rgba(212,175,55,.05)' : 'rgba(13,13,15,.55)',
                  borderColor: p.feat ? 'rgba(212,175,55,.45)' : 'var(--border2)',
                  padding: '32px 28px',
                  boxShadow: p.feat ? '0 0 56px -14px rgba(212,175,55,.28)' : 'none',
                }}>
                {p.feat && (
                  <span className="absolute rounded-full px-3 py-1" style={{
                    top: -12, insetInlineStart: '50%', transform: 'translateX(-50%)',
                    fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
                    color: '#000', background: 'var(--gold)', boxShadow: '0 0 18px rgba(212,175,55,.5)', whiteSpace: 'nowrap',
                  }}>{t('pr_pop')}</span>
                )}
                <p dir="ltr" style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 800, color: p.feat ? 'var(--gold)' : '#fff' }}>{p.n}</p>
                <p className="mt-1" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.08em', color: 'rgba(255,255,255,.4)' }}>{p.d}</p>
                <div dir="ltr" className="flex items-baseline gap-2 mt-5 pb-6 mb-6 border-b" style={{ borderColor: 'var(--border2)' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 38, fontWeight: 800, lineHeight: 1, color: p.gold || p.price === t('pr_basic_p') ? (p.price === t('pr_basic_p') ? 'var(--bull-t)' : '#fff') : '#fff' }}>{p.price}</span>
                  {p.unit && <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.38)' }}>{p.unit}</span>}
                </div>
                <div className="flex-1" />
                <Link href={p.href} className={p.gold ? 'btn-gold' : 'btn-ghost'} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>{p.cta}</Link>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="flex justify-center mt-8">
          <Link href="/pricing" className="btn-ghost">{t('pr_all')}</Link>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function FAQItem({ q, a, rtl }: { q: string; a: string; rtl: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border2)', background: 'rgba(13,13,15,.4)' }}>
      <button className="w-full flex items-center justify-between gap-5 p-6" dir={rtl ? 'rtl' : 'ltr'} onClick={() => setOpen(o => !o)}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.35, textAlign: 'start' }}>{q}</span>
        <span style={{
          flexShrink: 0, width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'rgba(212,175,55,.15)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${open ? 'rgba(212,175,55,.3)' : 'rgba(255,255,255,.1)'}`,
          color: open ? 'var(--gold)' : 'rgba(255,255,255,.5)', fontSize: 16, fontWeight: 700, lineHeight: 1,
          transition: 'transform 220ms ease, background 220ms, border-color 220ms', transform: open ? 'rotate(45deg)' : 'none',
        }}>+</span>
      </button>
      {open && (
        <div className="px-6 pb-6 border-t" dir={rtl ? 'rtl' : 'ltr'} style={{ borderColor: 'var(--border2)' }}>
          <p style={{ fontFamily: 'var(--sans)', fontSize: 14, lineHeight: 1.85, color: 'rgba(255,255,255,.55)', paddingTop: 18 }}>{a}</p>
        </div>
      )}
    </div>
  );
}

function FAQ({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  const items = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3') },
    { q: t('faq_q4'), a: t('faq_a4') },
  ];
  return (
    <section className="border-t border-[var(--border)]" style={{ background: 'var(--bg2)', padding: '96px 0' }}>
      <div className="wrap">
        <Reveal className="text-center mb-12">
          <span className="kicker mb-4" style={{ display: 'inline-flex' }}>{t('faq_kicker')}</span>
          <h2 className="sec-title text-white mt-4">{t('faq_h2')}</h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="space-y-3 mx-auto" style={{ maxWidth: 780 }}>
            {items.map((it, i) => <FAQItem key={i} q={it.q} a={it.a} rtl={rtl} />)}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── FINAL CTA ────────────────────────────────────────────────────────────────

function FinalCta({ t, rtl }: { t: (k: K) => string; rtl: boolean }) {
  return (
    <section className="border-t border-[var(--border)] relative overflow-hidden text-center" style={{ padding: '104px 0' }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(circle at 50% 45%, rgba(212,175,55,.11), transparent 62%)' }} />
      <div className="wrap">
        <Reveal>
          <h2 dir={rtl ? 'rtl' : 'ltr'} className="text-white mx-auto"
            style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.4rem,5vw,4rem)', fontWeight: 800, lineHeight: 1.1, maxWidth: '16ch' }}
            dangerouslySetInnerHTML={{ __html: t('cta_h2') }} />
          <p dir={rtl ? 'rtl' : 'ltr'} className="mt-6 mx-auto"
            style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', lineHeight: 1.75, color: 'rgba(255,255,255,.52)', maxWidth: 560 }}>
            {t('cta_body')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link href="/sign-up" className="btn-lg-gold">{t('cta_main')}</Link>
            <Link href="/pricing" className="btn-lg-ghost">{t('cta_ghost')}</Link>
          </div>
          <p className="mt-8" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.28)', letterSpacing: '.08em' }}>{t('cta_lock')}</p>
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
  const tl = (b: BiStr): string => b[lang];

  return (
    <>
      <Hero          t={t} tl={tl} rtl={rtl} />
      <Problem       t={t} rtl={rtl} />
      <Ecosystem     t={t} rtl={rtl} />
      <Intelligence  t={t} rtl={rtl} />
      <Journey       t={t} rtl={rtl} />
      <Features      t={t} rtl={rtl} />
      <Testimonials  t={t} rtl={rtl} />
      <PricingTeaser t={t} rtl={rtl} />
      <FAQ           t={t} rtl={rtl} />
      <FinalCta      t={t} rtl={rtl} />
    </>
  );
}
