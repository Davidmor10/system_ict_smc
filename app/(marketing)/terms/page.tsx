import type { Metadata } from 'next';
import { OWNER_CONTACT_EMAIL, OWNER_LEGAL_NAME } from '../../lib/legal';
import '../legal/legal.css';

// ─────────────────────────────────────────────────────────────────────────────
// /terms — linked from the footer and from /performance, and until now a 404.
//
// Every commercial statement here is taken from /pricing rather than invented:
// three monthly plans at 49/99/199, no free trial, cancel any time, pro-rata
// on an upgrade, access to the end of the paid month. Terms that contradict
// the page that took the money are worse than no terms at all.
//
// The section that matters most to this product is "לא ייעוץ השקעות". ONYX
// analyses a trader's own history and says what it found; it does not tell
// anyone what to trade, and the document has to say so in those words.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'תקנון · ONYX',
  description: 'תנאי השימוש ב־ONYX — המסלולים, החיוב, הביטול, ומה השירות אינו.',
};

const LAST_UPDATED = '1 בספטמבר 2026';

export default function TermsPage() {
  return (
    <div className="lg-wrap" dir="rtl">
      <div className="lg-eyebrow">ONYX</div>
      <h1 className="lg-title">תקנון ותנאי שימוש</h1>
      <p className="lg-updated">עודכן: {LAST_UPDATED}</p>

      <p className="lg-lede">
        התנאים שלפיהם {OWNER_LEGAL_NAME} מעמיד את השירות לרשותך. שימוש בשירות מהווה
        הסכמה להם.
      </p>

      <div className="lg-note">
        המסמך הזה מתאר את השירות כפי שהוא פועל בפועל. הוא <b>אינו ייעוץ משפטי</b>, ולפני
        השקה מסחרית מומלץ שעורך דין יעבור עליו — בייחוד על סעיפי החיוב והביטול מול חוק
        הגנת הצרכן.
      </div>

      <section className="lg-sec">
        <h2 className="lg-h">מה השירות עושה</h2>
        <p>
          ONYX הוא יומן מסחר וכלי ניתוח. אתה מתעד בו את העסקאות שלך, מגדיר את הסטאפים
          והחוקים שלך במילים שלך, והמערכת מנתחת <strong>את ההיסטוריה שתיעדת</strong> ומציגה
          מה היא מצאה בה.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">מה השירות אינו — ייעוץ השקעות</h2>
        <p>
          <strong>ONYX אינו ייעוץ השקעות, אינו שיווק השקעות ואינו המלצה לבצע עסקה כלשהי.</strong>{' '}
          אין בו ייעוץ מותאם אישית כמשמעותו בחוק הסדרת העיסוק בייעוץ השקעות, ומפעיל
          השירות אינו בעל רישיון ייעוץ.
        </p>
        <p>
          כל מה שהמערכת מציגה הוא תיאור סטטיסטי של מה שאתה עצמך תיעדת בעבר. ביצועי עבר
          אינם מעידים על ביצועי עתיד, וממצא שנמצא בהיסטוריה שלך אינו הבטחה שהוא יחזור.
        </p>
        <p>
          <strong>מסחר בחוזים עתידיים ובמכשירים ממונפים כרוך בסיכון גבוה ועלול להוביל
          לאובדן מלוא הכספים ואף יותר.</strong> ההחלטות שלך הן שלך בלבד, והאחריות לתוצאותיהן
          היא שלך בלבד.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">דיוק הנתונים</h2>
        <p>
          הניתוח מבוסס על מה שהזנת. תיעוד חלקי או שגוי יפיק ניתוח שגוי, והמערכת אינה
          מאמתת את הנתונים מול הברוקר שלך.
        </p>
        <p>
          לוח האירועים הכלכליים מוצג לנוחותך ומגיע ממקור חיצוני. ייתכנו בו אי־דיוקים,
          שינויים ועיכובים.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">חשבון</h2>
        <ul className="lg-list">
          <li>החשבון אישי. אין לשתף אותו ואין להעביר אותו לאחר.</li>
          <li>אתה אחראי לשמירת פרטי הגישה שלך.</li>
          <li>השימוש מותר מגיל 18 ומעלה.</li>
          <li>אין לגרד את השירות, להנדס אותו לאחור או להעמיס עליו באופן אוטומטי.</li>
        </ul>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">מסלולים וחיוב</h2>
        <ul className="lg-list">
          <li><b>STARTER — ₪49 לחודש.</b> דשבורד, יומן, מחברת, סטאפים וחוקים.</li>
          <li><b>PRO — ₪99 לחודש.</b> כל מה שב־STARTER, בתוספת שכבת הניתוח המלאה.</li>
          <li><b>DELUXE — ₪199 לחודש.</b> כל מה שב־PRO, בתוספת המאמן האישי.</li>
        </ul>
        <p>
          כל המסלולים בתשלום, <strong>אין תקופת ניסיון חינם</strong>, והחיוב חודשי ומתחדש
          מאליו עד לביטול. התשלום מבוצע דרך Stripe. המחירים כוללים מע״מ כדין, וניתן לעדכן
          אותם בהודעה מראש שתחול על מחזור החיוב הבא.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">ביטול</h2>
        <p>
          <strong>אפשר לבטל בכל רגע.</strong> הביטול עוצר את החידוש הבא, והגישה נשמרת עד
          תום החודש ששולם. שדרוג בין מסלולים באמצע חודש מחושב בפרו־רייטה.
        </p>
        <p>
          אין החזר על חלק יחסי של חודש שכבר שולם, למעט במקרים שבהם הדין מחייב אחרת.
          זכויות הביטול הקבועות בחוק הגנת הצרכן חלות ממילא ואינן נגרעות מסעיף זה.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">התוכן שלך</h2>
        <p>
          מה שאתה כותב נשאר שלך. אנחנו לא מוכרים אותו, לא משתמשים בו כדי לאמן מודלים
          ולא מציגים אותו למשתמשים אחרים. ההרשאה היחידה שאנחנו מקבלים היא זו הדרושה
          כדי להפעיל את השירות עבורך — לשמור, להציג ולנתח את מה שהזנת. הפירוט המלא נמצא
          ב<a href="/privacy">מדיניות הפרטיות</a>.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">זמינות</h2>
        <p>
          אנחנו משתדלים שהשירות יהיה זמין ברציפות, אך איננו מתחייבים לזמינות רצופה.
          ייתכנו הפסקות לתחזוקה, תקלות אצל ספקי תשתית, ושינויים או הסרה של יכולות. שינוי
          מהותי יבוא בהודעה מראש.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">אחריות</h2>
        <p>
          השירות ניתן כמות שהוא. במידה המרבית שהדין מתיר, לא נישא באחריות להפסדי מסחר,
          לאובדן רווח או לנזק עקיף כלשהו, ובכל מקרה אחריותנו הכוללת לא תעלה על הסכום
          ששילמת בשלושת החודשים שקדמו לאירוע.
        </p>
        <p>
          אין באמור כדי לגרוע מאחריות שהדין אינו מאפשר להגבילה.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">סיום</h2>
        <p>
          אתה רשאי למחוק את החשבון בכל עת; מה שנמחק מתואר ב<a href="/privacy">מדיניות הפרטיות</a>.
          אנחנו רשאים להשעות חשבון שמפר את התנאים, ובמקרה כזה יוחזר החלק היחסי ששולם
          ולא נוצל.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">דין וסמכות</h2>
        <p>
          על תנאים אלה חלים דיני מדינת ישראל, וסמכות השיפוט הבלעדית נתונה לבתי המשפט
          המוסמכים במחוז תל אביב.
        </p>
      </section>

      <p className="lg-contact">
        שאלות: <a href={`mailto:${OWNER_CONTACT_EMAIL}`}>{OWNER_CONTACT_EMAIL}</a>
      </p>
    </div>
  );
}
