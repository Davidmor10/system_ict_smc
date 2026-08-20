'use client';

import Link from 'next/link';
import { useState } from 'react';
import './pricing.css';

// ─────────────────────────────────────────────────────────────────────────────
// /pricing — three paid plans. There is no free tier: not a card, not a table
// column, not an FAQ entry, not a "start free" CTA anywhere on the page.
//
// Hebrew only, like the rest of the marketing layer — LangProvider is typed
// `Lang = 'he'` and offers no toggle, so the English half of the old copy was
// unreachable text nobody could ever read.
// ─────────────────────────────────────────────────────────────────────────────

/** The shekel sign has no glyph in Geist Mono and renders as a tofu box. Every
 *  ₪ on this page — cards, table headers, FAQ answers — goes through this, so
 *  the digits stay mono and tabular while the currency mark borrows Geist. */
function Nis() {
  return <span className="pr-nis">₪</span>;
}

// ── Plans ────────────────────────────────────────────────────────────────────

interface Feature { text: string; on: boolean }
interface Plan {
  key: string;
  tag: string;
  name: string;
  amount: string;
  featured: boolean;
  features: Feature[];
  cta: string;
  href: string;
}

/** RTL order: STARTER · PRO · DELUXE, so PRO lands in the middle and reads as
 *  the considered centre rather than the top price. */
const PLANS: Plan[] = [
  {
    key: 'starter', tag: 'הצעד הראשון', name: 'STARTER', amount: '49', featured: false,
    features: [
      { text: 'דאשבורד, יומן מסחר, מחברת, סטאפים וחוקים — גישה מלאה', on: true },
      { text: 'פאנל AI Insight נפתח ביומן — תובנה לכל עסקה', on: true },
      { text: 'ללא עמוד ה-AI Analytics', on: false },
      { text: 'ללא המאמן האישי', on: false },
    ],
    cta: 'הצטרף ל-STARTER', href: '/checkout?plan=starter',
  },
  {
    key: 'pro', tag: 'שכבת הבינה המלאה', name: 'PRO', amount: '99', featured: true,
    features: [
      { text: 'תובנת AI על כל עסקה שתיעדת — פסקה אישית שהמערכת מוציאה מיד אחרי שסגרת את הטרייד', on: true },
      { text: 'עמוד ה-AI Analytics המלא נפרס מולך: אחוזי הצלחה חתוכים לפי סשן, סטאפ, בייאס ויום בשבוע — יודעים מה עובד לך ומה שורף', on: true },
      { text: 'זיכרון דפוסים אישי — המערכת לומדת דפוסים אמיתיים על המסחר שלך שבוע אחר שבוע (לא סטטיסטיקות של "סוחרים באופן כללי")', on: true },
      { text: 'סימולטור תרחישים + דוח שבועי אישי + ארכיון היסטורי מלא — "מה היה קורה אם רק סחרתי בסשן NY?" נענה על עסקאות אמת', on: true },
    ],
    cta: 'הצטרף ל-PRO', href: '/checkout?plan=pro',
  },
  {
    key: 'deluxe', tag: 'ללא תקרות', name: 'DELUXE', amount: '199', featured: false,
    features: [
      { text: 'כל שכבת ה-AI של PRO — במלואה', on: true },
      { text: 'המאמן האישי נפתח — שיחה שקוראת את היומן שלך', on: true },
      { text: 'היסטוריית שיחות עם המאמן, נשמרת פר סוחר', on: true },
      { text: 'עדיפות בעדכונים ובפיצ׳רים חדשים', on: true },
    ],
    cta: 'הצטרף ל-DELUXE', href: '/checkout?plan=deluxe',
  },
];

const FINE = 'ללא ניסיון חינם · ביטול בכל עת · חיוב חודשי';

// ── Comparison table ─────────────────────────────────────────────────────────

type Cell = 'yes' | 'no' | string;
interface Row { feat: string; s: Cell; p: Cell; d: Cell }

const ROWS: Row[] = [
  { feat: 'דאשבורד, יומן מסחר, סטאפים וחוקים',              s: 'yes', p: 'yes', d: 'yes' },
  { feat: 'מחברת סוחר וסנכרון מכשירים',                      s: 'yes', p: 'yes', d: 'yes' },
  { feat: 'AI Insight ביומן (תובנה לכל עסקה)',               s: 'yes', p: 'yes', d: 'yes' },
  { feat: 'עמוד AI Analytics המלא',                          s: 'no',  p: 'yes', d: 'yes' },
  { feat: 'זיהוי דפוסים + סימולטור + דוח שבועי + ארכיון',    s: 'no',  p: 'yes', d: 'yes' },
  { feat: 'המאמן האישי (שיחה שקוראת את היומן)',              s: 'no',  p: 'no',  d: 'yes' },
  { feat: 'תמיכה',                                            s: 'בסיסית', p: 'מהירה', d: 'מועדפת · VIP' },
];

function Mark({ v }: { v: Cell }) {
  if (v === 'yes') return <span className="pr-yes">✓</span>;
  if (v === 'no') return <span className="pr-no">✕</span>;
  return <span className="pr-txt">{v}</span>;
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'מה ההבדל בין STARTER ל-PRO?',
    a: <>STARTER (49 <Nis />) פותח את פאנל ה-AI Insight ביומן — פסקה קצרה על כל עסקה שתיעדת. PRO (99 <Nis />) פותח את כל שכבת הבינה של המערכת: את התובנה על כל עסקה, ובנוסף את עמוד ה-AI Analytics המלא — זיכרון דפוסים אישי שהמערכת בונה עליך שבוע אחר שבוע, סימולטור תרחישים (&quot;מה היה קורה אם רק סחרתי בסשן NY?&quot; — נענה על עסקאות אמת), ודוח שבועי אישי עם ארכיון היסטורי מלא. ההפרש בין המסלולים הוא 50 <Nis /> בחודש. מה שנפתח בהפרש הזה הוא לא עוד פיצ׳ר בודד אלא שכבה שלמה של יכולות — ורוב הסוחרים מוצאים שהיא זו שמייצרת את היתרון.</>,
  },
  {
    q: 'ואז מתי בכלל לעבור ל-DELUXE?',
    a: <>DELUXE (199 <Nis />) מוסיף מעל ה-PRO את המאמן האישי — שיחה שקוראת את היומן שלך בזמן אמת ועונה על שאלות מסחר בהתבסס על הנתונים והמושגים האמיתיים שלך. אם אתה מרגיש שאתה צריך שותף לחשיבה שיודע את היומן שלך על בוריו — DELUXE הוא הבחירה. אחרת PRO מספיק בהחלט.</>,
  },
  {
    q: 'יש התחייבות? אפשר לשדרג או לבטל?',
    a: <>אין התחייבות. כל המסלולים בתשלום חודשי, ניתנים לביטול בכל רגע, ומשדרגים בין המסלולים באמצע חודש בפרו־רייטה. אם ביטלת — תישאר עם הגישה עד סוף החודש ששולם.</>,
  },
  {
    q: 'מה כלול בכל המסלולים?',
    a: <>כל מסלול פותח את הדאשבורד, יומן המסחר, המחברת, הסטאפים והחוקים במלואם. ההבדל בין המסלולים הוא שכבת ה-AI: תובנה אישית ליומן ב-STARTER, אנליטיקס מלא ב-PRO, ומאמן אישי ב-DELUXE. אין מסלול חינמי — הגישה נפתחת עם המנוי.</>,
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  // Exclusive accordion, first item open on load; clicking an open item closes it.
  const [open, setOpen] = useState(0);

  return (
    <div className="pr">

      <section className="pr-hero">
        <div className="pr-hero-wash" aria-hidden />
        <div className="pr-hero-grid" aria-hidden />
        <div className="pr-hero-in">
          <span className="pr-hero-kicker">◈ מסלולי מנוי</span>
          <h1 className="pr-h1">
            בחר את הרמה<br />שמתאימה <span>לקצב שלך.</span>
          </h1>
          <p className="pr-lead">
            כל המסלולים בנויים על אותו לב מערכת, וכולם פותחים את הדאשבורד, היומן, המחברת, הסטאפים
            והחוקים במלואם. ההבדל הוא שכבת הבינה — כמה רחוק אתה לוקח את הניתוח. תמיד אפשר לשדרג,
            ואין התחייבות.
          </p>
          <span className="pr-fine-hero">כל המסלולים בתשלום · ללא ניסיון חינם · ביטול בכל עת</span>
        </div>
      </section>

      <section id="plans" className="pr-plans">
        <div className="pr-grid">
          {PLANS.map(plan => (
            <div className="pr-card-wrap" key={plan.key}>
              {plan.featured && (
                <div className="pr-pop"><span>הכי פופולרי</span></div>
              )}
              <div className="pr-card" data-featured={plan.featured}>
                <span className="pr-tag">{plan.tag}</span>
                <p className="pr-name" dir="ltr">{plan.name}</p>

                {/* dir=ltr with the unit first: in an RTL page that puts the
                    number on the right, so it is read first — "49 ₪ / חודש". */}
                <div className="pr-price" dir="ltr">
                  <span className="pr-price-unit"><Nis /> / חודש</span>
                  <span className="pr-price-amt">{plan.amount}</span>
                </div>

                <div className="pr-feats">
                  {plan.features.map((f, i) => (
                    <div className="pr-feat" data-on={f.on} key={i}>
                      <span className="pr-feat-i">{f.on ? '✓' : '✕'}</span>
                      <span className="pr-feat-t">{f.text}</span>
                    </div>
                  ))}
                </div>

                <Link href={plan.href} className="pr-cta" data-gold={plan.featured}>{plan.cta}</Link>
                <p className="pr-fine">{FINE}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="compare" className="pr-compare">
        <div className="pr-wrap">
          <div className="pr-sec-head">
            <span className="pr-kicker">◈ השוואה מלאה</span>
            <h2 className="pr-h2">השוואה מלאה</h2>
            <p className="pr-sub">בדיוק מה מקבלים בכל מסלול</p>
          </div>

          <div className="pr-table-frame">
            <table className="pr-table">
              <thead>
                <tr>
                  <th>פיצ׳ר</th>
                  <th>
                    STARTER<br />
                    <span className="pr-th-price">49 <Nis /></span>
                  </th>
                  <th data-featured="true">
                    PRO<br />
                    <span className="pr-th-price" data-gold="true">99 <Nis /></span><br />
                    <span className="pr-th-note">שכבת הבינה המלאה</span>
                  </th>
                  <th>
                    DELUXE<br />
                    <span className="pr-th-price">199 <Nis /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <tr key={i}>
                    <td>{r.feat}</td>
                    <td><Mark v={r.s} /></td>
                    <td data-featured="true"><Mark v={r.p} /></td>
                    <td><Mark v={r.d} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="faq" className="pr-faq">
        <div className="pr-wrap">
          <div className="pr-sec-head">
            <span className="pr-kicker">◈ שאלות נפוצות</span>
            <h2 className="pr-h2">שאלות נפוצות</h2>
            <p className="pr-sub">מה שכדאי לדעת לפני שמצטרפים</p>
          </div>

          <div className="pr-faq-list">
            {FAQ.map((item, i) => {
              const isOpen = open === i;
              return (
                <div className="pr-faq-item" data-open={isOpen} key={i}>
                  <button
                    type="button"
                    className="pr-faq-q"
                    aria-expanded={isOpen}
                    aria-controls={`pr-faq-a-${i}`}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                  >
                    <span className="pr-faq-q-t">{item.q}</span>
                    <span className="pr-faq-sign" aria-hidden>+</span>
                  </button>
                  {isOpen && (
                    <div className="pr-faq-a" id={`pr-faq-a-${i}`}>
                      <p>{item.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* One quiet invitation, not two buttons. The decision belongs to the
          cards above; this only points back at them. */}
      <section className="pr-close">
        <div className="pr-close-wash" aria-hidden />
        <div className="pr-close-in">
          <span className="pr-close-glyph">◈</span>
          <h2 className="pr-close-h2">
            תפסיק לנחש.<br />תתחיל לסחור לפי ה<span>מודל.</span>
          </h2>
          <p className="pr-close-p">
            הצטרף עכשיו, והמסוף נפתח לך מיד. הרוב מתחיל ב-PRO — היחס ערך/מחיר הכי טוב בסולם.
            תמיד אפשר לשדרג ל-DELUXE (או להתחיל קטן עם STARTER) בהמשך.
          </p>
          <div className="pr-close-block">
            <a href="#plans" className="pr-close-a">
              <span className="pr-close-a-t">לבחור מסלול ולהיכנס</span>
              <span className="pr-close-a-arrow" aria-hidden>←</span>
            </a>
            <span className="pr-close-fine">הגישה נפתחת מיד עם סיום התשלום · אפשר לבטל בכל רגע</span>
          </div>
        </div>
      </section>

      <div className="pr-disclaimer">
        <span>מסחר בחוזים עתידיים כולל סיכון מהותי · הכלים לשימוש לימודי ומחקרי בלבד · האחריות על השימוש היא על המשתמש</span>
      </div>

    </div>
  );
}
