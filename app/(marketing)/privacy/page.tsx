import type { Metadata } from 'next';
import { OWNER_CONTACT_EMAIL } from '../../lib/legal';
import '../legal/legal.css';

// ─────────────────────────────────────────────────────────────────────────────
// /privacy — linked from the footer and from /performance, and until now a 404.
//
// Written from the code rather than from a template: every processor named
// below is one this repository actually sends data to, and the deletion
// section describes what app/api/webhooks/clerk/route.ts really does. A
// privacy page that describes a different system than the one running is
// worse than none, because it is a promise nobody is keeping.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'מדיניות פרטיות · ONYX',
  description: 'איזה מידע ONYX אוסף, לאן הוא נשלח, כמה זמן הוא נשמר ואיך מוחקים אותו.',
};

const LAST_UPDATED = '1 בספטמבר 2026';

export default function PrivacyPage() {
  return (
    <div className="lg-wrap" dir="rtl">
      <div className="lg-eyebrow">ONYX</div>
      <h1 className="lg-title">מדיניות פרטיות</h1>
      <p className="lg-updated">עודכן: {LAST_UPDATED}</p>

      <p className="lg-lede">
        ONYX הוא יומן מסחר. מה שאתה כותב בו — העסקאות, ההערות, החוקים שהצבת לעצמך — הוא
        התוכן הפרטי ביותר במערכת, והדף הזה מסביר בדיוק מה קורה איתו.
      </p>

      <div className="lg-note">
        המסמך הזה מתאר את המערכת כפי שהיא בנויה בפועל. הוא <b>אינו ייעוץ משפטי</b>, ולפני
        השקה מסחרית מומלץ שעורך דין יעבור עליו — במיוחד לגבי חוק הגנת הפרטיות ותקנות
        אבטחת מידע, ולגבי GDPR אם יהיו משתמשים באיחוד האירופי.
      </div>

      <section className="lg-sec">
        <h2 className="lg-h">מה נאסף</h2>
        <ul className="lg-list">
          <li><b>פרטי חשבון</b> — כתובת דוא״ל ושם. אלה מגיעים מההרשמה, או מחשבון Google אם בחרת להתחבר דרכו.</li>
          <li><b>מה שאתה מתעד</b> — עסקאות, סטאפים, חוקים, תוכניות יומיות, רשומות במחברת וצילומי מסך שאתה מצרף.</li>
          <li><b>מה שהמערכת מייצרת עליך</b> — ניתוחים, דפוסים, תובנות יומיות וסיכומים שבועיים, שכולם נגזרים ממה שתיעדת.</li>
          <li><b>נתוני תשלום</b> — מנוהלים במלואם על ידי Stripe. <b>פרטי כרטיס האשראי שלך לא עוברים דרך ONYX ולא נשמרים אצלנו.</b></li>
          <li><b>רישומי שרת</b> — בקשות אל השירות, לצורך תפעול ואיתור תקלות.</li>
        </ul>
        <p>
          אין ב־ONYX פיקסלים פרסומיים, אין מעקב בין אתרים, ואין מכירה או השכרה של מידע לצד שלישי.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">לאן המידע נשלח</h2>
        <p>
          ONYX נשען על ספקים חיצוניים כדי לפעול. אלה כל מי שמקבל מידע, ובשביל מה:
        </p>
        <div className="lg-table-wrap">
          <table className="lg-table">
            <thead>
              <tr><th>ספק</th><th>מה מגיע אליו</th><th>לשם מה</th></tr>
            </thead>
            <tbody>
              <tr><td>Clerk</td><td>דוא״ל, שם, נתוני התחברות</td><td>ניהול החשבון וההתחברות</td></tr>
              <tr><td>Supabase</td><td>כל מה שתיעדת וכל מה שהמערכת ייצרה</td><td>בסיס הנתונים שבו הכל נשמר</td></tr>
              <tr><td>Stripe</td><td>דוא״ל ופרטי תשלום</td><td>גבייה וניהול המנוי</td></tr>
              <tr><td>Anthropic</td><td>נתוני מסחר והערות רלוונטיות לניתוח</td><td>יצירת התובנות של המאמן</td></tr>
              <tr><td>Google</td><td>קטעים מהמחברת שלך</td><td>המרה לייצוג מספרי, כדי שהמאמן יוכל לאחזר מה שכתבת בעבר</td></tr>
              <tr><td>Vercel</td><td>רישומי בקשות</td><td>אירוח השירות</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          שתי השורות שכדאי לשים לב אליהן הן <strong>Anthropic ו־Google</strong>: כדי שהמאמן
          יוכל להתייחס למה שכתבת, הטקסט שלך נשלח אליהם לעיבוד. אם אתה מעדיף שתוכן מסוים לא
          יעבור עיבוד כזה — אל תכתוב אותו במחברת.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">מה נשמר בדפדפן שלך</h2>
        <p>
          ONYX שומר עותק מקומי של הנתונים שלך בדפדפן, כדי שהמסכים ייטענו מיד וכדי שתוכל
          לעבוד גם כשהחיבור מתנתק. <strong>העותק המקומי מסומן בחשבון שהוא שייך לו</strong>,
          ועותק ששייך לחשבון אחר לא נקרא ולא נשלח. יציאה מהחשבון והתחברות בחשבון אחר
          מנקה את העותק המקומי.
        </p>
        <p>
          אלה אינם קובצי מעקב. הם לא נשלחים לצד שלישי ולא משמשים לפרסום.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">כמה זמן זה נשמר</h2>
        <p>
          כל עוד החשבון שלך קיים. יומן מסחר שווה משהו רק אם ההיסטוריה נשמרת, ולכן אין
          מחיקה אוטומטית של עסקאות ישנות.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">מחיקת החשבון</h2>
        <p>
          כשאתה מוחק את החשבון, <strong>נמחק כל מה שכתבת</strong> — לא רק פרטי החשבון:
          העסקאות, המחברת והייצוגים שנגזרו ממנה, החוקים, הסטאפים, כל התובנות שהמערכת
          ייצרה עליך, שיחות עם המאמן והדוחות. המחיקה עוברת על כל הטבלאות שנושאות את
          המזהה שלך, ואם היא נכשלת באמצע היא מנוסה שוב עד שהיא מושלמת.
        </p>
        <p>
          רשומות חיוב שכבר בוצעו נשמרות אצל Stripe בהתאם לחובות דיווח, ורישומי שרת נשמרים
          לתקופה קצרה אצל ספק האירוח.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">הזכויות שלך</h2>
        <p>
          אתה רשאי לעיין במידע שנשמר עליך, לתקן אותו, לקבל עותק שלו או לדרוש את מחיקתו.
          רוב זה זמין מתוך המערכת עצמה; לכל השאר אפשר לפנות בדוא״ל שלמטה.
        </p>
      </section>

      <section className="lg-sec">
        <h2 className="lg-h">שינויים במסמך</h2>
        <p>
          אם המדיניות תשתנה בצורה מהותית — למשל אם יתווסף ספק חדש שמקבל מידע — התאריך
          בראש הדף יתעדכן והמשתמשים יעודכנו.
        </p>
      </section>

      <p className="lg-contact">
        שאלות או בקשה בנוגע למידע שלך: <a href={`mailto:${OWNER_CONTACT_EMAIL}`}>{OWNER_CONTACT_EMAIL}</a>
      </p>
    </div>
  );
}
