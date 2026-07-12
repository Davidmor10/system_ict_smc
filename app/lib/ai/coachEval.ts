// ─────────────────────────────────────────────────────────────────────────────
// Coach Evaluation Suite — a fixed set of questions with the concepts a correct
// answer must express and the phrases it must never contain. scoreAnswer() is a
// pure, deterministic gate: concept coverage (by synonym GROUP, not a single
// keyword), forbidden-phrase detection, and a repetition check. It intentionally
// does NOT judge "natural Hebrew" / "professional tone" — those need a human or
// an LLM judge; this gate catches the concrete regressions (shallow definitions,
// banned filler, repeated text) cheaply and offline.
// ─────────────────────────────────────────────────────────────────────────────

export interface EvalCase {
  id: string;
  category: 'ict' | 'macro' | 'geopolitics' | 'strategy' | 'user';
  question: string;
  /** Each inner array is a synonym group — a good answer must express EVERY
      group (any one synonym in a group satisfies it). */
  expectedConcepts: string[][];
  /** Phrases the answer must never contain (the old shallow/wrong habits). */
  forbidden: string[];
}

export const COACH_EVAL_CASES: EvalCase[] = [
  {
    id: 'nfp-nasdaq', category: 'macro',
    question: 'למה NFP חזק יכול להפיל את הנאסד"ק?',
    expectedConcepts: [['ריבית', 'rate'], ['תשואות', 'אג"ח', 'yields', 'bond'], ['צמיחה', 'רגיש', 'growth']],
    forbidden: ['כלכלה חזקה תמיד', 'תמיד טוב למניות'],
  },
  {
    id: 'bos-choch', category: 'ict',
    question: 'מה ההבדל בין BOS ל-CHoCH?',
    expectedConcepts: [['מבנה', 'structure'], ['המשך', 'continuation'], ['נגד המבנה', 'נגד המגמה', 'שינוי מבני', 'first break']],
    forbidden: ['רק האטה', 'האטה במהירות', 'ירידת volume', 'שינוי בקצב', 'שינוי במהירות'],
  },
  {
    id: 'fvg-quality', category: 'ict',
    question: 'מתי FVG נחשב איכותי?',
    expectedConcepts: [['הקשר', 'מבנה', 'context', 'structure'], ['displacement', 'תנועה חדה', 'sweep', 'ליקווידיות', 'נזילות'], ['bias', 'טיימפריים', 'premium', 'discount']],
    forbidden: ['רק volume', 'לפי volume', 'נפח בלבד', 'רק לפי נפח'],
  },
  {
    id: 'edge', category: 'strategy',
    question: 'איך יודעים אם Edge אמיתי?',
    expectedConcepts: [['תוחלת', 'expectancy'], ['מדגם', 'sample'], ['profit factor', 'RR', 'reward', 'יחס רווח']],
    forbidden: ['סטאפ אחד', 'עסקה מוצלחת', 'שבוע טוב'],
  },
  {
    id: 'geopolitics', category: 'geopolitics',
    question: 'למה אירוע גיאופוליטי לפעמים לא מזיז את השוק?',
    expectedConcepts: [['ציפיות', 'expectations'], ['מתומחר', 'כבר ציפה', 'priced'], ['נפט', 'אנרגיה', 'אינפלציה', 'ריבית']],
    forbidden: ['השוק מורכב', 'מדינה גדולה'],
  },
  {
    id: 'rr-personal', category: 'user',
    question: 'לפי הנתונים שלי, למה ה-RR ירד?',
    expectedConcepts: [],
    forbidden: ['תנסה להרוויח יותר', 'תפסיד פחות', 'תרוויח יותר ותפסיד פחות'],
  },
  {
    id: 'unknown-user', category: 'user',
    question: 'מה אתה עדיין לא יודע עליי?',
    expectedConcepts: [['יציאות', 'סטופ', 'תוכנית', 'לחץ', 'הפסד']],
    forbidden: ['אתה עדיין לומד', 'אתה עדיין בתהליך', 'אל תוותר'],
  },
  {
    id: 'overtrading', category: 'user',
    question: 'האם אני לוקח יותר מדי עסקאות?',
    expectedConcepts: [],
    forbidden: ['צריך לבדוק את הנתונים'],
  },
  {
    id: 'corr-causation', category: 'strategy',
    question: 'מה ההבדל בין מתאם לסיבתיות?',
    expectedConcepts: [['מתאם', 'קשר', 'correlation'], ['סיבתיות', 'סיבה', 'causation']],
    forbidden: [],
  },
  {
    id: 'strategy-works', category: 'strategy',
    question: 'איך יודעים אם אסטרטגיה עובדת?',
    expectedConcepts: [['מדגם', 'sample'], ['תוחלת', 'expectancy', 'profit factor', 'RR']],
    forbidden: [],
  },
];

export interface EvalResult {
  ok: boolean;
  /** Concept groups the answer failed to express. */
  missingConcepts: string[][];
  /** Forbidden phrases the answer contained. */
  forbiddenHits: string[];
  /** True when the answer repeats a sentence or a 4-word phrase too often. */
  repetitive: boolean;
}

/** Flags padding/repetition: a duplicated sentence, or any 4-word phrase used
    3+ times. Pure. */
export function hasHeavyRepetition(text: string): boolean {
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 12);
  const seen = new Set<string>();
  for (const s of sentences) { if (seen.has(s)) return true; seen.add(s); }
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const counts = new Map<string, number>();
  for (let i = 0; i + 4 <= words.length; i++) {
    const g = words.slice(i, i + 4).join(' ');
    const n = (counts.get(g) ?? 0) + 1;
    if (n >= 3) return true;
    counts.set(g, n);
  }
  return false;
}

/** Deterministic pass/fail gate for one answer against its case. */
export function scoreAnswer(answer: string, c: EvalCase): EvalResult {
  const a = answer.toLowerCase();
  const missingConcepts = c.expectedConcepts.filter(group => !group.some(s => a.includes(s.toLowerCase())));
  const forbiddenHits = c.forbidden.filter(p => answer.includes(p));
  const repetitive = hasHeavyRepetition(answer);
  return { ok: missingConcepts.length === 0 && forbiddenHits.length === 0 && !repetitive, missingConcepts, forbiddenHits, repetitive };
}
