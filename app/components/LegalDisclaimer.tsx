const DISCLAIMER =
  'הבהרה משפטית וסרת אחריות (Risk Disclaimer): המידע והכלים המוצגים במערכת ONYX TRADING נועדו למטרות לימודיות, מחקריות ואינפורמטיביות בלבד, ואינם מהווים בשום אופן ייעוץ השקעות, ייעוץ פיננסי, עסקי, או המלצה/שידול לביצוע פעולות קנייה ומכירה בניירות ערך, חוזים עתידיים או כל מכשיר פיננסי אחר. המסחר בשוק ההון כרוך בסיכון כלכלי גבוה ועלול להוביל להפסד מלא או חלקי של כספך. החברה, מפתחיה או בעליה אינם נושאים באחריות ישירה או עקיפה לכל הפסד, נזק או אובדן כספי שייגרם כתוצאה משימוש במערכת, באינדיקטורים או בנתונים המוצגים בה. השימוש במערכת הוא על אחריותו הבלעדית של המשתמש בלבד.';

export default function LegalDisclaimer() {
  return (
    <footer className="border-t border-[#1c1c1e] bg-[#000000] px-6 py-10" dir="rtl">
      <div className="max-w-4xl mx-auto">
        <h4 className="text-sm font-bold font-mono text-[#d4af37] uppercase tracking-[0.2em] mb-3">
          הבהרה משפטית · Risk Disclaimer
        </h4>
        <p className="text-sm font-medium text-white/45 leading-7 tracking-wide">
          {DISCLAIMER}
        </p>
      </div>
    </footer>
  );
}
