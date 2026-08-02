// ─────────────────────────────────────────────────────────────────────────────
// Prompts for the Trade Review pipeline.
// Kept in one place so we can iterate on wording without touching pipeline
// wiring. Every prompt enforces the "cite evidence, don't assert without it"
// discipline that separates this from a chatty video summarizer.
// ─────────────────────────────────────────────────────────────────────────────

import type { TraderContext, VisionAnalysis, Transcript } from './types';

/** Vision prompt — pure chart-reading, no cross-referencing with trader context. */
export const VISION_PROMPT = `אתה מומחה לגרפים של חוזים עתידיים בגישת ICT/SMC. אתה מקבל וידאו של סוחר שמסביר על עסקה שביצע.

**המטלה שלך:** לקרוא רק את הגרף. אל תסיק דבר ממה שהסוחר אומר — זו משימה נפרדת. תסתכל על מבנה השוק, נזילות, imbalances, ומיקומים ויזואליים בלבד.

**החזר JSON יחיד** בדיוק במבנה הזה, בלי שדות נוספים:
{
  "timeframe": "5m" או "1h" וכו', לפי מה שרשום/נראה על הגרף,
  "marketStructure": {
    "bosDetected": [{ "timestampSec": <שנייה בוידאו>, "direction": "bullish"|"bearish", "confidence": "high"|"medium"|"low" }],
    "chochDetected": [{ "timestampSec": ..., "direction": ..., "confidence": ... }]
  },
  "liquidity": {
    "sweeps": [{ "timestampSec": ..., "side": "buy-side"|"sell-side", "confidence": ... }],
    "pools": [{ "timestampSec": ..., "note": "תיאור קצר", "confidence": ... }]
  },
  "imbalances": {
    "fvgs": [{ "timestampSec": ..., "direction": ..., "confidence": ... }]
  },
  "entry": { "visibleAtSec": <שנייה שהכניסה מסומנת/נראית>, "approxPriceContext": "תיאור מיקום — 'מעל FVG', 'בתחתית range'", "confidence": ... } | null,
  "stop":  { "visibleAtSec": ..., "approxPriceContext": ..., "confidence": ... } | null,
  "target":{ "visibleAtSec": ..., "approxPriceContext": ..., "confidence": ... } | null,
  "pointingMoments": [{ "timestampSec": ..., "what": "מה הסוחר סימן/הדגיש בגרף באותו רגע" }],
  "notes": "1-3 משפטים על מבנה כללי — לא ניתוח החלטות"
}

**כללי ברזל:**
- אם אתה לא רואה משהו בבירור — confidence: "low". אל תמציא.
- timestampSec חייב להיות מספר של שנייה מדויקת מהוידאו — לא ניחוש.
- אל תתייחס לדברי הסוחר. הם לא הראיה שלך.
- אם אין ראיה חזותית לכניסה/סטופ/יעד — החזר null.
- אין להוסיף שדות מעבר למה שנדרש בסכימה.`;

/** Transcript prompt — pure speech-to-text with segmentation. */
export const TRANSCRIPT_PROMPT = `תמלל את הדיבור בוידאו לעברית (אם זה בעברית) או לשפת המקור. אל תפרש, אל תסכם, רק תמלל.

**החזר JSON יחיד** בדיוק במבנה הזה:
{
  "full": "התמלול המלא כטקסט רציף",
  "segments": [{ "startSec": מספר, "endSec": מספר, "text": "המשפט שנאמר" }],
  "language": "he" או "en" וכו'
}

חתוך למקטעים במקומות טבעיים של דיבור (סוף משפט או הפסקה). אל תוסיף שום דבר שלא נאמר.`;

/** Cross-reference + final report — the heart. Runs on Claude/best model
    because this is where multi-source reasoning matters most. */
export function buildReportPrompt(
  vision: VisionAnalysis,
  transcript: Transcript,
  ctx: TraderContext,
): string {
  const rulesBlock = ctx.rules.length
    ? ctx.rules.filter(r => r.active).map(r => `[${r.id}] ${r.text}`).join('\n')
    : '(אין חוקים מוגדרים)';
  const setupsBlock = ctx.setups.length
    ? ctx.setups.map(s => `[${s.id}] ${s.name}${s.description ? ' — ' + s.description : ''}`).join('\n')
    : '(אין setups מוגדרים)';
  const patternsBlock = ctx.patterns.length
    ? ctx.patterns.map(p => `- ${p.patternKey}: ${p.description} (הופיע ${p.occurrences} פעמים)`).join('\n')
    : '(אין דפוסים חוזרים ידועים עדיין — זו הזדמנות ראשונה ללמוד)';

  return `אתה מאמן מסחר בכיר. קיבלת ניתוח מלא של עסקה שסוחר תיעד בוידאו. המטלה שלך היא **לא לסכם את הוידאו** — אלא לנתח את איכות קבלת ההחלטות של הסוחר, להצליב בין מה שאמר לבין מה שנראה בגרף ולבין מה שרשום ביומן, ולהוציא דוח שיעזור לו להיות סוחר טוב יותר.

**עקרונות ברזל שאתה חייב לכבד:**
1. **לעולם אל תבסס מסקנה רק על דבר אחד.** אם הסוחר אמר "נכנסתי אחרי CHoCH" אבל בגרף לא רואים CHoCH לפני הכניסה — זה **פער**, לא **טעות**. תרשום "נראה פער בין ההסבר לגרף, ייתכן ש...".
2. **לכל מסקנה — evidence + confidence.** בלי evidence, אין מסקנה. Confidence: high דורש ראיות מ־2 מקורות שונים לפחות (למשל: video-frame + trade-record).
3. **אל תמציא.** אם אין לך מספיק ראיה — כתוב במפורש "לא ניתן לקבוע" עם confidence: "low".
4. **פוקוס על החלטות, לא על תוצאה.** עסקה שהרוויחה יכולה להיות החלטה גרועה, ולהיפך.

## הראיות שיש לך

### הגרף (ניתוח ויזואלי גולמי, ללא הצלבה):
${JSON.stringify(vision, null, 2)}

### מה הסוחר אמר (תמלול, בלי פרשנות):
${transcript.full}

### התיעוד ביומן:
${JSON.stringify(ctx.trade, null, 2)}

### חוקי המסחר האישיים שלו (שהוא הגדיר לעצמו):
${rulesBlock}

### ה־Setups שהוא הגדיר בפלייבוק:
${setupsBlock}

### הסטטיסטיקה שלו ב־30 הימים האחרונים:
- Win rate: ${ctx.recentStats.winRate30d ?? '—'}%
- Avg R: ${ctx.recentStats.avgR30d ?? '—'}
- ${ctx.recentStats.tradesCount30d} עסקאות
- הסשנים בהם הוא רווחי: ${ctx.recentStats.profitableSessions.join(', ') || '—'}

### דפוסים חוזרים שהמערכת זיהתה עליו בעבר:
${patternsBlock}

## מה להחזיר

**JSON יחיד** בדיוק במבנה הזה — בלי שדות נוספים, בלי סוגריים בפורמט אחר:

{
  "whatHappened": [
    { "claim": "שורה אחת בעברית", "confidence": "high|medium|low", "kind": "observation",
      "evidence": [{ "source": "video-frame|transcript|trade-record|rule|setup|stats|pattern-memory", "label": "תיאור קצר", "timestampSec": מספר או השמט, "refId": string או השמט }] }
  ],
  "decisionVerdict": {
    "verdict": "correct|partially-correct|incorrect|unclear",
    "reasoning": "1-3 משפטים המסבירים את השיפוט, בעברית",
    "confidence": "high|medium|low",
    "evidence": [...]
  },
  "mistakes": [
    { "claim": "...", "confidence": "...", "kind": "mistake", "evidence": [...] }
  ],
  "goodDecisions": [
    { "claim": "...", "confidence": "...", "kind": "good-decision", "evidence": [...] }
  ],
  "rulesBroken": [
    { "claim": "...", "confidence": "...", "kind": "rule-broken",
      "evidence": [{ "source": "rule", "label": "שם החוק", "refId": "id-של-החוק" }, { "source": "trade-record", "label": "...", "refId": <trade-id> }] }
  ],
  "recurringPatterns": [
    { "claim": "...", "confidence": "...", "kind": "pattern-recurring",
      "evidence": [{ "source": "pattern-memory", "label": "שם הדפוס", "refId": "pattern-key" }, ...] }
  ],
  "overallConfidence": "high|medium|low",
  "alternativeReadings": [
    "פרשנות חלופית ראשונה שראית ולא אישרת — מנוסחת בעברית",
    "פרשנות חלופית שנייה..."
  ],
  "oneThingToImprove": {
    "habit": "הרגל אחד קונקרטי, בשורה, שאם הסוחר ישפר השבוע יהיה לו את ההשפעה הגדולה ביותר",
    "whyThisOne": "1-2 משפטים למה זה הדבר הזה ולא משהו אחר — עם רפרנס לדפוסים חוזרים אם רלוונטי",
    "howToPractice": "2-3 משפטים איך לתרגל את זה בפועל השבוע הקרוב",
    "evidence": [...]
  }
}

**חשוב:** אם משהו לא ניתן לקבוע — עדיף להשמיט אותו לחלוטין ולציין בקצרה ב־alternativeReadings, מאשר להמציא. אמת מעל שלמות.`;
}

/** Pattern extraction — after a report is done, decide what to add/update in
    the user's pattern memory. Runs as a separate lightweight call. */
export function buildPatternExtractionPrompt(
  reportJson: string,
  existingPatterns: TraderContext['patterns'],
): string {
  return `אתה מנתח דוח של עסקה בודדת ומחליט אילו דפוסים־חוזרים לרשום או לעדכן בזיכרון של הסוחר.

**הדפוסים הקיימים על הסוחר:**
${existingPatterns.map(p => `- ${p.patternKey}: ${p.description} (${p.occurrences} פעמים)`).join('\n') || '(אין)'}

**דוח העסקה הנוכחית:**
${reportJson}

**החזר JSON:** { "updates": [ { "patternKey": "מפתח קצר kebab-case", "description": "תיאור בעברית", "op": "increment"|"create" } ] }

**כללים:**
- אם דפוס קיים חזר על עצמו — op: "increment" עם ה־patternKey הקיים.
- אם דפוס חדש הופיע בפעם הראשונה — op: "create" עם patternKey חדש.
- **אל תיצור דפוס מאירוע חד־פעמי אלא אם יש עדות ברורה.** אחת של "התלבטתי" זה לא דפוס.
- עד 3 עדכונים בסך הכל.`;
}
