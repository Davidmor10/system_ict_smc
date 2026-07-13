// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight Question Router — a fast, deterministic ($0, no LLM call, no
// latency) classifier that decides which rule blocks a question actually needs.
// The bloated "inject every rule every time" prompt caused Lost-in-the-Middle;
// this lets buildChatPrompt assemble only the relevant modules. Multi-label:
// one question can be both SMC_TECHNICAL and MACRO_NEWS.
//
// Hebrew has no reliable \b word boundary in JS regex, so matching is substring
// for words/Hebrew and boundary-guarded for short English acronyms (so "fed"
// doesn't fire on "defined", "oil" not on "boil").
// ─────────────────────────────────────────────────────────────────────────────

export type RouteCategory = 'SMC_TECHNICAL' | 'MACRO_NEWS' | 'TRADER_DISCRETION' | 'GENERAL_PSYCHOLOGY';

const SMC_KEYS = [
  'fvg', 'ifvg', 'smt', 'bos', 'choch', 'mss', 'cisd', 'ict', 'smc', 'ob',
  'order block', 'order flow', 'breaker', 'mitigation', 'fair value', 'imbalance',
  'liquidity', 'sweep', 'displacement', 'premium', 'discount', 'equilibrium',
  'judas', 'killzone', 'dealing range', 'market structure', 'divergence',
  'ליקווידיות', 'נזילות', 'סוויפ', 'גירוף', 'פער', 'אי-איזון', 'אי איזון',
  'מבנה', 'שבירת מבנה', 'סטאפ', 'אישור', 'דיברגנס', 'דיספלייסמנט', 'פרימיום', 'דיסקאונט',
];

const MACRO_KEYS = [
  'nfp', 'cpi', 'ppi', 'fomc', 'fed', 'federal reserve', 'central bank',
  'interest rate', 'rate hike', 'rate cut', 'gdp', 'yields', 'bond', 'dxy',
  'dollar', 'vix', 'oil', 'energy', 'geopolit', 'war', 'tariff', 'recession',
  'news', 'report', 'calendar', 'today', 'this week',
  'ריבית', 'אינפלציה', 'תשואות', 'אג"ח', 'דולר', 'נפט', 'אנרגיה', 'גאופוליט',
  'מלחמה', 'מכס', 'מיתון', 'חדשות', 'דוח', 'דוחות', 'לוח', 'בנק מרכזי', 'היום', 'השבוע',
];

const DISCRETION_KEYS = [
  'break a rule', 'break my rule', 'breaking a rule', 'bend the rule', 'bend a rule',
  'intuition', 'gut', 'discretion', 'deviate', 'when to break', 'should i',
  'my edge', 'my own edge', 'my rules', 'flexible', 'flexibility',
  'לשבור כלל', 'לשבור חוק', 'לשבור את הכלל', 'לחרוג', 'לסטות', 'שיקול דעת',
  'אינטואיציה', 'תחושת בטן', 'תחושת הבטן', 'כדאי לי', 'היתרון שלי', 'החוקים שלי',
  'מתי לשבור', 'גמישות', 'להרגיש',
];

const PSYCH_KEYS = [
  'psycholog', 'emotion', 'fomo', 'fear', 'greed', 'stress', 'discipline',
  'tilt', 'revenge', 'patience', 'confidence', 'after a loss', 'overtrad',
  'פסיכולוג', 'רגש', 'רגשות', 'פחד', 'חמדנות', 'לחץ', 'משמעת', 'נקמנות', 'נקמה',
  'סבלנות', 'ביטחון עצמי', 'אחרי הפסד', 'אחרי הפסדים', 'טילט', 'ריגוש',
];

function matches(haystack: string, key: string): boolean {
  // Boundary-guard short pure-ASCII acronyms; substring for the rest (incl. Hebrew).
  if (/^[a-z]{2,4}$/.test(key)) return new RegExp(`(?:^|[^a-z])${key}(?:[^a-z]|$)`).test(haystack);
  return haystack.includes(key);
}

function anyMatch(haystack: string, keys: string[]): boolean {
  return keys.some(k => matches(haystack, k));
}

/** Classify a question into zero or more rule categories. Deterministic. */
export function classifyQuestion(question: string): RouteCategory[] {
  const q = question.toLowerCase();
  const cats: RouteCategory[] = [];
  if (anyMatch(q, SMC_KEYS)) cats.push('SMC_TECHNICAL');
  if (anyMatch(q, MACRO_KEYS)) cats.push('MACRO_NEWS');
  if (anyMatch(q, DISCRETION_KEYS)) cats.push('TRADER_DISCRETION');
  if (anyMatch(q, PSYCH_KEYS)) cats.push('GENERAL_PSYCHOLOGY');
  return cats;
}
