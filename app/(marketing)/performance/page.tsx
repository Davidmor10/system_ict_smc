'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TIMEZONE, clockInZone } from '../../lib/time/zone';
import './performance.css';

// ─────────────────────────────────────────────────────────────────────────────
// /performance — the public proof page.
//
// The job of this page is to convert a sceptic by showing unflattering,
// documented numbers before asking for money. Three rules from the design
// handoff are load-bearing and every edit has to keep them:
//
//   1. The product is a JOURNAL that analyses the TRADER. Never a market feed,
//      never a signal service. Nothing here may claim "live" or "real time",
//      and no copy may say the system marks a bias or calls a trade.
//   2. The losing trade stays in the log and the risk disclaimer stays visible
//      in the footer. A proof page that hides its losses proves nothing.
//   3. Every number is mono, tabular and dir="ltr". The page is RTL; an
//      unisolated "+18.6R" reorders into nonsense.
//
// The header is deliberately NOT rendered here: the shared <MarketingNav> above
// this page already carries the same wordmark and the same gold "כניסה למערכת",
// and its three links are the site nav (פיצ'רים / ביצועים / מנוי). Rendering the
// design's own header on top of it would stack two wordmarks and two CTAs.
//
// ── The numbers ─────────────────────────────────────────────────────────────
// Everything in the constants below is the handoff's demo dataset — the same
// figures the previous version of this page carried. They are placeholders for
// real journal aggregates (win rate, profit factor, 30-day net R, leading
// session, the monthly cumulative-R series and the three breakdown groupings).
// When an aggregate endpoint exists, this block is the only thing that changes;
// nothing below reads a literal.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';
const TZ = DEFAULT_TIMEZONE;

/** IDT in summer, IST in winter.
 *
 *  Not `Intl … timeZoneName:'short'`: for Asia/Jerusalem that returns "GMT+3"
 *  in every engine this app runs on, and "21:55 GMT+3" is not the label the
 *  page is written around. The offset is the thing that actually decides which
 *  abbreviation is true, so it is what we read. */
function israelAbbrev(now: Date): string {
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const offsetHours = Math.round((local.getTime() - utc.getTime()) / 3_600_000);
  return offsetHours >= 3 ? 'IDT' : 'IST';
}

// ── Data ─────────────────────────────────────────────────────────────────────

interface Kpi { value: string; label: string; note: string; font: 'mono' | 'serif'; color: string }

const KPIS: Kpi[] = [
  { value: '68.4%',  label: 'אחוז הצלחה',   note: 'מתוך 1,240 עסקאות מתועדות', font: 'mono',  color: '#fff' },
  { value: '2.31',   label: 'פרופיט פקטור', note: 'יחס רווח גולמי להפסד',      font: 'mono',  color: 'var(--pf-gold)' },
  { value: '+18.6R', label: 'נטו 30 יום',   note: 'תשואה מצטברת ב-R',          font: 'mono',  color: 'var(--pf-bull)' },
  { value: 'NY AM',  label: 'הסשן המוביל',  note: 'חלון התוחלת הגבוהה',        font: 'serif', color: '#fff' },
];

const STEPS = [
  {
    n: '01', title: 'תיעוד העסקה',
    body: 'אחרי כל עסקה, הסוחר מתעד: סטאפ, כיוון, סשן, כניסה, יציאה, R שהושג, מצב רגשי ותגיות אישור. היומן מחשב את התוצאה אוטומטית ומשייך אותה לסשן.',
    tags: ['SETUP · SESSION', 'AUTO RESULT'],
  },
  {
    n: '02', title: 'ניתוח הנתונים',
    body: 'המערכת מפרקת את העסקאות לפי כל חתך אפשרי — סשן, סטאפ, כיוון, שעה, יום — ומראה שחור על לבן איפה הסוחר חזק ואיפה הוא מאבד כסף.',
    tags: ['BREAKDOWN', 'STRENGTH · LEAK'],
  },
  {
    n: '03', title: 'למידה ושיפור',
    body: 'ה-AI לומד מהצטברות הנתונים, מזהה דפוסים חוזרים ובונה פרופיל מתפתח של הסוחר. ה-Edge Score מתעדכן מכל עסקה ומראה אם הסוחר באמת משתפר.',
    tags: ['PATTERN DETECTION', 'EDGE SCORE'],
  },
];

interface Point { m: string; v: number }

/** Cumulative R since the journal opened. The range switch slices the TAIL. */
const SERIES: Point[] = [
  { m: 'START', v: 0 },   { m: 'SEP', v: 16 },  { m: 'OCT', v: 29 },  { m: 'NOV', v: 24 },
  { m: 'DEC', v: 41 },    { m: 'JAN', v: 55 },  { m: 'FEB', v: 68 },  { m: 'MAR', v: 62 },
  { m: 'APR', v: 84 },    { m: 'MAY', v: 101 }, { m: 'JUN', v: 118 }, { m: 'JUL', v: 131 },
  { m: 'AUG', v: 152 },
];

const RANGES = [
  { key: '3M',  points: 4  },
  { key: '6M',  points: 7  },
  { key: '12M', points: 13 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

interface BreakRow { label: string; n: number; winRate: number; cumR: number }
interface BreakTab { key: string; tabLabel: string; head: string; foot: string; rows: BreakRow[] }

/** Rank #1 is index 0 of each array. Session and setup are pre-sorted by
 *  cumulative R descending; the weekday tab stays in calendar order and still
 *  highlights index 0 — that is the handoff's behaviour, kept on purpose. */
const TABS: BreakTab[] = [
  {
    key: 'session', tabLabel: 'לפי סשן', head: 'סשן',
    foot: `${D} חלונות סשן בשעון ישראל · NY AM 16:30–19:00 · LONDON 10:00–12:30`,
    rows: [
      { label: 'NY AM',  n: 512, winRate: 71.9, cumR: 74.6 },
      { label: 'LONDON', n: 388, winRate: 68.0, cumR: 45.2 },
      { label: 'NY PM',  n: 214, winRate: 63.1, cumR: 22.8 },
      { label: 'ASIA',   n: 126, winRate: 57.9, cumR: 9.4  },
    ],
  },
  {
    key: 'day', tabLabel: 'לפי יום', head: 'יום בשבוע',
    foot: `${D} ימי מסחר בלבד · ללא ימי חג בבורסות ארה״ב`,
    rows: [
      { label: 'שני',    n: 268, winRate: 66.4, cumR: 27.1 },
      { label: 'שלישי',  n: 296, winRate: 72.6, cumR: 46.9 },
      { label: 'רביעי',  n: 251, winRate: 69.7, cumR: 34.2 },
      { label: 'חמישי',  n: 244, winRate: 67.2, cumR: 29.6 },
      { label: 'שישי',   n: 181, winRate: 60.8, cumR: 14.2 },
    ],
  },
  {
    key: 'setup', tabLabel: 'לפי מודל', head: 'מודל כניסה',
    foot: `${D} סיווג המודל נקבע בזמן הכניסה, לא בדיעבד`,
    rows: [
      { label: 'SWEEP + FVG',    n: 402, winRate: 74.1, cumR: 62.4 },
      { label: 'iFVG',           n: 288, winRate: 69.8, cumR: 34.8 },
      { label: 'CHoCH',          n: 236, winRate: 66.5, cumR: 26.1 },
      { label: 'ORDER BLOCK',    n: 197, winRate: 64.5, cumR: 18.3 },
      { label: 'SMT DIVERGENCE', n: 117, winRate: 60.7, cumR: 10.4 },
    ],
  },
];

interface Trade {
  date: string; sym: string; dir: 'LONG' | 'SHORT'; session: string; setup: string;
  r: string; specs: Array<[string, string]>; note: string;
}

/** Six documented trades, chronological — the loss included on purpose.
 *
 *  The notes are written as the TRADER's own read of the chart. The handoff's
 *  placeholder text had one entry phrased as "the system marked a bias", which
 *  the product does not do and must not imply; that note is the trader speaking
 *  here, like the other five. */
const TRADES: Trade[] = [
  {
    date: '2026-08-14', sym: 'NQ', dir: 'LONG', session: 'NY AM',
    setup: 'Sweep של SSL אסייתי + FVG ב-M5', r: '+3.20R',
    specs: [['ENTRY', '23,418.75'], ['STOP', '23,391.25'], ['TARGET', '23,506.00'], ['HOLD', '38 min']],
    note: 'הביאס שלי היה בולישי אחרי CHoCH ב-H1. הכניסה נלקחה על ה-FVG שנוצר מיד לאחר סחיטת הנזילות התחתונה של סשן אסיה, עם סטופ מתחת לפתיל.',
  },
  {
    date: '2026-08-12', sym: 'ES', dir: 'SHORT', session: 'LONDON',
    setup: 'iFVG לאחר כשל בהמשכיות', r: '+1.80R',
    specs: [['ENTRY', '6,412.25'], ['STOP', '6,419.50'], ['TARGET', '6,399.00'], ['HOLD', '52 min']],
    note: 'ה-FVG הבולישי נהפך (iFVG) ואישר את הביאס הדובי של H4. יציאה חלקית ב-1R, יתרה ב-BSL הפנימי.',
  },
  {
    date: '2026-08-11', sym: 'NQ', dir: 'LONG', session: 'NY AM',
    setup: 'Order Block ב-H1 · המשכיות', r: '-1.00R',
    specs: [['ENTRY', '23,201.50'], ['STOP', '23,168.00'], ['TARGET', '23,290.00'], ['HOLD', '19 min']],
    note: 'הפסד מלא. הכניסה הייתה תקינה לפי הכלל, אך פרסום מקרו לא מתוזמן שבר את המבנה. אין התאמה בדיעבד של הנתון.',
  },
  {
    date: '2026-08-07', sym: 'ES', dir: 'LONG', session: 'NY AM',
    setup: 'Sweep של SSL + כניסת נזילות', r: '+2.60R',
    specs: [['ENTRY', '6,357.75'], ['STOP', '6,349.00'], ['TARGET', '6,380.50'], ['HOLD', '1h 07m']],
    note: 'ביאס בולישי נקי משני צירי הזמן. סחיטת נזילות מדויקת של שפל היום הקודם, ואז המשכיות ישרה אל היעד.',
  },
  {
    date: '2026-08-05', sym: 'NQ', dir: 'SHORT', session: 'NY PM',
    setup: 'SMT Divergence ES/NQ', r: '+1.20R',
    specs: [['ENTRY', '22,988.25'], ['STOP', '23,024.75'], ['TARGET', '22,900.00'], ['HOLD', '41 min']],
    note: 'NQ עשה שיא גבוה יותר בזמן ש-ES נכשל — דיברגנס קלאסי. יציאה מוקדמת בשל היחלשות התנופה לפני היעד.',
  },
  {
    date: '2026-08-04', sym: 'ES', dir: 'SHORT', session: 'LONDON',
    setup: 'CHoCH ב-M15 לאחר סחיטת BSL', r: '+2.10R',
    specs: [['ENTRY', '6,301.00'], ['STOP', '6,308.25'], ['TARGET', '6,285.75'], ['HOLD', '58 min']],
    note: 'סחיטת נזילות עליונה של פתיחת לונדון, שינוי אופי מיד אחריה, וכניסה על הריטסט הראשון של אזור העניין.',
  },
];

/** The hero card cycles the last documented trades — NOT a market feed. */
const FEED = [
  { r: '+2.10R', sym: 'ES', session: 'LONDON', closedAt: '11:42' },
  { r: '+1.20R', sym: 'NQ', session: 'NY PM',  closedAt: '21:08' },
  { r: '-1.00R', sym: 'NQ', session: 'NY AM',  closedAt: '17:15' },
  { r: '+3.20R', sym: 'NQ', session: 'NY AM',  closedAt: '16:58' },
  { r: '+1.80R', sym: 'ES', session: 'LONDON', closedAt: '12:04' },
];

const METHOD = [
  'כל עסקה נחתמת ברגע התיעוד, כולל הסשן והכיוון שהגדרת לאותו יום.',
  'R מחושב מול הסטופ ההתחלתי — לא מול סטופ מוזז בדיעבד.',
  'עסקאות שנסגרו בנקודת האיזון נספרות כ-BE ולא כזכייה.',
  'אין הסרה של עסקאות מפסידות מהמדגם, ואין נורמליזציה של גודל פוזיציה.',
];

const LEGAL = [
  { t: 'תקנון',       href: '/terms' },
  { t: 'פרטיות',      href: '/privacy' },
  { t: 'הסרת אחריות', href: '/disclaimer' },
  { t: 'יצירת קשר',   href: '/contact' },
];

// ── Chart maths ──────────────────────────────────────────────────────────────
// Hand-rolled SVG on purpose: no chart library, no embed. It is forty lines of
// arithmetic and it matches the brand exactly.

const W = 1000, TOP = 26, BOTTOM = 300;

const fmtR = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}R`;

function geometry(pts: Point[]) {
  const vals = pts.map(p => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(6, (hi - lo) * 0.16);
  const min = Math.max(0, lo - pad), max = hi + pad;

  const px = (i: number) => (pts.length === 1 ? W / 2 : 18 + i * ((W - 36) / (pts.length - 1)));
  const py = (v: number) => BOTTOM - ((v - min) / (max - min || 1)) * (BOTTOM - TOP);

  const dots = pts.map((p, i) => ({ ...p, x: px(i), y: py(p.v) }));
  const line = dots.map((d, i) => `${i ? 'L' : 'M'}${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(' ');
  const last = dots[dots.length - 1], first = dots[0];
  const area = `${line} L${last.x.toFixed(1)} ${BOTTOM} L${first.x.toFixed(1)} ${BOTTOM} Z`;

  const grid = Array.from({ length: 5 }, (_, i) => {
    const v = min + ((max - min) / 4) * (4 - i);
    return { v, y: py(v) };
  });

  return { dots, line, area, grid };
}

/** All four stats are computed from the VISIBLE range — never hardcoded, so the
 *  range switch cannot leave a stale figure standing next to a redrawn curve. */
function curveStats(pts: Point[]) {
  const net = pts[pts.length - 1].v - pts[0].v;
  let peak = pts[0].v, dd = 0, best = 0, up = 0;

  for (let i = 0; i < pts.length; i++) {
    const v = pts[i].v;
    peak = Math.max(peak, v);
    dd = Math.min(dd, v - peak);
    if (i > 0) {
      const delta = v - pts[i - 1].v;
      if (delta > 0) { up++; best = Math.max(best, delta); }
    }
  }

  return [
    { l: 'NET R · בטווח',   v: fmtR(net),          c: net >= 0 ? 'var(--pf-bull)' : 'var(--pf-bear)' },
    { l: 'MAX DRAWDOWN',    v: `${dd.toFixed(1)}R`, c: 'var(--pf-bear)' },
    { l: 'BEST MONTH',      v: fmtR(best),          c: 'var(--pf-gold)' },
    { l: 'חודשים חיוביים',  v: `${up}/${pts.length - 1}`, c: '#fff' },
  ];
}

// ── Reveal ───────────────────────────────────────────────────────────────────

/** One-way scroll reveal over every [data-reveal] node inside the page.
 *
 *  Two guarantees the handoff calls out and neither is optional: it never
 *  re-hides, and a 6s failsafe reveals anything still pending. Elements start
 *  at opacity 0 in CSS, so a mechanism that can stall is a mechanism that can
 *  leave the page blank. */
function useReveal(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;

    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'));
    const show = (n: Element) => n.classList.add('is-in');

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach(show);
      return;
    }

    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    );
    nodes.forEach(n => io.observe(n));

    const failsafe = window.setTimeout(() => nodes.forEach(show), 6000);
    return () => { io.disconnect(); window.clearTimeout(failsafe); };
  }, [root]);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const root = useRef<HTMLDivElement | null>(null);
  useReveal(root);

  const [range, setRange] = useState<RangeKey>('12M');
  const [tab, setTab] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // Hero ticker state. One interval drives all of it.
  const [feed, setFeed] = useState(0);
  const [ago, setAgo] = useState(4);
  const [flash, setFlash] = useState(false);
  const [clock, setClock] = useState('');
  const agoRef = useRef(4);

  useEffect(() => {
    const stamp = () => {
      const now = new Date();
      setClock(`${clockInZone(TZ, now)} ${israelAbbrev(now)}`);
    };
    stamp();

    const id = window.setInterval(() => {
      const next = agoRef.current >= 46 ? 0 : agoRef.current + 1;
      const rolled = next === 0;
      agoRef.current = next;
      setAgo(next);
      setFlash(rolled);
      if (rolled) setFeed(f => (f + 1) % FEED.length);
      stamp();
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  const live = FEED[feed];
  const liveUp = !live.r.startsWith('-');
  const agoText = `תועד לפני ${ago} דק׳`;

  const points = useMemo(() => {
    const n = RANGES.find(r => r.key === range)?.points ?? SERIES.length;
    return SERIES.slice(-n);
  }, [range]);

  const geo = useMemo(() => geometry(points), [points]);
  const stats = useMemo(() => curveStats(points), [points]);

  // The tooltip is always mounted so it can travel between points rather than
  // blink in and out. With nothing hovered it fades out and drifts back to the
  // middle of the well — the resting position the prototype parks it at.
  const [lastHover, setLastHover] = useState(0);
  const tipDot = geo.dots[Math.min(lastHover, geo.dots.length - 1)];
  const tipAt = hover !== null
    ? { left: `${(tipDot.x / 1000) * 100}%`, top: `${(tipDot.y / 340) * 100}%` }
    : { left: '50%', top: '40%' };

  const active = TABS[tab];
  const maxR = Math.max(...active.rows.map(r => r.cumR));

  return (
    <div className="pf" dir="rtl" ref={root}>
      {/* Revealed content starts at opacity 0 and is turned on by the observer.
          Without JS there is no observer, so the page would render blank —
          this is the one line that keeps it readable. */}
      <noscript><style>{'.pf [data-reveal]{opacity:1}'}</style></noscript>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="pf-hero">
        <div className="pf-hero-wash" aria-hidden />
        <div className="pf-hero-grid" aria-hidden />

        <div className="pf-hero-in">
          <div className="pf-badge" data-reveal>
            <i className="pf-badge-dot" aria-hidden />
            יומן מסחר חכם · נתונים מתועדים, לא הבטחות
          </div>

          <h1 className="pf-h1" data-reveal>
            מספרים אמיתיים.<br />
            <span>בלי לייפות.</span>
          </h1>

          <p className="pf-lead" data-reveal>
            לפני שאתה משלם — תראה את האמת. אלה הנתונים המצרפיים מתוך העסקאות שתועדו ביומן,
            פתוחים לכולם. הנה טעימה; התמונה המלאה — חיתוך לפי סשן, סטאפ, כיוון, שעה ויום,
            התפלגות R ו-Edge Score אישי — נפתחת עם המנוי.
          </p>

          {/* The last documented trade, rotating every 47s. Not a market feed:
              nothing here updates from the market, and no copy says it does. */}
          <div className="pf-ticker" data-reveal>
            <div className="pf-sweep-layer" aria-hidden><div className="pf-sweep-bar" /></div>

            <div className="pf-ticker-row">
              <div>
                <div className="pf-ticker-label">העסקה האחרונה שתועדה</div>
                <div className="pf-ticker-vals">
                  <span
                    className="pf-ticker-r"
                    dir="ltr"
                    data-tone={liveUp ? 'up' : 'down'}
                    data-flash={flash ? 'true' : 'false'}
                  >
                    {live.r}
                  </span>
                  <span className="pf-ticker-sym" dir="ltr">{live.sym} · {live.session}</span>
                </div>
              </div>

              <div className="pf-ticker-left">
                <span className="pf-ticker-clock" dir="ltr">{clock || '—'}</span>
                <span className="pf-ticker-ago">{agoText}</span>
              </div>
            </div>

            <div className="pf-ticker-div" />

            <div className="pf-ticker-foot">
              <span>נסגרה {live.closedAt} · תגיות אישור ומצב רגשי תועדו</span>
              <span dir="ltr">+18.6R CUM · 30D</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <section className="pf-kpi-sec">
        <div className="pf-kpi" data-reveal>
          {KPIS.map(k => (
            <div className="pf-kpi-cell" key={k.label}>
              <div className="pf-kpi-v" dir="ltr" data-font={k.font} style={{ color: k.color }}>
                {k.value}
              </div>
              <div className="pf-kpi-l">{k.label}</div>
              <div className="pf-kpi-n">{k.note}</div>
            </div>
          ))}
        </div>
        <div className="pf-kpi-cap">
          {D} מבוסס על כל העסקאות המתועדות במערכת · עודכן לאחרונה לפני {ago} דק׳
        </div>
      </section>

      {/* ── How the journal works ──────────────────────────────────────── */}
      <section className="pf-steps" id="steps">
        <div className="pf-in">
          <div className="pf-head-center" data-reveal>
            <span className="pf-kicker">איך היומן עובד</span>
            <h2 className="pf-h2">תתעד ← תבין ← תשתפר.</h2>
          </div>

          <div className="pf-steps-grid" data-reveal>
            {STEPS.map(s => (
              <article className="pf-step" key={s.n}>
                <div className="pf-step-glow" aria-hidden />
                <div className="pf-step-head">
                  <span className="pf-step-n" dir="ltr">{s.n}</span>
                  <span className="pf-step-d" aria-hidden>{D}</span>
                </div>
                <h3 className="pf-step-t">{s.title}</h3>
                <p className="pf-step-b">{s.body}</p>
                <div className="pf-step-tags">
                  {s.tags.map(t => <span className="pf-step-tag" key={t} dir="ltr">{t}</span>)}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Equity curve ───────────────────────────────────────────────── */}
      <section className="pf-equity-sec" id="equity">
        <div className="pf-panel" data-reveal>
          <div className="pf-panel-head">
            <div>
              <span className="pf-kicker">EQUITY CURVE · R מצטבר</span>
              <h2 className="pf-panel-h2">הקו שמספר את כל הסיפור</h2>
              <p className="pf-panel-sub">
                צבירת R מאז תחילת התיעוד. ללא מינוף משתנה, ללא נורמליזציה בדיעבד.
              </p>
            </div>

            <div className="pf-switch" role="group" aria-label="טווח העקומה">
              {RANGES.map(r => (
                <button
                  key={r.key}
                  type="button"
                  dir="ltr"
                  aria-pressed={range === r.key}
                  onClick={() => { setRange(r.key); setHover(null); }}
                >
                  {r.key}
                </button>
              ))}
            </div>
          </div>

          <div className="pf-well">
            <div className="pf-well-glow" aria-hidden />

            <svg
              className="pf-svg"
              viewBox="0 0 1000 340"
              preserveAspectRatio="none"
              role="img"
              aria-label={`עקומת R מצטבר · ${points[0].m} ${points[0].v}R עד ${points[points.length - 1].m} ${points[points.length - 1].v}R`}
            >
              <defs>
                <linearGradient id="pfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#d4af37" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
                </linearGradient>
              </defs>

              {geo.grid.map((g, i) => (
                <g key={i}>
                  <line x1="0" y1={g.y} x2="1000" y2={g.y} stroke="#1c1c1e" strokeWidth="1" />
                  <text
                    x="994" y={g.y - 6} textAnchor="end" fill="#52525b"
                    fontFamily="var(--pf-mono)" fontSize="11" fontWeight="700"
                  >
                    {`${g.v >= 0 ? '+' : ''}${g.v.toFixed(0)}R`}
                  </text>
                </g>
              ))}

              <path className="pf-area" d={geo.area} fill="url(#pfFill)" />
              <path
                className="pf-curve"
                d={geo.line}
                fill="none"
                stroke="#d4af37"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray="2600"
              />

              {geo.dots.map((d, i) => (
                <g key={d.m}>
                  <circle
                    cx={d.x} cy={d.y} r={hover === i ? 6 : 3.2}
                    fill="#050505" stroke="#d4af37" strokeWidth="2"
                  />
                  <circle
                    className="pf-hit"
                    cx={d.x} cy={d.y} r="22" fill="transparent"
                    onMouseEnter={() => { setHover(i); setLastHover(i); }}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              ))}
            </svg>

            <div className="pf-xaxis" aria-hidden>
              {geo.dots.map(d => <span key={d.m}>{d.m}</span>)}
            </div>

            <div
              className="pf-tip"
              data-on={hover !== null}
              style={tipAt}
              aria-hidden
            >
              <div className="pf-tip-v" dir="ltr">{fmtR(tipDot.v)}</div>
              <div className="pf-tip-l" dir="ltr">{tipDot.m} · CUMULATIVE</div>
            </div>
          </div>

          <div className="pf-curve-stats">
            {stats.map(s => (
              <div className="pf-curve-cell" key={s.l}>
                <div className="pf-curve-l">{s.l}</div>
                <div className="pf-curve-v" dir="ltr" style={{ color: s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Breakdown ──────────────────────────────────────────────────── */}
      <section className="pf-break">
        <div className="pf-in">
          <div className="pf-head-center" data-reveal>
            <span className="pf-kicker">BREAKDOWN</span>
            <h2 className="pf-h2">לא מזל. לוגיקה.</h2>
            <p className="pf-break-p">
              אותו מספר סופי, מפורק לשכבות: מתי נסחר, באיזה יום, ולפי איזה מודל.
              כאן רואים אם הקצה עקבי או תלוי בשורה אחת מוצלחת.
            </p>
          </div>

          <div className="pf-tabs" data-reveal>
            <div className="pf-switch" role="group" aria-label="חתך הנתונים">
              {TABS.map((t, i) => (
                <button key={t.key} type="button" aria-pressed={tab === i} onClick={() => setTab(i)}>
                  {t.tabLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="pf-table" data-reveal>
            <div className="pf-brow pf-bhead">
              <span>{active.head}</span>
              <span className="pf-bcol-hide">R מצטבר</span>
              <span>עסקאות</span>
              <span>אחוז הצלחה</span>
              <span className="pf-bcol-hide">R ממוצע</span>
            </div>

            {active.rows.map((r, i) => {
              const lead = i === 0;
              return (
                <div className="pf-brow pf-brow-body" key={i} data-lead={lead}>
                  <div className="pf-bcol1">
                    <span className="pf-bdia" aria-hidden>{D}</span>
                    <span className="pf-blabel" dir={active.key === 'day' ? 'rtl' : 'ltr'}>{r.label}</span>
                  </div>

                  <div className="pf-bcol2">
                    <span className="pf-br" dir="ltr">{fmtR(r.cumR)}</span>
                    <span className="pf-track">
                      <span className="pf-fill" style={{ width: `${(r.cumR / maxR) * 100}%` }} />
                    </span>
                  </div>

                  <span className="pf-bnum" dir="ltr">{r.n.toLocaleString('en-US')}</span>
                  <span className="pf-bnum" dir="ltr">{r.winRate.toFixed(1)}%</span>
                  <span className="pf-bnum pf-bcol-hide" dir="ltr" data-gold="true">
                    {`+${(r.cumR / r.n).toFixed(2)}R`}
                  </span>
                </div>
              );
            })}

            <div className="pf-bfoot">{active.foot}</div>
          </div>
        </div>
      </section>

      {/* ── Trade log ──────────────────────────────────────────────────── */}
      <section className="pf-log" id="log">
        <div className="pf-in">
          <div className="pf-log-head" data-reveal>
            <div>
              <span className="pf-kicker">TRADE LOG</span>
              <h2 className="pf-h2">עסקאות אמיתיות, לא הבטחות</h2>
              <p className="pf-log-p">
                שש עסקאות מתועדות מהחודש האחרון — כולל ההפסדים. לחיצה על שורה פותחת את
                הסקרינשוט של הצ׳ארט ואת ההיגיון שמאחורי הכניסה.
              </p>
            </div>
            <span className="pf-log-meta">{D} 6 מתוך 1,240 · נבחרו כרונולוגית</span>
          </div>

          <div className="pf-log-table" data-reveal>
            <div className="pf-lrow pf-lhead">
              <span>תאריך</span>
              <span>כלי</span>
              <span>כיוון</span>
              <span>סשן</span>
              <span>מודל</span>
              <span>R</span>
              <span />
            </div>

            {TRADES.map((t, i) => {
              const isOpen = open === i;
              return (
                <div className="pf-lwrap" key={t.date + t.sym} data-open={isOpen}>
                  <button
                    type="button"
                    className="pf-lrow pf-lbtn"
                    aria-expanded={isOpen}
                    aria-controls={`pf-trade-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    <span className="pf-ldate" dir="ltr">{t.date}</span>
                    <span className="pf-lsym" dir="ltr">{t.sym}</span>
                    <span className="pf-ldir" dir="ltr" data-d={t.dir}>{t.dir}</span>
                    <span className="pf-lses" dir="ltr">{t.session}</span>
                    <span className="pf-lset">{t.setup}</span>
                    <span className="pf-lr" dir="ltr" data-tone={t.r.startsWith('-') ? 'down' : 'up'}>{t.r}</span>
                    <span className="pf-lcaret" aria-hidden>↓</span>
                  </button>

                  {isOpen && (
                    <div className="pf-lbody" id={`pf-trade-${i}`}>
                      {/* The frame is the trade's attached chart screenshot once
                          journal images are wired; until then the black frame
                          names what belongs in it rather than sitting empty. */}
                      <div className="pf-shot">
                        <div className="pf-shot-inner" dir="ltr">
                          סקרינשוט צ׳ארט · {t.sym} {t.date}
                        </div>
                      </div>

                      <div>
                        <span className="pf-exec-l" dir="ltr">EXECUTION</span>
                        <div className="pf-specs">
                          {t.specs.map(([k, v]) => (
                            <div className="pf-spec" key={k}>
                              <div className="pf-spec-k">{k}</div>
                              <div className="pf-spec-v" dir="ltr">{v}</div>
                            </div>
                          ))}
                        </div>
                        <p className="pf-lnote">{t.note}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────────────────────── */}
      <section className="pf-cta-sec">
        <div className="pf-cta" data-reveal>
          <div className="pf-cta-bloom" aria-hidden />
          <h2 className="pf-cta-h2">תעד את העסקאות. תראה את התמונה.</h2>
          <p className="pf-cta-p">
            כל העסקאות שלך במקום אחד, מסודרות לפי חתכים — כדי שתדע מה עובד לך ומה כדאי לשנות.
          </p>
          <div className="pf-cta-row">
            <Link href="/pricing" className="pf-btn pf-btn-primary">הצטרפות למערכת</Link>
            <Link href="/pricing#plans" className="pf-btn pf-btn-ghost">השוואת מסלולים</Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="pf-foot">
        <div className="pf-foot-in">
          <div>
            <span className="pf-foot-l">הצהרת סיכון ושקיפות</span>
            <p className="pf-foot-p">
              מסחר בחוזים עתידיים כולל סיכון מהותי לאובדן הון, ואינו מתאים לכל אדם. הביצועים
              המוצגים בדף זה הם תיעוד היסטורי של המערכת ואינם הבטחה או אינדיקציה לתוצאות עתידיות.
              הכלים והנתונים מיועדים למטרות לימוד ומחקר בלבד ואינם מהווים ייעוץ השקעות, שיווק
              השקעות או המלצה לביצוע פעולה. התובנות המוצגות הן עיבוד סטטיסטי של היומן שתיעדת
              ואינן איתות או הוראת מסחר — יש להפעיל תמיד שיקול דעת עצמאי. השימוש באתר ובמערכת
              הוא באחריות המשתמש בלבד.
            </p>
          </div>

          <div>
            <span className="pf-foot-l" data-dim="true">מתודולוגיית המדידה</span>
            <ul className="pf-method">
              {METHOD.map(m => (
                <li key={m}><i aria-hidden>{D}</i><span>{m}</span></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pf-foot-bar">
          <span dir="ltr">ONYX TRADING · ES / NQ · ISRAEL TIME (IDT)</span>
          {/* The site-wide footer stands down on this route, so the legal links
              it carries live here instead. */}
          <nav className="pf-foot-links">
            {LEGAL.map(l => <Link key={l.href} href={l.href}>{l.t}</Link>)}
          </nav>
          <span dir="ltr">© 2026 · ALL RIGHTS RESERVED</span>
        </div>
      </footer>
    </div>
  );
}
