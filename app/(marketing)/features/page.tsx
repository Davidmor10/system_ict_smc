'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMarketingLang } from '../components/LangProvider';

// ─── I18N ─────────────────────────────────────────────────────────────────────

const I18N = {
  // ───────────────────────────────────────────────────────────────────────────
  // Every claim on this page describes something the product actually does
  // today. The four rows used to describe a market-reading "fractal engine"
  // that produced a scored daily bias, a live session axis with a countdown,
  // and a risk lock that stopped you trading. None of those exist:
  //
  //   · the bias is a direction the TRADER declares on the trade itself, and
  //     all the system does is record whether the trade agreed with it;
  //   · sessions are windows the journal stamps a trade with, plus the
  //     "active now" indicator and Israel clock on the dashboard;
  //   · rules are MEASURED, not enforced — the system reports how often you
  //     kept them and what it cost when you did not. It never blocks a trade.
  //
  // The landing page and /performance already tell the true story. This page
  // was the last one still telling the old one.
  // ───────────────────────────────────────────────────────────────────────────

  // HERO
  badge:    { he: 'כל הכלים',   en: 'Every Tool' },
  h1_html:  {
    he: 'ארבעה כלים.<br>מערכת <span style="color:var(--gold)">אחת שלמה.</span>',
    en: 'Four tools.<br><span style="color:var(--gold)">One complete system.</span>',
  },
  hero_sub: {
    he: 'Onyx הוא לא אינדיקטור ולא שירות איתותים — הוא יומן שמנתח אותך. אתה מתעד את העסקה בשתי דקות, המערכת חותמת עליה את הסשן, השעה והכיוון שהגדרת, ובסוף מראה לך במספרים שלך מה עובד ומה עולה לך כסף.',
    en: 'Onyx is not an indicator and not a signal service — it is a journal that analyses you. You log the trade in two minutes, the system stamps it with the session, the time and the direction you declared, and then shows you, in your own numbers, what works and what costs you money.',
  },

  // ROW 1 — the journal
  r1_tag:  { he: 'תיעוד',  en: 'Logging' },
  r1_h3:   { he: 'יומן שזוכר מה שאתה שוכח', en: 'A Journal That Remembers What You Forget' },
  r1_lead: {
    he: 'כל עסקה נכנסת בשתי דקות: כיוון, סטאפ, כניסה ויציאה, מצב רגשי ותגיות אישור. המערכת חותמת עליה לבד את הסשן ואת השעה, מחשבת R מול הסטופ ההתחלתי — ומסמנת אם העסקה הלכה עם הכיוון שהגדרת לאותו יום או נגדו.',
    en: 'Every trade takes two minutes: direction, setup, entry and exit, emotional state and confirmation tags. The system stamps the session and the time itself, computes R against the initial stop — and marks whether the trade went with the direction you declared for that day or against it.',
  },
  r1_b1: { he: 'חיתום אוטומטי: סשן, שעה, R מול הסטופ',    en: 'Auto-stamped: session, time, R against the stop' },
  r1_b2: { he: 'הכיוון שהגדרת — מול מה שבאמת עשית',        en: 'The direction you declared — against what you did' },
  r1_b3: { he: 'מצב רגשי ותגיות אישור בכל עסקה',            en: 'Emotional state and confirmation tags on every trade' },

  p1_bias:  { he: 'הכיוון שהגדרת להיום', en: 'The Direction You Declared' },
  p1_val:   { he: 'עולה',                en: 'BULLISH' },
  p1_conf:  { he: '3 מיושרות · 1 נגד',   en: '3 aligned · 1 counter' },
  p1_tl: { he: 'רגש',    en: 'State' },   p1_tv: { he: 'רגוע',     en: 'Calm' },
  p1_cl: { he: 'אישור',  en: 'Confirm' }, p1_cv: { he: 'IFVG 2M',  en: 'IFVG 2M' },
  p1_sl: { he: 'סטאפ',   en: 'Setup' },   p1_sv: { he: 'המשכיות',  en: 'Continuation' },
  p1_el: { he: 'סשן',    en: 'Session' }, p1_ev: { he: 'NY AM',    en: 'NY AM' },

  // ROW 2 — the daily dashboard
  r2_tag:  { he: 'יום העבודה', en: 'The Working Day' },
  r2_h3:   { he: 'הדשבורד של הבוקר', en: 'The Morning Dashboard' },
  r2_lead: {
    he: 'התובנה של היום בכניסה, הסשן שפעיל עכשיו לפי שעון ישראל, לוח חודשי עם התוצאה של כל יום, ודוחות המאקרו של השבוע. הלוח מסודר לפי מה שנוח לך — הווידג׳טים זזים.',
    en: 'Today\u2019s insight when you walk in, the session that is active right now on Israel time, a monthly board with each day\u2019s result, and the week\u2019s macro releases. The board is arranged the way you want it — the widgets move.',
  },
  r2_b1: { he: 'התובנה של היום, עם המדגם שמאחוריה',  en: 'Today\u2019s insight, with the sample behind it' },
  r2_b2: { he: 'הסשן הפעיל עכשיו ושעון ישראל',       en: 'The session active now, on Israel time' },
  r2_b3: { he: 'לוח חודשי ודוחות מאקרו של USD',       en: 'Monthly board and high-impact USD releases' },

  p2_title:     { he: 'סשנים · שעון ישראל', en: 'Sessions · Israel Time' },
  p2_now_l:     { he: 'פעיל כעת',           en: 'Active Now' },
  p2_now_v:     { he: 'NY AM',              en: 'NY AM' },
  p2_close_l:   { he: 'שעון ישראל',         en: 'Israel Time' },
  p2_close_v:   { he: '17:42',              en: '17:42' },

  // ROW 3 — setups and rules
  r3_tag:  { he: 'משמעת',   en: 'Discipline' },
  r3_h3:   { he: 'ספר הסטאפים והחוקים שלך', en: 'Your Playbook and Your Rules' },
  r3_lead: {
    he: 'כל סטאפ שאתה סוחר יושב במקום אחד, ומתחתיו הביצועים האמיתיים שלו: כמה עסקאות, איזה אחוז הצלחה, כמה R. החוקים שקבעת לעצמך נמדדים מול היומן — כמה פעמים עמדת בהם, ומה זה עשה לתוצאה.',
    en: 'Every setup you trade lives in one place, with its real performance underneath: how many trades, what win rate, how much R. The rules you set for yourself are measured against the journal — how often you kept them, and what it did to the result.',
  },
  r3_b1: { he: 'כל סטאפ מחובר לביצועים האמיתיים שלו', en: 'Every setup tied to its own real numbers' },
  r3_b2: { he: 'חוקים אישיים עם מעקב עמידה',           en: 'Personal rules with compliance tracking' },
  r3_b3: { he: 'מגבלות שאתה קובע: עסקאות, סיכון, הפסד יומי', en: 'Limits you set: trades, risk, daily loss' },

  p3_title:   { he: 'סטאפים · 30 יום',  en: 'Setups · 30 Days' },
  p3_limit:   { he: 'עמידה 82%',        en: '82% compliance' },
  p3_wr_l:    { he: 'ווין רייט',        en: 'Win Rate' },
  p3_pnl_l:   { he: 'R מצטבר',          en: 'Cumulative R' },
  p3_t1_sym:  { he: 'SWEEP + FVG · 42', en: 'SWEEP + FVG · 42' },
  p3_t1_r:    { he: '+12.4R',           en: '+12.4R' },
  p3_t2_sym:  { he: 'ORDER BLOCK · 18', en: 'ORDER BLOCK · 18' },
  p3_t2_r:    { he: '\u22123.1R',           en: '\u22123.1R' },

  // ROW 4 — the AI
  r4_tag:  { he: 'AI · PRO ומעלה',  en: 'AI · PRO and up' },
  r4_h3:   { he: 'ה-AI שקרא את היומן שלך', en: 'The AI That Read Your Journal' },
  r4_lead: {
    he: 'האנליטיקס חותך את העסקאות לפי סשן, סטאפ, כיוון, שעה ויום ומראה מה עובד ומה שורף. המאמן האישי הוא צ׳אט שקרא את היומן שלך ועונה מהמספרים שלך. וכלל אחד עומד מעל הכל: המערכת לא אומרת דבר שהיא לא יכולה להוכיח.',
    en: 'Analytics cuts your trades by session, setup, direction, hour and day, and shows what works and what burns. The personal coach is a chat that has read your journal and answers from your own numbers. And one rule stands above all: the system does not say anything it cannot prove.',
  },
  r4_b1: { he: 'חיתוך לפי סשן · סטאפ · כיוון · יום', en: 'Broken down by session · setup · direction · day' },
  r4_b2: { he: 'צ׳אט שיודע את היומן שלך (DELUXE)',   en: 'A chat that knows your journal (DELUXE)' },
  r4_b3: { he: 'כל טענה מגיעה עם המדגם שמאחוריה',    en: 'Every claim arrives with the sample behind it' },

  p4_title:  { he: 'אנליטיקס · 30 יום', en: 'Analytics · 30 Days' },
  p4_sess_l: { he: 'הסשן הכי רווחי',    en: 'Top Session' },
  p4_sess_v: { he: 'NY AM · 74%',        en: 'NY AM · 74%' },
  p4_mod_l:  { he: 'הסטאפ המוביל',      en: 'Top Setup' },
  p4_mod_v:  { he: 'SWEEP + FVG',        en: 'SWEEP + FVG' },
  p4_pf_l:   { he: 'פרופיט פקטור',      en: 'Profit Factor' },
  p4_net_l:  { he: 'נטו 30 יום',        en: 'Net 30 Days' },

  // FINAL CTA
  cta_kicker:  { he: 'הכל במקום אחד',   en: 'Everything in One Place' },
  cta_h2_html: {
    he: 'ארבעה כלים שעובדים<br>כמו <span style="color:var(--gold)">מערכת אחת.</span>',
    en: 'Four tools that work<br>like <span style="color:var(--gold)">one system.</span>',
  },
  cta_body:    {
    he: 'תיעוד, יום עבודה, סטאפים וחוקים, ו-AI שקורא את כולם. פתח גישה מיום ראשון.',
    en: 'Logging, the working day, setups and rules, and an AI that reads all of them. Get access from day one.',
  },
  cta_gold:    { he: 'לרכישת מנוי ←',          en: 'Subscribe →' },
  cta_ghost:   { he: 'לראות את המספרים',        en: 'See the Numbers' },
  cta_lock:    { he: 'AI Analytics נפתח ב-PRO · המאמן האישי והסטטיסטיקה ב-DELUXE · ביטול בכל עת', en: 'AI Analytics unlocks on PRO · Personal Coach and Statistics on DELUXE · Cancel anytime' },
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
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.08 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}>
      {children}
    </div>
  );
}

function FeatureTag({ label, rtl }: { label: string; rtl: boolean }) {
  return (
    <div className="flex items-center gap-4 mb-6" dir={rtl ? 'rtl' : 'ltr'}>
      <span className="shrink-0 rounded px-2.5 py-1" style={{
        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.2em',
        color: 'var(--gold)', background: 'rgba(212,175,55,.1)',
        border: '1px solid rgba(212,175,55,.22)',
        whiteSpace: 'nowrap',
      }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'rgba(212,175,55,.22)' }} />
    </div>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 mt-0.5" style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>✦</span>
      <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.65, color: 'rgba(255,255,255,.7)' }}>{text}</span>
    </li>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-[13px] border overflow-hidden" style={{
      background: 'rgba(13,13,15,.6)',
      borderColor: 'var(--border2)',
      boxShadow: '0 0 50px -10px rgba(212,175,55,.1), inset 0 0 0 1px rgba(255,255,255,.03)',
    }}>
      <div aria-hidden className="absolute top-0 end-0 w-44 h-44 pointer-events-none"
        style={{ background: 'radial-gradient(circle at top right, rgba(212,175,55,.07), transparent 70%)' }} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function PanelHeader({ title, badge, badgeRed }: { title: string; badge?: string; badgeRed?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border2)', background: 'rgba(0,0,0,.35)' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '.18em' }}>
        {title}
      </span>
      {badge && (
        <span className="rounded px-2 py-0.5" style={{
          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '.14em',
          color: badgeRed ? 'var(--bear-t)' : 'var(--gold)',
          background: badgeRed ? 'rgba(139,58,58,.18)' : 'rgba(212,175,55,.1)',
          border: `1px solid ${badgeRed ? 'rgba(139,58,58,.35)' : 'rgba(212,175,55,.22)'}`,
        }}>{badge}</span>
      )}
    </div>
  );
}

// ─── Feature Row layout ───────────────────────────────────────────────────────

function FeatureRow({ flip, text, panel }: {
  flip?: boolean;
  text: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)]">
      <div className="wrap grid grid-cols-1 lg:grid-cols-2 items-center" style={{ gap: 60, padding: '88px 0' }}>
        <Reveal className={flip ? 'lg:order-2' : undefined}>{text}</Reveal>
        <Reveal delay={130} className={flip ? 'lg:order-1' : undefined}>{panel}</Reveal>
      </div>
    </section>
  );
}

// ─── PANEL 1 — Bias ───────────────────────────────────────────────────────────

function BiasPanel({ t }: { t: (k: K) => string }) {
  const cells = [
    { l: t('p1_tl'), v: t('p1_tv'), gold: true  },
    { l: t('p1_cl'), v: t('p1_cv'), gold: true  },
    { l: t('p1_sl'), v: t('p1_sv'), gold: false },
    { l: t('p1_el'), v: t('p1_ev'), gold: false },
  ];
  return (
    <Panel>
      <div className="p-5">
        {/* Bias box */}
        <div className="rounded-lg border p-5 mb-3" style={{ background: '#000', borderColor: 'var(--border2)' }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.22em', color: 'rgba(255,255,255,.36)' }}>
            {t('p1_bias')}
          </p>
          <p className="mt-2" style={{ fontFamily: 'var(--serif)', fontSize: 52, fontWeight: 800, lineHeight: 1, color: 'var(--bull-t)' }}>
            {t('p1_val')}
          </p>
          <p className="mt-1.5" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.36)', letterSpacing: '.08em' }}>
            {t('p1_conf')}
          </p>
          {/* bars 3/4 */}
          <div className="flex gap-1.5 mt-4" dir="ltr">
            {/* three aligned, one counter — the same four trades as the caption */}
            {[true, true, true, false].map((on, i) => (
              <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: on ? 'var(--gold)' : 'rgba(255,255,255,.12)' }} />
            ))}
          </div>
        </div>
        {/* 2×2 cells */}
        <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--border2)' }}>
          {cells.map((c, i) => (
            <div key={i} className="p-3.5" style={{ background: '#000' }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{c.l}</p>
              <p className="mt-1" style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: c.gold ? 'var(--gold)' : 'rgba(255,255,255,.8)' }}>{c.v}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ─── PANEL 2 — Sessions ───────────────────────────────────────────────────────

const SESSIONS = [
  { key: 'ASIA',  times: '02:00–07:00', parts: 5, active: false },
  { key: 'LDN',   times: '09:00–12:00', parts: 3, active: false },
  { key: 'NY AM', times: '16:00–18:00', parts: 2, active: true  },
  { key: 'NY PM', times: '20:00–22:00', parts: 2, active: false },
];

function SessionPanel({ t }: { t: (k: K) => string }) {
  return (
    <Panel>
      <PanelHeader title={t('p2_title')} />
      <div className="p-5">
        {/* Session bar */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border2)', height: 48 }}>
          {SESSIONS.map((s, i) => (
            <div key={s.key} className="relative flex flex-col items-center justify-center"
              style={{
                flex: s.parts,
                background: s.active ? 'rgba(212,175,55,.12)' : 'rgba(0,0,0,.6)',
                borderRight: i < SESSIONS.length - 1 ? '1px solid var(--border2)' : undefined,
              }}>
              {s.active && (
                <>
                  {/* "now" line */}
                  <div className="absolute inset-y-0 w-px" style={{ left: '50%', background: 'var(--gold)', boxShadow: '0 0 6px rgba(212,175,55,.6)' }} />
                  {/* glow overlay */}
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg,transparent,rgba(212,175,55,.06),transparent)' }} aria-hidden />
                </>
              )}
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '.1em',
                color: s.active ? 'var(--gold)' : 'rgba(255,255,255,.3)',
                position: 'relative', zIndex: 1,
              }}>{s.key}</span>
            </div>
          ))}
        </div>

        {/* Time labels */}
        <div className="flex mt-1.5">
          {SESSIONS.map(s => (
            <div key={s.key} className="text-center" style={{ flex: s.parts }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: s.active ? 'rgba(212,175,55,.5)' : 'rgba(255,255,255,.18)', letterSpacing: '.04em' }}>
                {s.times}
              </span>
            </div>
          ))}
        </div>

        {/* Info cells */}
        <div className="grid grid-cols-2 gap-px mt-4" style={{ background: 'var(--border2)' }}>
          {[
            { l: t('p2_now_l'),   v: t('p2_now_v'),   gold: true  },
            { l: t('p2_close_l'), v: t('p2_close_v'), gold: false },
          ].map((c, i) => (
            <div key={i} className="p-4" style={{ background: '#000' }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{c.l}</p>
              <p dir="ltr" className="mt-1" style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: c.gold ? 'var(--gold)' : 'rgba(255,255,255,.8)' }}>{c.v}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ─── PANEL 3 — Journal ────────────────────────────────────────────────────────

function JournalPanel({ t }: { t: (k: K) => string }) {
  const setups = [
    { sym: t('p3_t1_sym'), r: t('p3_t1_r'), win: true },
    { sym: t('p3_t2_sym'), r: t('p3_t2_r'), win: false },
  ];
  return (
    <Panel>
      <PanelHeader title={t('p3_title')} badge={t('p3_limit')} />
      <div className="p-5">
        {/* Stats row */}
        <div className="grid grid-cols-2 gap-px mb-3" style={{ background: 'var(--border2)' }}>
          <div className="p-4" style={{ background: '#000' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{t('p3_wr_l')}</p>
            <p dir="ltr" className="mt-1" style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--gold)' }}>68%</p>
          </div>
          <div className="p-4" style={{ background: '#000' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{t('p3_pnl_l')}</p>
            <p dir="ltr" className="mt-1" style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--bull-t)' }}>+9.3R</p>
          </div>
        </div>

        {/* Trade rows */}
        <div className="space-y-1.5">
          {setups.map((tr, i) => (
            <div key={i} className="flex items-center justify-between rounded-md px-4 py-3"
              style={{ background: '#000', border: `1px solid ${tr.win ? 'rgba(74,124,89,.25)' : 'rgba(139,58,58,.25)'}` }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', letterSpacing: '.04em' }}
                dir="ltr">{tr.sym}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: tr.win ? 'var(--bull-t)' : 'var(--bear-t)' }}
                dir="ltr">{tr.r}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ─── PANEL 4 — Analytics ──────────────────────────────────────────────────────

function AnalyticsPanel({ t }: { t: (k: K) => string }) {
  return (
    <Panel>
      <PanelHeader title={t('p4_title')} badge="PRO" />
      <div className="p-5 space-y-3">
        {/* Top metrics */}
        <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--border2)' }}>
          {[
            { l: t('p4_sess_l'), v: t('p4_sess_v') },
            { l: t('p4_mod_l'),  v: t('p4_mod_v')  },
          ].map((c, i) => (
            <div key={i} className="p-4" style={{ background: '#000' }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{c.l}</p>
              <p dir="ltr" className="mt-1" style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.82)' }}>{c.v}</p>
            </div>
          ))}
        </div>

        {/* Performance stats */}
        <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--border2)' }}>
          <div className="p-4" style={{ background: '#000' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{t('p4_pf_l')}</p>
            <p dir="ltr" className="mt-1" style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--gold)' }}>2.31</p>
          </div>
          <div className="p-4" style={{ background: '#000' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>{t('p4_net_l')}</p>
            <p dir="ltr" className="mt-1" style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--bull-t)' }}>+18.6R</p>
          </div>
        </div>
      </div>
    </Panel>
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
          style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(1rem,1.8vw,1.15rem)', lineHeight: 1.75, color: 'rgba(255,255,255,.55)', maxWidth: 680 }}>
          {t('hero_sub')}
        </p>
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
            <Link href="/pricing"        className="btn-lg-gold">{t('cta_gold')}</Link>
            <Link href="/performance" className="btn-lg-ghost">{t('cta_ghost')}</Link>
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

export default function FeaturesPage() {
  const { lang } = useMarketingLang();
  const rtl = lang === 'he';
  const t = (key: K): string => (I18N[key] as Record<Lang, string>)[lang];

  const textSide = (tag: string, h3: string, lead: string, bullets: [string, string, string]) => (
    <div dir={rtl ? 'rtl' : 'ltr'}>
      <FeatureTag label={tag} rtl={rtl} />
      <h3 className="text-white mb-5"
        style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.6rem,2.6vw,2.2rem)', fontWeight: 800, lineHeight: 1.2 }}>
        {h3}
      </h3>
      <p className="mb-7"
        style={{ fontFamily: 'var(--sans)', fontSize: '1.025rem', lineHeight: 1.75, color: 'rgba(255,255,255,.52)' }}>
        {lead}
      </p>
      <ul className="space-y-3">
        {bullets.map((b, i) => <Bullet key={i} text={b} />)}
      </ul>
    </div>
  );

  return (
    <>
      <Hero t={t} rtl={rtl} />

      {/* Row 1 — Bias Analysis */}
      <FeatureRow
        text={textSide(t('r1_tag'), t('r1_h3'), t('r1_lead'), [t('r1_b1'), t('r1_b2'), t('r1_b3')])}
        panel={<BiasPanel t={t} />}
      />

      {/* Row 2 — Session Axis (flip) */}
      <FeatureRow flip
        text={textSide(t('r2_tag'), t('r2_h3'), t('r2_lead'), [t('r2_b1'), t('r2_b2'), t('r2_b3')])}
        panel={<SessionPanel t={t} />}
      />

      {/* Row 3 — Journal */}
      <FeatureRow
        text={textSide(t('r3_tag'), t('r3_h3'), t('r3_lead'), [t('r3_b1'), t('r3_b2'), t('r3_b3')])}
        panel={<JournalPanel t={t} />}
      />

      {/* Row 4 — Analytics (flip) */}
      <FeatureRow flip
        text={textSide(t('r4_tag'), t('r4_h3'), t('r4_lead'), [t('r4_b1'), t('r4_b2'), t('r4_b3')])}
        panel={<AnalyticsPanel t={t} />}
      />

      <FinalCta t={t} rtl={rtl} />
    </>
  );
}
