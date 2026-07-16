# דוח ביקורת מערכת ואבטחה — system_ict_smc

**תאריך:** 2026-07-16 · **היקף:** כל הקוד בריפו (‎~17,800 שורות TS/TSX, 15 נתיבי API, סכימת DB, קונפיגורציה)

---

## תוצאה כללית: המערכת במצב טוב מאוד לשחרור ✅

| בדיקה | תוצאה |
|---|---|
| טסטים (`npm test`) | **231/231 עברו** (32 קבצי טסט) |
| TypeScript (`tsc --noEmit`) | נקי, 0 שגיאות |
| ESLint | נקי, 0 אזהרות |
| Build פרודקשן (`next build`) | הצליח |
| סודות בקוד / בהיסטוריית git | לא נמצאו. `.gitignore` מכסה `.env*` |
| `npm audit` | 3 moderate — טרנזיטיביים בלבד (ראו ממצא 6) |

### מה שנבדק ונמצא תקין (חוזקות המערכת)

1. **אימות (Authentication)** — כל 13 נתיבי ה-API המשתמשיים בודקים `auth()` של Clerk ומחזירים 401 בלי סשן. ה-proxy (middleware) מגן על `/dashboard` ו-`/checkout`, וכשמפתח Clerk חסר בפרודקשן הוא **נכשל-סגור** (503) במקום להישאר פתוח — עיצוב מצוין.
2. **בידוד בין משתמשים (Authorization/IDOR)** — כל שאילתת Supabase מסוננת ב-`.eq('clerk_id', userId)` מהסשן, אף פעם לא מה-body. מפתח ה-upsert הוא `(clerk_id, id)` כך שמשתמש לא יכול לדרוס רשומה של אחר עם אותו id. יש **טסטים ייעודיים לבידוד** (journal, preferences, collections, intelligence, coach chats) — כולם עוברים.
3. **Webhooks** — Stripe מאומת חתימה (`constructEvent` על raw body), Clerk מאומת svix. אף payload לא-חתום לא מעובד. שדרוג תפקיד (role) נגזר רק מ-metadata שהשרת עצמו חתם ב-checkout.
4. **ולידציית קלט** — כל כתיבה עוברת סכימת zod עם גבולות (אורכים, כמויות, enum-ים, `finite()`), כולל תקרת 1.5MB ל-collections ו-regex על `kind`. JSON שבור מחזיר 400 נקי.
5. **Rate limiting** — בכל נתיב, per-user, עם `Retry-After`. בזיכרון (מתועד כמודע-למגבלה — מספיק לשלב הזה).
6. **הודעות שגיאה** — לא דולפות שגיאות Supabase פנימיות ללקוח ("Internal server error" בלבד), עם לוגים מובנים בצד שרת + אירועי אבטחה (`auth_failed`, `rate_limited`, `validation_failed`).
7. **כותרות אבטחה** — CSP עם allowlist מדויק ל-Clerk/Stripe/Supabase, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
8. **XSS** — כל שימושי `dangerouslySetInnerHTML` הם על מילוני תרגום סטטיים בקוד (לא קלט משתמש). טקסט AI מוצג דרך React (escaped) עם `highlightSMC` שבנוי נכון.
9. **מפתח service-role** — קיים רק בקובץ שרת, לא מיובא לקומפוננטות לקוח, לא מתחיל ב-`NEXT_PUBLIC_`. RLS מופעל על כל הטבלאות ללא policies — כך שדליפת anon key לא חושפת כלום (הגנה בעומק).
10. **תשלומים** — tier לא ידוע נדחה (400); ביטול מנוי מוריד ל-free אוטומטית; `clerk_id` מוטמע גם על ה-subscription כך שאירועי חידוש/ביטול ממופים נכון.

---

## ממצאים לתיקון (מדורגים לפי חומרה)

### 1. 🟠 בינוני — נתיבי ה-AI לא אוכפים תוכנית (plan), רק התחברות
`requirePlan('deluxe')` רץ רק ב-layout של הדפים. משתמש **free** מחובר יכול לקרוא ישירות (fetch/curl) ל:
`/api/ai/chat`, `/api/ai/insights`, `/api/ai/discovery`, `/api/ai/weekly-report`, `/api/ai/pattern-insights`, `/api/ai/coach/chats*`
ולקבל את פיצ'רי ה-Deluxe בחינם — עקיפת מונטיזציה + שריפת מכסת ה-AI (Gemini/Groq) שלך.
**תיקון מוצע:** helper בסגנון `requirePlanApi('deluxe')` שמחזיר `403` (לא redirect) ולהוסיפו בראש כל נתיב AI, וכן `requirePlanApi('pro')` על journal/collections אם רלוונטי עסקית.

### 2. 🟠 בינוני — דפי ה-dashboard נאפים כ-Static כשה-build רץ בלי מפתחות Clerk
בפלט ה-build כל `/dashboard/*` מסומן `○ (Static)`. הסיבה: `getUserContext` בודק `process.env.CLERK_SECRET_KEY` **לפני** קריאה ל-`auth()`, כך שבסביבת build בלי המפתח אף API דינמי לא נקרא — ו-Next מקפיא את תוצאת ה-guard בזמן build. התוצאה של build כזה: ה-redirect ל-`/checkout` נאפה לכולם (נכשל-סגור, אין דליפת מידע — אבל האתר שבור למנויים). ב-Vercel עם env מוגדר זה הופך לדינמי, אבל האבטחה לא צריכה להיות תלויה בהרכב ה-env בזמן build.
**תיקון מוצע:** לאלץ הערכה פר-בקשה — `await connection()` (מ-`next/server`) או קריאת `cookies()` בתחילת `getUserContext()`, לפני בדיקת ה-env.

### 3. 🟡 נמוך — `/api/ai/insights` מחזיר טקסט שגיאה פנימי ללקוח
ב-catch: `debug: { threw: err.message }` — דולף פרטים פנימיים (שמות מודלים, הודעות ספקים). ההערה בקוד כבר מגדירה את `debug` כזמני. **תיקון:** להסיר את השדה או להחזיר קוד סטטוס קבוע בלבד.

### 4. 🟡 נמוך — צילומי מסך לא מאומתים בשרת כתמונה
`screenshots` מקבל כל מחרוזת עד 2MB. הלקוח מסנן `image/*`, אבל קריאת API ישירה יכולה לאחסן מחרוזת שרירותית שמוזרקת ל-`<img src>` (self-XSS בלבד — רק הבעלים רואה, ו-CSP מגביל). **תיקון (hardening):** ולידציה בסכימה: `^data:image\/(png|jpe?g|webp|gif);base64,`.

### 5. 🟡 נמוך — `success_url` של Stripe נבנה מכותרת `Origin` של הבקשה
ב-`/api/checkout`: `req.headers.get('origin') ?? NEXT_PUBLIC_APP_URL`. הכותרת בשליטת הלקוח; בתרחיש קצה זה מאפשר לכוון את החזרה מ-Stripe לדומיין זר. **תיקון:** להעדיף `NEXT_PUBLIC_APP_URL` תמיד, או לאמת את ה-origin מול allowlist.

### 6. 🟡 נמוך — עדכוני תלויות
`npm audit`: 3 moderate — כולם `postcss` ישן שמצורף בתוך `next` (XSS בזמן build בלבד, לא ב-runtime; אין fix ישיר). קיימת גרסה `next@16.2.10` (אתם על 16.2.7) ו-`@clerk/nextjs@7.5.19` (אתם על 7.4.3). **מומלץ לעדכן ולהריץ שוב את הטסטים.**

### 7. ⚪ הערות (לא חוסם שחרור)
- **CSP** כולל `'unsafe-inline' 'unsafe-eval'` ב-script-src — מתועד ומודע; מעבר ל-nonce הוא שיפור עתידי.
- **Rate limiter בזיכרון** — לא משותף בין instances של Vercel; מתועד. לשדרג ל-Upstash/Redis כשיש טראפיק אמיתי.
- `id` בסכימת הטרייד הוא `z.number()` בלי `.int()` — id עשרוני ייכשל מול עמודת bigint עם 500 במקום 400. כנ"ל `Number(id)` לא-מספרי ב-`/api/journal/[id]`.
- אין `.env.example` בריפו למרות שה-`.gitignore` מחריג אותו — כדאי להוסיף תבנית (שמות משתנים בלבד, בלי ערכים) כדי שסביבה חדשה תקום נכון: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_DELUXE`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `NEXT_PUBLIC_APP_URL`.
- `OWNER_EMAILS` בקוד — לגיטימי (חשבונות הבעלים בלבד, מבוסס אימייל מאומת של Clerk), רק לזכור שהוא מעניק Deluxe קבוע.

---

## צ'קליסט לפני עלייה לאוויר

- [ ] לוודא שכל משתני הסביבה מוגדרים ב-Vercel **גם לסביבת ה-build** (בגלל ממצא 2)
- [ ] להגדיר את ה-webhooks בדשבורדים: Stripe → `/api/webhooks/stripe`, Clerk → `/api/webhooks/clerk`, ולהעתיק את ה-signing secrets
- [ ] לתקן לפחות את ממצאים 1–3 (אכיפת plan ב-API, רינדור דינמי, הסרת debug)
- [ ] לעדכן `next` ו-`@clerk/nextjs` ולהריץ `npm test && npm run build`
- [ ] בדיקת עשן ידנית בפרודקשן: הרשמה → שדרוג בתשלום (מצב test של Stripe) → ביטול מנוי → לוודא ירידה ל-free
