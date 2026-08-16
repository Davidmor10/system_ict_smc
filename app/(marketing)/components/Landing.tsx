'use client';

import Link from 'next/link';
import './landing.css';

// ─────────────────────────────────────────────────────────────────────────────
// The landing page, for a visitor who is not signed in.
//
// Every claim below names something that exists in the app today. The previous
// version sold market charts and a live "engine"; Onyx has neither, and a
// landing page that promises a screen the product does not have costs more on
// the first login than it earned on the click.
//
// So the hero mock is the real dashboard's shape — the daily insight, the edge
// score, the equity curve from /dashboard/stats — and the feature grid is the
// sidebar, in order, with the plan each item actually needs.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';

// ── the hero mock ───────────────────────────────────────────────────────────

/** A real equity curve shape: up, a drawdown that hurts, then recovery. Drawn
 *  rather than screenshotted so it stays sharp and weighs nothing. */
const CURVE = [0, 8, 5, 14, 22, 18, 27, 24, 33, 29, 21, 26, 35, 44, 40, 52, 61, 57, 68, 78];

function HeroMock() {
  const w = 380, h = 58;
  const max = Math.max(...CURVE), min = Math.min(...CURVE);
  const d = CURVE.map((v, i) =>
    `${i ? 'L' : 'M'}${((i / (CURVE.length - 1)) * w).toFixed(1)} ${(h - 4 - ((v - min) / (max - min)) * (h - 10)).toFixed(1)}`,
  ).join(' ');

  return (
    <div className="lp-mock lp-in" style={{ animationDelay: '160ms' }}>
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
          <div style={{ textAlign: 'start' }}>
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
          <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="url(#lpEq)" style={{ animation: 'lp-fade 900ms 500ms both' }} />
          <path
            d={d} pathLength={1} fill="none" stroke="#d4af37" strokeWidth={1.8} vectorEffect="non-scaling-stroke"
            style={{ strokeDasharray: 1, animation: 'lp-draw 1500ms 300ms cubic-bezier(0.16,1,0.3,1) both' }}
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
            ב־7 מתוך 8 העסקאות המנצחות שלך יצאת לפני היעד. היעד הממוצע שתכננת היה 2.6R,
            ובפועל לקחת 1.4R. זה לא הפסד — זה חצי מהרווח שהתוכנית שלך כבר הרוויחה.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── content ─────────────────────────────────────────────────────────────────

const PROBLEMS = [
  {
    t: 'אותה טעות, שוב ושוב',
    b: 'אתה יודע שיש לך הרגל שעולה לך כסף. אתה לא יודע כמה בדיוק, באילו תנאים הוא מופיע, ואם הוא נעלם או רק לקח הפסקה.',
  },
  {
    t: 'יתרון שאתה לא רואה',
    b: 'יש שעה, סשן או סטאפ שבהם אתה באמת טוב. הוא קבור בין עשרות עסקאות, ובלי לחתוך את הנתונים אין דרך לדעת מה זה.',
  },
  {
    t: 'זיכרון שמשקר',
    b: 'אחרי חודש אתה זוכר את העסקה הכי דרמטית, לא את הממוצע. היומן זוכר את שתיהן — ומראה לך את ההבדל.',
  },
];

const FEATURES = [
  {
    icon: '▤', t: 'יומן מסחר', plan: 'free', planLabel: 'בכל המסלולים',
    b: 'מתעד עסקה בפחות מדקה: כניסה, סטופ, יעד ויציאות. המערכת מחשבת לבד את הרווח, את ה־R ואת הסשן. אפשר גם לשמור עסקה שעדיין פתוחה ולסגור אותה אחר כך.',
  },
  {
    icon: '▦', t: 'סטטיסטיקה', plan: 'deluxe', planLabel: 'DELUXE',
    b: 'עקומת ההון שלך, הירידה הכי כואבת שעברת, רווח והפסד לפי יום, רצפים, ציון יתרון משוקלל, ופילוח לפי סשן ולפי יום בשבוע. הכל מהעסקאות שלך, בלי הנחות.',
  },
  {
    icon: '✦', t: 'אנליטיקת AI', plan: 'pro', planLabel: 'PRO',
    b: 'אחת עשרה זוויות על אותן עסקאות: לפי מכשיר, סשן, כיוון, שעה, סטאפ, אישורי כניסה, מצב רגשי וניהול יציאות. מגלה דפוסים חוזרים, מסמן מה באמת עובד, ומסכם בדוח שבועי.',
  },
  {
    icon: '◈', t: 'Onyx Trainer', plan: 'deluxe', planLabel: 'DELUXE',
    b: 'צ׳אט שקורא את היומן שלך. שאל אותו על המסחר שלך ותקבל תשובה מהנתונים; שאל אותו מה זה FVG והוא יסביר. השיחות נשמרות ואפשר להצמיד את החשובות.',
  },
  {
    icon: '⬡', t: 'סטאפים וחוקים', plan: 'free', planLabel: 'בכל המסלולים',
    b: 'ספר הסטאפים שלך והחוקים שקבעת לעצמך, במקום אחד. כל סטאפ מחובר לביצועים האמיתיים שלו, כך שאתה רואה מי מהם מרוויח ומי רק תופס מקום.',
  },
  {
    icon: '✎', t: 'מחברת ותכנון יומי', plan: 'free', planLabel: 'בכל המסלולים',
    b: 'המקום לכתוב את התוכנית לפני שהשוק נפתח, ואת מה שקרה אחריו. המערכת קוראת גם את זה — ומצליבה בין מה שתכננת למה שבאמת עשית.',
  },
];

const CHAT = [
  { who: 'user', text: 'מה הסשן הכי חזק שלי?' },
  {
    who: 'onyx',
    text: 'בדקתי 34 עסקאות סגורות. **NY AM** — 68% הצלחה על 19 עסקאות, מול 44% בשאר היום. זה הפער הכי גדול ביומן שלך, והוא מחזיק כבר שישה שבועות.',
  },
  { who: 'user', text: 'ולמה אני מפסיד ביום שישי?' },
  {
    who: 'onyx',
    text: 'יש לך רק 4 עסקאות ביום שישי, וזה מעט מדי בשביל להגיד משהו בביטחון. מה שכן אפשר לומר: בשלוש מהן הרחבת את הסטופ. זה לא מספיק כדי לקרוא לזה דפוס — אבל שווה שתשים לב.',
  },
];

const STEPS = [
  { n: '01', t: 'מתעד', b: 'אחרי כל עסקה — כניסה, סטופ, יעד, יציאה. פחות מדקה.' },
  { n: '02', t: 'המערכת מחשבת', b: 'רווח, R, סשן ותוצאה נגזרים לבד. אתה לא מקליד מספר פעמיים.' },
  { n: '03', t: 'ה־AI לומד', b: 'כל לילה המערכת עוברת על היומן ומחפשת מה חוזר על עצמו.' },
  { n: '04', t: 'אתה מקבל תשובה', b: 'תובנה יומית, דוח שבועי, ומאמן שאפשר לשאול אותו הכל.' },
];

const TRUTHS = [
  {
    t: 'כל מספר מגיע עם המדגם שמאחוריו',
    b: 'אחוז הצלחה על 3 עסקאות הוא לא אחוז הצלחה. המערכת לא תציג טענה מתחת ל־8 עסקאות מוכרעות, ולא תקרא לה מבוססת מתחת ל־15. אתה תמיד רואה על כמה עסקאות היא מדברת.',
  },
  {
    t: 'מה שלא תיעדת — לא נספר נגדך',
    b: 'אם לא ענית אם עמדת בכללים, זו לא חריגה, זו שאלה שלא נשאלה. הרבה מערכות סופרות שתיקה כאילו היא כישלון. כאן היא פשוט יוצאת מהחישוב, והמערכת אומרת לך כמה חסר.',
  },
  {
    t: 'דפוס עובר מבחן סטטיסטי לפני שהוא נאמר בקול',
    b: 'המערכת חותכת את ההיסטוריה שלך בעשרות דרכים. בכמות כזאת של חתכים תמיד יימצא משהו שנראה כמו יתרון במקרה. לכן כל דפוס נבדק מול שאר העסקאות ומתוקן למספר הבדיקות שנעשו.',
  },
  {
    t: 'המספרים מנצחים את הזיכרון',
    b: 'אם כתבת שלא נגעת בסטופ אבל היומן מתעד שהזזת אותו, המערכת תראה לך את שתי הגרסאות ולא תבחר בשקט. אתה מחליט מה נכון.',
  },
];

const PLANS = [
  { n: 'FREE', p: '0', feat: ['יומן מסחר מלא', 'דשבורד ולוח חודשי', 'סטאפים, חוקים ומחברת', 'מחשבון פוזיציה'] },
  { n: 'STARTER', p: '49', feat: ['כל מה שב־FREE', 'תובנת AI על כל עסקה שתיעדת'] },
  { n: 'PRO', p: '99', featured: true, feat: ['כל מה שב־STARTER', 'עמוד אנליטיקת AI המלא', 'זיכרון דפוסים אישי', 'סימולטור תרחישים', 'דוח שבועי + ארכיון'] },
  { n: 'DELUXE', p: '199', feat: ['כל מה שב־PRO', 'Onyx Trainer — צ׳אט אישי', 'עמוד סטטיסטיקה מלא', 'ציון יתרון ומעקב משמעת'] },
];

// ── the page ────────────────────────────────────────────────────────────────

export default function Landing() {
  return (
    <div className="lp">

      {/* ── hero ───────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="wrap">
          <div className="lp-hero-grid">
            <div className="lp-in">
              <span className="lp-kicker lp-live"><i />נבנה לסוחרי חוזים · ES · NQ</span>
              <h1 className="lp-h1">היומן שלך כבר יודע<br />מה <em>מקלקל לך את החודש.</em></h1>
              <p className="lp-hero-sub">
                Onyx קורא את העסקאות שלך ואומר לך בעברית פשוטה מה חוזר על עצמו — איפה אתה
                באמת חזק, איפה אתה מאבד כסף, ומה כדאי לשנות מחר בבוקר. בלי ניחושים, ובלי
                מספר אחד שאי אפשר לבדוק מאיפה הוא בא.
              </p>
              <div className="lp-cta">
                <Link href="/sign-up" className="btn-lg-gold">התחל בחינם</Link>
                <a href="#features" className="btn-lg-ghost">מה יש במערכת</a>
              </div>
              <p className="lp-chips">
                <span>ללא כרטיס אשראי</span>
                <span>שיטת ICT · SMC</span>
                <span>ממשק בעברית</span>
              </p>
            </div>

            <HeroMock />
          </div>
        </div>
      </section>

      {/* ── the problem ────────────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <div className="lp-center">
            <span className="lp-kicker">{D} הבעיה</span>
            <h2 className="lp-h2">רוב הסוחרים לא נכשלים מחוסר אסטרטגיה.</h2>
            <p className="lp-lead">
              הם נכשלים כי אין להם תמונה מסודרת של מה שהם עצמם עושים. זה לא חוסר ידע — זה חוסר מראה.
            </p>
          </div>
          <div className="lp-grid lp-grid-3">
            {PROBLEMS.map(c => (
              <div className="lp-card" key={c.t}>
                <div className="lp-card-i">{D}</div>
                <h3>{c.t}</h3>
                <p>{c.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── what's inside ──────────────────────────────────── */}
      <section className="lp-sec" id="features">
        <div className="wrap">
          <div className="lp-center">
            <span className="lp-kicker">{D} מה יש במערכת</span>
            <h2 className="lp-h2">שישה חלקים. אותן עסקאות.</h2>
            <p className="lp-lead">
              לא שישה כלים נפרדים — כל חלק קורא את אותו יומן, ולכן שום שניים מהם לא יכולים
              לספר לך סיפור אחר על אותו חודש.
            </p>
          </div>
          <div className="lp-grid lp-grid-3">
            {FEATURES.map(f => (
              <div className="lp-card" key={f.t}>
                <div className="lp-card-i">{f.icon}</div>
                <h3>{f.t}</h3>
                <p>{f.b}</p>
                <span className="lp-card-tag" data-plan={f.plan}>{f.planLabel}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── the trainer ────────────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <div className="lp-split">
            <div>
              <span className="lp-kicker">{D} Onyx Trainer</span>
              <h2 className="lp-h2">שאל אותו כל דבר.<br />הוא כבר קרא את היומן שלך.</h2>
              <p className="lp-lead">
                רוב הצ׳אטים יודעים הכל על מסחר ושום דבר עליך. Onyx Trainer יודע את שניהם:
                הוא יסביר לך מה זה FVG כמו כל אחד אחר, אבל כששואלים אותו על המסחר שלך — הוא
                עונה מהעסקאות שלך, עם המספרים.
              </p>
              <p className="lp-lead" style={{ marginTop: 18 }}>
                וכשאין לו מספיק נתונים כדי לענות, הוא אומר את זה. זה נשמע קטן, אבל זה ההבדל
                בין עצה שאפשר לסמוך עליה לבין עצה שנשמעת טוב.
              </p>
              <div className="lp-cta">
                <Link href="/sign-up" className="btn-lg-gold">נסה בעצמך</Link>
              </div>
            </div>

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
          </div>
        </div>
      </section>

      {/* ── how it works ───────────────────────────────────── */}
      <section className="lp-sec">
        <div className="wrap">
          <div className="lp-center">
            <span className="lp-kicker">{D} איך זה עובד</span>
            <h2 className="lp-h2">ארבעה שלבים, ורק אחד מהם שלך.</h2>
          </div>
          <div className="lp-steps">
            {STEPS.map(s => (
              <div className="lp-step" key={s.n}>
                <b>{s.n}</b>
                <h4>{s.t}</h4>
                <p>{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── the honesty section ────────────────────────────── */}
      <section className="lp-sec" data-tint>
        <div className="wrap">
          <span className="lp-kicker">{D} איך אנחנו סופרים</span>
          <h2 className="lp-h2">מערכת שאומרת לך גם כשהיא לא יודעת.</h2>
          <p className="lp-lead">
            הכי קל בעולם להראות לסוחר מספר מרשים. הרבה יותר קשה להראות לו מספר שאפשר
            לסמוך עליו. ארבעה כללים שהמערכת בנויה סביבם:
          </p>
          <div className="lp-truth">
            {TRUTHS.map(t => (
              <div className="lp-truth-row" key={t.t}>
                <i>{D}</i>
                <div>
                  <h4>{t.t}</h4>
                  <p>{t.b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── plans ──────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="wrap">
          <div className="lp-center">
            <span className="lp-kicker">{D} מסלולים</span>
            <h2 className="lp-h2">מתחילים בחינם.</h2>
            <p className="lp-lead">היומן פתוח לכולם. משלמים רק על שכבת הניתוח, וגם אותה אפשר לבטל בכל רגע.</p>
          </div>
          <div className="lp-plans">
            {PLANS.map(p => (
              <div className="lp-plan" key={p.n} data-featured={!!p.featured}>
                <span className="lp-plan-n">{p.n}</span>
                <span className="lp-plan-p">
                  {p.p === '0' ? 'חינם' : <><span className="lp-n">{p.p}</span><small>₪ לחודש</small></>}
                </span>
                <ul>{p.feat.map(f => <li key={f}>{f}</li>)}</ul>
              </div>
            ))}
          </div>
          <div className="lp-cta" style={{ justifyContent: 'center', marginTop: 34 }}>
            <Link href="/pricing" className="btn-lg-ghost">השוואה מלאה בין המסלולים</Link>
          </div>
        </div>
      </section>

      {/* ── close ──────────────────────────────────────────── */}
      <section className="lp-close">
        <div className="wrap">
          <span className="lp-kicker">{D} להתחיל</span>
          <h2 className="lp-h2" style={{ maxWidth: '20ch', marginInline: 'auto' }}>
            העסקה הבאה שלך יכולה להיות הראשונה שנספרת.
          </h2>
          <p className="lp-lead" style={{ marginInline: 'auto' }}>
            פתח חשבון, תעד עסקה אחת, וראה מה המערכת כבר יודעת לומר עליה.
          </p>
          <div className="lp-cta" style={{ justifyContent: 'center' }}>
            <Link href="/sign-up" className="btn-lg-gold">פתיחת חשבון חינם</Link>
            <Link href="/sign-in" className="btn-lg-ghost">כבר יש לי חשבון</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
