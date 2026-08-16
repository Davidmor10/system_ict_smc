'use client';

import Link from 'next/link';
import SplashIntro from '../../components/SplashIntro';
import Reveal from './Reveal';
import './landing.css';

// ─────────────────────────────────────────────────────────────────────────────
// The landing page — a sales page, in the order a sale actually happens.
//
// Recognition, then cost, then the turn, then proof, then price, then the
// objection that was going to stop them anyway. Features come late and on
// purpose: nobody buys a feature list, they buy the end of a problem, and the
// list only matters once they believe the problem is theirs.
//
// Every claim names something that exists in the app today. A landing page
// that promises a screen the product does not have costs more on the first
// login than it earned on the click.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';

// ── hero mock ───────────────────────────────────────────────────────────────

const CURVE = [0, 8, 5, 14, 22, 18, 27, 24, 33, 29, 21, 26, 35, 44, 40, 52, 61, 57, 68, 78];

function HeroMock() {
  const w = 380, h = 58;
  const max = Math.max(...CURVE), min = Math.min(...CURVE);
  const d = CURVE.map((v, i) =>
    `${i ? 'L' : 'M'}${((i / (CURVE.length - 1)) * w).toFixed(1)} ${(h - 4 - ((v - min) / (max - min)) * (h - 10)).toFixed(1)}`,
  ).join(' ');

  return (
    <div className="lp-mock lp-in" style={{ animationDelay: '260ms' }}>
      <div className="lp-mock-bar">
        <i /><i /><i />
        <span>onyx · דשבורד</span>
      </div>

      <div className="lp-mock-body">
        <div className="lp-mock-row">
          <div>
            <div className="lp-mock-k">רווח נקי · 30 יום</div>
            <div className="lp-mock-big">+$1,152</div>
          </div>
          <div>
            <div className="lp-mock-k">ציון יתרון</div>
            <div className="lp-mock-big" style={{ fontSize: 26 }}>71.4</div>
          </div>
        </div>

        <svg className="lp-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="lpEq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(212,175,55,0.28)" />
              <stop offset="100%" stopColor="rgba(212,175,55,0)" />
            </linearGradient>
          </defs>
          <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="url(#lpEq)" style={{ animation: 'lp-fade 900ms 900ms both' }} />
          <path
            d={d} pathLength={1} fill="none" stroke="#d4af37" strokeWidth={1.8} vectorEffect="non-scaling-stroke"
            style={{ strokeDasharray: 1, animation: 'lp-draw 1600ms 700ms cubic-bezier(0.16,1,0.3,1) both' }}
          />
        </svg>
      </div>

      <div className="lp-mock-cells">
        <div><span className="lp-mock-k">אחוז הצלחה</span><b>62.5%</b></div>
        <div><span className="lp-mock-k">פקטור רווח</span><b>2.41</b></div>
        <div><span className="lp-mock-k">תוחלת</span><b>+$63</b></div>
      </div>

      <div className="lp-mock-body">
        <div className="lp-insight">
          <span>{D} התובנה של היום</span>
          <p>
            ב־7 מתוך 8 העסקאות המנצחות שלך יצאת לפני היעד. תכננת 2.6R בממוצע ולקחת 1.4R.
            זה לא הפסד — זה חצי מהרווח שהתוכנית שלך כבר הרוויחה.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── copy ────────────────────────────────────────────────────────────────────

/** Questions, not testimonials.
 *
 *  This strip's job is recognition — the reader seeing their own situation
 *  before anything is claimed. A quote does that by putting words in someone's
 *  mouth, and there is no one to attribute them to. A question does it better
 *  anyway: the reader answers it themselves, and an answer they produced is
 *  worth more than a stranger's sentence they were asked to believe. */
const ASK_STRIP = [
  'היה לך חודש טוב — אתה יודע להגיד למה?',
  'יש לך טעות שחוזרת — אתה יודע כמה היא עולה לך בשנה?',
  'פתחת פעם אקסל למעקב — חזרת אליו?',
  'שינית משהו בגישה — יש לך דרך לדעת אם זה עזר?',
];

const COSTS = [
  {
    k: 'עלות ראשונה',
    t: 'יתרון שאתה לא יודע שיש לך',
    b: 'יש לך סטאפ, שעה או סשן שבהם אתה באמת טוב. בלי לחתוך את הנתונים אתה מפזר את אותו סיכון על הכל — במקום להכפיל את המקום היחיד שמחזיר לך כסף.',
  },
  {
    k: 'עלות שנייה',
    t: 'הרגל שאתה לא יודע שיש לך',
    b: 'להזיז סטופ, לצאת מוקדם, לקחת עסקה שלישית אחרי הפסד. פעם אחת זו לא בעיה. ארבעים פעם בשנה זה ההבדל בין חשבון שצומח לחשבון שדורך במקום.',
  },
  {
    k: 'עלות שלישית',
    t: 'שיפור שאתה לא יכול להוכיח',
    b: 'בלי מדידה אתה מחליף גישה כל חודש, כי אף פעם אין לך ראיה שמשהו עבד. זה לא חוסר משמעת — זה חוסר משוב.',
  },
];

const ASKS = [
  { n: '01', q: 'מה באמת עובד לי?', a: 'לא מה שאתה זוכר — מה שהמספרים מראים. פילוח לפי סשן, שעה, סטאפ, כיוון, אישורי כניסה ומצב רגשי.' },
  { n: '02', q: 'מה באמת עולה לי?', a: 'ההרגלים שחוזרים: יציאה מוקדמת, סטופ שהורחב, חריגה מהכללים, קפיצה בגודל הפוזיציה. נספרים, לא מנוחשים.' },
  { n: '03', q: 'האם השתפרתי?', a: 'ציון יתרון משוקלל שזז לאורך זמן, ומעקב אחרי כל שינוי שניסית — כדי שתדע אם הוא עבד או רק הרגיש נכון.' },
];

const OUTCOMES = [
  {
    k: 'במקום לנחש',
    t: 'אתה מחליט לפי המספרים שלך',
    b: 'לא לפי מה שקראת בטוויטר ולא לפי איך שהיה השבוע. כל החלטה נשענת על ההיסטוריה שלך — עם המדגם שמאחוריה גלוי לעין.',
  },
  {
    k: 'במקום לחזור',
    t: 'הטעות מפסיקה להיות בלתי נראית',
    b: 'המערכת סופרת כל הרגל, אומרת לך כמה פעמים הוא הופיע מתוך כמה הזדמנויות, ומראה לך את העסקאות עצמן.',
  },
  {
    k: 'במקום להרגיש',
    t: 'אתה רואה את השיפור קורה',
    b: 'ציון יתרון שעולה, דפוס שנחלש, הרגל שנעלם. שינוי שאפשר להצביע עליו, ולא רק תחושה שהחודש היה טוב.',
  },
];

const STEPS = [
  { n: '01', t: 'מתעד — שתי דקות', b: 'כניסה, סטופ, יעד, יציאה. הרווח, ה־R, הסשן והתוצאה מחושבים לבד. אפשר גם לשמור עסקה פתוחה ולסגור אחר כך.' },
  { n: '02', t: 'המערכת עובדת בלילה', b: 'עוברת על כל היומן, מחפשת מה חוזר על עצמו, ובודקת כל דפוס סטטיסטית לפני שהיא אומרת עליו מילה.' },
  { n: '03', t: 'אתה מקבל תשובות', b: 'תובנה יומית בכניסה לדשבורד, דוח שבועי, וצ׳אט שאפשר לשאול אותו הכל על המסחר שלך.' },
];

const TOOLS = [
  { t: 'דשבורד יומי', p: 'STARTER', b: 'התובנה של היום בכניסה, לוח חודשי עם התוצאה של כל יום, והסשן שפעיל עכשיו.' },
  { t: 'יומן מסחר', p: 'STARTER', b: 'תיעוד בשתי דקות: יציאות מרובות, אישורי כניסה, מצב רגשי, צילומי מסך, ואירועי ניהול עם שעה.' },
  { t: 'סטטיסטיקות', p: 'DELUXE', b: 'עקומת הון, הירידה הכי כואבת, רווח יומי, רצפים, תוחלת, ציון יתרון, ופילוח לפי סשן ויום.' },
  { t: 'אנליטיקת AI', p: 'PRO', b: 'אחת עשרה זוויות על אותן עסקאות, גילוי דפוסים, ו"מה באמת עובד לך" — עם מבחן מובהקות.' },
  { t: 'Onyx Trainer', p: 'DELUXE', b: 'צ׳אט שקרא את היומן שלך. עונה על שאלות מהנתונים, ומסביר מושגי מסחר כשצריך.' },
  { t: 'דוחות שבועיים', p: 'PRO', b: 'סיכום אישי של השבוע עם ארכיון מלא, כדי שתוכל להשוות חודש מול חודש.' },
  { t: 'מחברת', p: 'STARTER', b: 'התוכנית לפני הפתיחה ומה שקרה אחריה. ה־AI קורא גם אותה ומצליב מול מה שבאמת עשית.' },
  { t: 'ספר סטאפים', p: 'STARTER', b: 'כל הסטאפים שלך במקום אחד, כל אחד מחובר לביצועים האמיתיים שלו.' },
  { t: 'חוקים אישיים', p: 'STARTER', b: 'החוקים שקבעת לעצמך, ומעקב אחרי כמה פעמים באמת עמדת בהם.' },
];

const CHAT = [
  { who: 'user', text: 'מה הסשן הכי חזק שלי?' },
  { who: 'onyx', text: 'בדקתי 34 עסקאות סגורות. **NY AM** — 68% הצלחה על 19 עסקאות, מול 44% בשאר היום. זה הפער הכי גדול ביומן שלך, והוא מחזיק כבר שישה שבועות.' },
  { who: 'user', text: 'ולמה אני מפסיד ביום שישי?' },
  { who: 'onyx', text: 'יש לך רק 4 עסקאות ביום שישי, וזה מעט מדי בשביל להגיד משהו בביטחון. מה שכן: בשלוש מהן הרחבת את הסטופ. זה לא מספיק כדי לקרוא לזה דפוס — אבל שווה שתשים לב.' },
];

const TRUTHS = [
  {
    t: 'כל מספר מגיע עם המדגם שמאחוריו',
    b: 'אחוז הצלחה על 3 עסקאות הוא לא אחוז הצלחה. המערכת לא מציגה טענה מתחת ל־8 עסקאות מוכרעות ולא קוראת לה מבוססת מתחת ל־15 — ותמיד אומרת לך על כמה עסקאות היא מדברת.',
  },
  {
    t: 'מה שלא תיעדת לא נספר נגדך',
    b: 'אם לא ענית אם עמדת בכללים, זו לא חריגה — זו שאלה שלא נשאלה. היא יוצאת מהחישוב, והמערכת אומרת לך כמה חסר. הרבה מערכות סופרות שתיקה כאילו היא כישלון.',
  },
  {
    t: 'דפוס עובר מבחן לפני שהוא נאמר בקול',
    b: 'המערכת חותכת את ההיסטוריה שלך בעשרות דרכים. בכמות כזאת תמיד יימצא משהו שנראה כמו יתרון במקרה. לכן כל דפוס נבדק מול שאר העסקאות ומתוקן למספר הבדיקות שנעשו.',
  },
  {
    t: 'המספרים מנצחים את הזיכרון',
    b: 'אם כתבת שלא נגעת בסטופ אבל היומן מתעד שהזזת אותו, המערכת מראה לך את שתי הגרסאות ולא בוחרת בשקט. אתה מחליט מה נכון.',
  },
];

const PLANS = [
  { n: 'STARTER', p: '49', feat: ['יומן מסחר מלא', 'דשבורד ולוח חודשי', 'סטאפים, חוקים ומחברת', 'תובנת AI על כל עסקה'] },
  { n: 'PRO', p: '99', featured: true, feat: ['כל מה שב־STARTER', 'אנליטיקת AI המלאה', 'זיכרון דפוסים אישי', 'סימולטור תרחישים', 'דוח שבועי + ארכיון'] },
  { n: 'DELUXE', p: '199', feat: ['כל מה שב־PRO', 'Onyx Trainer — צ׳אט אישי', 'עמוד סטטיסטיקה מלא', 'ציון יתרון ומעקב משמעת'] },
];

const FAQ = [
  {
    q: 'יש לי כבר יומן באקסל. למה שאחליף?',
    a: 'כי אקסל הוא מקום שכותבים לתוכו ולא מקבלים ממנו כלום. הוא לא יגיד לך שאתה יוצא מוקדם ב־7 מתוך 8 מנצחות, לא יבדוק אם הפער בין הסשנים מובהק סטטיסטית, ולא יזכיר לך בעוד חודש שהדפוס שתיקנת חזר. Onyx לוקח את אותן שתי דקות של תיעוד ומחזיר לך תשובות במקום שורות.',
  },
  {
    q: 'כמה זמן עד שאני רואה משהו?',
    a: 'תובנה ראשונה על עסקה בודדת — מיד. פילוח לפי סשן וסטאפ — בסביבות 8 עסקאות סגורות, בערך שבועיים של מסחר רגיל. טענה שהמערכת קוראת לה מבוססת — 15 עסקאות. המערכת לא תמציא לך מסקנות בינתיים; היא תגיד לך בדיוק כמה חסר.',
  },
  {
    q: 'אני לא סוחר לפי ICT. זה עדיין מתאים לי?',
    a: 'כן. המערכת לא מניחה שום שיטה. אתה מגדיר את הסטאפים שלך בשמות שלך ואת החוקים שלך במילים שלך, והניתוח רץ על מה שהגדרת. ICT ו־SMC הם מה שהרבה מהמשתמשים סוחרים — לא תנאי כניסה.',
  },
  {
    q: 'למה לשלם על עוד מנוי?',
    a: 'כי זה המנוי היחיד שמחזיר לך את עצמו במספרים שאתה כבר עוקב אחריהם. STARTER עולה 49 ₪ בחודש ו־PRO עולה 99 ₪ — פחות ממה שעולה עסקה גרועה אחת בחוזה NQ. אם המערכת תמנע ממך עסקה כזאת אחת בחודש, היא כבר שילמה על עצמה. אפשר לבטל בכל רגע.',
  },
  {
    q: 'מה אם לא אתעד כל עסקה?',
    a: 'זה בסדר, והמערכת מתייחסת לזה בכנות. היא מציגה לך אחוז שלמות יומן ואומרת מה חסר — אבל היא לא ממציאה מה שלא רשמת ולא סופרת חוסר כאילו הוא כישלון. ככל שתתעד יותר, התשובות מתחדדות.',
  },
];

// ── page ────────────────────────────────────────────────────────────────────

function Head({ kicker, title, lead, center = true }: { kicker: string; title: React.ReactNode; lead?: string; center?: boolean }) {
  return (
    <Reveal className={center ? 'lp-center' : ''}>
      <span className="lp-kicker">{D} {kicker}</span>
      <h2 className="lp-h2">{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </Reveal>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      {/* The brand moment, restored. Session-once, tap to skip, and it never
          blocks the page underneath — the landing is already rendered behind it. */}
      <SplashIntro />

      {/* ── hero ───────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="wrap">
          <div className="lp-hero-grid">
            <div className="lp-in">
              <span className="lp-kicker lp-live"><i />לסוחרי חוזים · ES · NQ</span>
              <h1 className="lp-h1">אתה יודע אם החודש היה טוב.<br />אתה לא יודע <em>למה.</em></h1>
              <p className="lp-hero-sub">
                Onyx הופך שתי דקות של תיעוד אחרי כל עסקה למערכת שאומרת לך בעברית פשוטה מה
                מרוויח לך כסף, מה שורף אותו, ואם התיקון שעשית באמת עבד. לא עוד יומן שכותבים
                לתוכו ולא מקבלים ממנו כלום.
              </p>
              <div className="lp-cta">
                <Link href="/pricing" className="btn-lg-gold">בחירת מסלול</Link>
                <a href="#how" className="btn-lg-ghost">איך זה עובד</a>
              </div>
              {/* Three facts that are true of the product as built. Nothing
                  about billing — that is a promise this page cannot keep. */}
              <p className="lp-chips">
                <span>תיעוד בשתי דקות</span>
                <span>11 חתכי ניתוח</span>
                <span>ES ו-NQ</span>
              </p>
            </div>

            <HeroMock />
          </div>
        </div>
      </section>

      {/* ── recognition ────────────────────────────────────── */}
      <div className="lp-quotes">
        {ASK_STRIP.map((q, i) => (
          <Reveal className="lp-quote" key={q} delay={i * 80}>
            <i>?</i>
            <p>{q}</p>
          </Reveal>
        ))}
      </div>

      {/* ── the cost ───────────────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <Head
            kicker="הבעיה"
            title={<>מה שאתה לא מודד — אתה משלם עליו.</>}
            lead="רוב הסוחרים לא נכשלים מחוסר אסטרטגיה. הם נכשלים כי אין להם תמונה מסודרת של מה שהם עצמם עושים, ולכן הם משלמים על אותם שלושה דברים שוב ושוב."
          />
          <div className="lp-grid lp-grid-3">
            {COSTS.map((c, i) => (
              <Reveal key={c.t} delay={i * 110}>
                <div className="lp-card" style={{ height: '100%' }}>
                  <div className="lp-card-i">{D}</div>
                  <span className="lp-out-k">{c.k}</span>
                  <h3 style={{ marginTop: 10 }}>{c.t}</h3>
                  <p>{c.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── the turn ───────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="wrap">
          <Head
            center={false}
            kicker="הפתרון"
            title={<>שלוש שאלות שסוחר<br />לא יכול לענות עליהן לבד.</>}
            lead="Onyx קיים בשביל שלוש השאלות האלה. כל שאר המערכת בנויה כדי לענות עליהן היטב."
          />
          <div className="lp-asks">
            {ASKS.map((a, i) => (
              <Reveal className="lp-ask" key={a.n} delay={i * 90}>
                <b>{a.n}</b>
                <h3>{a.q}</h3>
                <p>{a.a}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── outcomes ───────────────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <Head
            kicker="מה משתנה"
            title={<>לא עוד כלי. הרגל עבודה אחר.</>}
            lead="הפיצ׳רים הם אמצעי. זה מה שקורה למסחר שלך אחרי חודש עם המערכת."
          />
          <div className="lp-outs">
            {OUTCOMES.map((o, i) => (
              <Reveal key={o.t} delay={i * 110}>
                <div className="lp-out" style={{ height: '100%' }}>
                  <span className="lp-out-k">{o.k}</span>
                  <h3>{o.t}</h3>
                  <p>{o.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── how ────────────────────────────────────────────── */}
      <section className="lp-sec" id="how">
        <div className="wrap">
          <Head
            kicker="איך זה עובד"
            title={<>שלושה שלבים. רק אחד מהם שלך.</>}
          />
          <div className="lp-steps" style={{ ['--lp-step-count' as string]: STEPS.length }}>
            {STEPS.map((s, i) => (
              <Reveal className="lp-step" key={s.n} delay={i * 100}>
                <b>{s.n}</b>
                <h4>{s.t}</h4>
                <p>{s.b}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── the toolset ────────────────────────────────────── */}
      <section className="lp-sec" data-tint id="features">
        <div className="wrap">
          <Head
            kicker="מה יש בפנים"
            title={<>כל מה שסוחר אמיתי צריך.</>}
            lead="תשעה כלים שקוראים את אותו יומן, ולכן שום שניים מהם לא יכולים לספר לך סיפור אחר על אותו חודש."
          />
          <div className="lp-tools">
            {TOOLS.map((t, i) => (
              <Reveal className="lp-tool" key={t.t} delay={(i % 3) * 80}>
                <div className="lp-tool-h">
                  <i>{D}</i><b>{t.t}</b><em>{t.p}</em>
                </div>
                <p>{t.b}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── trainer ────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="wrap">
          <div className="lp-split">
            <Reveal>
              <span className="lp-kicker">{D} Onyx Trainer</span>
              <h2 className="lp-h2">שאל אותו כל דבר.<br />הוא כבר קרא את היומן שלך.</h2>
              <p className="lp-lead">
                רוב הצ׳אטים יודעים הכל על מסחר ושום דבר עליך. Onyx Trainer יודע את שניהם: הוא
                יסביר לך מה זה FVG כמו כל אחד אחר, אבל כששואלים אותו על המסחר שלך — הוא עונה
                מהעסקאות שלך, עם המספרים.
              </p>
              <p className="lp-lead" style={{ marginTop: 18 }}>
                וכשאין לו מספיק נתונים כדי לענות, הוא אומר את זה. זה נשמע קטן, וזה בדיוק ההבדל
                בין עצה שאפשר לסמוך עליה לבין עצה שנשמעת טוב.
              </p>
              <div className="lp-cta">
                <Link href="/pricing" className="btn-lg-gold">לראות את המסלולים</Link>
              </div>
            </Reveal>

            <Reveal delay={140}>
              <div className="lp-chat">
                <div className="lp-chat-h">
                  <span style={{ color: 'var(--lp-gold)', fontSize: 11 }}>{D}</span>
                  <b>Onyx Trainer</b>
                </div>
                <div className="lp-chat-b">
                  {CHAT.map((m, i) => (
                    <div
                      key={i}
                      className="lp-msg"
                      data-who={m.who}
                      dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.+?)\*\*/g, '<em>$1</em>') }}
                    />
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── trust ──────────────────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <Head
            center={false}
            kicker="למה לסמוך על המספרים"
            title={<>מערכת שאומרת לך גם כשהיא לא יודעת.</>}
            lead="הכי קל בעולם להראות לסוחר מספר מרשים. הרבה יותר קשה להראות לו מספר שאפשר לסמוך עליו. ארבעה כללים שהמערכת בנויה סביבם:"
          />
          <div className="lp-truth">
            {TRUTHS.map((t, i) => (
              <Reveal className="lp-truth-row" key={t.t} delay={i * 80}>
                <i>{D}</i>
                <div>
                  <h4>{t.t}</h4>
                  <p>{t.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── plans ──────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="wrap">
          <Head
            kicker="מסלולים"
            title={<>אותן עסקאות.<br />שלוש רמות של תשובות.</>}
            lead="היומן זהה בכל מסלול, כי בלעדיו אין מה לנתח. מה שמשתנה הוא כמה עמוק המערכת נכנסת לנתונים שלך. אפשר לבטל בכל רגע."
          />
          <Reveal>
            <p className="lp-anchor">
              עסקה גרועה אחת בחוזה NQ עולה יותר מ־<b>חודש שלם של PRO</b>. אם המערכת תמנע ממך
              אחת כזאת בחודש — היא כבר החזירה את עצמה.
            </p>
          </Reveal>
          <div className="lp-plans" style={{ ['--lp-plan-count' as string]: PLANS.length }}>
            {PLANS.map((p, i) => (
              <Reveal key={p.n} delay={i * 90}>
                <div className="lp-plan" data-featured={!!p.featured} style={{ height: '100%' }}>
                  <span className="lp-plan-n">{p.n}</span>
                  <span className="lp-plan-p">
                    <><span className="lp-n">{p.p}</span><small>₪ לחודש</small></>
                  </span>
                  <ul>{p.feat.map(f => <li key={f}>{f}</li>)}</ul>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="lp-cta" style={{ justifyContent: 'center', marginTop: 34 }}>
            <Link href="/pricing" className="btn-lg-ghost">השוואה מלאה בין המסלולים</Link>
          </Reveal>
        </div>
      </section>

      {/* ── objections ─────────────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <Head
            center={false}
            kicker="שאלות שנשאלות"
            title={<>מה שכנראה עובר לך בראש עכשיו.</>}
          />
          <div className="lp-faq">
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={i * 60}>
                <details>
                  <summary>{f.q}<i>+</i></summary>
                  <p className="lp-faq-a">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── close ──────────────────────────────────────────── */}
      <section className="lp-close">
        <div className="wrap">
          <Reveal>
            <span className="lp-kicker">{D} להתחיל</span>
            <h2 className="lp-h2" style={{ maxWidth: '22ch', marginInline: 'auto' }}>
              העסקה הבאה שלך יכולה להיות הראשונה שנספרת.
            </h2>
            <p className="lp-lead" style={{ marginInline: 'auto' }}>
              פתח חשבון, תעד עסקה אחת, וראה מה המערכת כבר יודעת לומר עליה.
            </p>
            <div className="lp-cta" style={{ justifyContent: 'center' }}>
              <Link href="/pricing" className="btn-lg-gold">בחירת מסלול</Link>
              <Link href="/sign-in" className="btn-lg-ghost">כבר יש לי חשבון</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
