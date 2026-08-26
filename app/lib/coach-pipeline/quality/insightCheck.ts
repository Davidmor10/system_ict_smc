// ─────────────────────────────────────────────────────────────────────────────
// Output checks — the prompt rules, made checkable.
//
// Pure. No AI, no network, no async.
//
// WHY A CHECKER AND NOT JUST A PROMPT
//
// Every rule in the system prompt is a request. A model honours most of them
// most of the time, and the ones it drops are not random: under pressure to
// sound useful it reaches for the generic coaching sentence, and when the
// evidence is thin it reaches for a cause. Those are exactly the two failures
// that end this product — the first makes it worthless, the second makes it
// untrustworthy — and both read perfectly well, which is why neither would
// ever be caught by a human skimming the output.
//
// So the rules that matter are also assertions. They run on every generated
// insight, they are recorded on the row, and the hard ones get one corrective
// retry before publication.
//
// WHAT IS DELIBERATELY NOT CHECKED
//
// Tone, warmth, whether the note is any good. Those are real and this cannot
// measure them. Everything here is a specific, mechanically detectable claim
// the output is not allowed to make.
//
// FALSE POSITIVES ARE THE RISK
//
// A checker that fires on a good insight costs a retry and, if it fires
// twice, a worse note than the one it rejected. So every pattern is narrow and
// literal: phrases a coach would only write when they had nothing to say,
// never a single common word. `hard` is reserved for claims that are wrong
// rather than clumsy.
// ─────────────────────────────────────────────────────────────────────────────

import type { BehaviorBlock } from '../pipelines/analyzeBehavior';
import { isMostlyLatin, hasLatinIdentifier } from '../../ai/language';

export type Severity = 'hard' | 'soft';

export interface Violation {
  rule:     string;
  severity: Severity;
  /** What was found, verbatim. A violation you cannot see in the text is
   *  indistinguishable from a bug in the checker. */
  detail:   string;
}

/** Sentences a coach writes when they have nothing specific to say.
 *
 *  All of them are advice with no referent: true of every trader on every day,
 *  which is what makes them worthless here. The trader can get "be
 *  disciplined" anywhere; the only reason to open this card is that it knows
 *  something about them specifically. */
const GENERIC_ADVICE: RegExp[] = [
  /תהיה\s+ממושמע/,
  /שמור\s+על\s+(המשמעת|משמעת)/,
  /היה\s+סבלני/,
  /תהיה\s+סבלני/,
  /חשוב\s+להישאר\s+ממוקד/,
  /אל\s+תיתן\s+לרגשות/,
  /תסמוך\s+על\s+התהליך/,
  /המשך\s+כך/,
  /עבודה\s+טובה,?\s+תמשיך/,
  /פשוט\s+תעקוב\s+אחרי\s+התוכנית/,
  /הקפד\s+על\s+ניהול\s+סיכונים/,
  /כל\s+יום\s+הוא\s+הזדמנות/,
  /המסחר\s+הוא\s+מרתון/,
  /תלמד\s+מהטעויות/,
];

/** Sentences that assert a reason.
 *
 *  Narrow on purpose. "כי" alone is one of the most common words in Hebrew and
 *  appears in perfectly good sentences; what is banned is the specific move of
 *  explaining the trader's own psychology back to them, which the data cannot
 *  support at any sample size. */
const CAUSAL_CLAIMS: RegExp[] = [
  /הסיבה\s+ל/,
  /הסיבה\s+היא/,
  /זה\s+נובע\s+מ/,
  /נובעת?\s+מחוסר/,
  /בגלל\s+ה?(פחד|חמדנות|לחץ|חוסר\s+ביטחון|חוסר\s+סבלנות)/,
  /מתוך\s+(פחד|חמדנות|לחץ|תסכול)/,
  /(הפחד|החמדנות|חוסר\s+הביטחון|חוסר\s+הסבלנות)\s+שלך/,
  /אתה\s+עושה\s+את\s+זה\s+כי/,
  /מה\s+שמניע\s+אותך/,
];

/** Internal vocabulary. The trader is reading a note, not a database row. */
const FIELD_NAMES = [
  'avg_r', 'exp_usd', 'max_dd_usd', 'streak_now', 'last_7d', 'r_multiple',
  'followed_rules', 'take_profit', 'exit_price', 'entry_price', 'stop_loss',
  'win_rate', 'profit_factor', 'insufficientEvidence', 'knownForDays',
  'trade_frequency', 'logging_rate', 'rule_adherence', 'avg_loss_r',
  'discretionary_exit', 'no_confirmation', 'rule_violation', 'size_spike',
  'stop_widened',
];
/** Two-letter ones need boundaries a Hebrew string won't accidentally satisfy.
 *
 *  \b is no help here: it is defined on Latin word characters, so it sits
 *  happily between a Hebrew letter and a Latin one and matches the "pf" inside
 *  any Hebrew sentence. The boundary set is explicit instead, and includes the
 *  hyphen and the maqaf — Hebrew attaches Latin tokens with "ה-", which is
 *  exactly how these names show up when they leak. */
const SHORT_FIELDS = /(?:^|[\s(,."'׳\-־])(pf|wr)(?=[\s),.:"'׳\-־]|$)/;

/** Words that assert a repeated pattern. Checked only when the analysis found
 *  none — the model reaching for one anyway is the failure that turns an
 *  honest silence into an invention. */
const PATTERN_WORDS: RegExp[] = [
  /דפוס/,
  /נטייה/,
  /אתה\s+נוטה/,
  /שוב\s+ושוב/,
  /כל\s+פעם\s+ש/,
  /באופן\s+עקבי/,
  /חוזר\s+על\s+עצמו/,
];

/** Claims about a run of days. The model receives one day plus all-time
 *  aggregates; nothing in its input can support a sequence. */
const SEQUENCE_CLAIMS: RegExp[] = [
  /ימים?\s+ברצף/,
  /היום\s+ה(שני|שלישי|רביעי|חמישי)\s+ברצף/,
  /השבוע\s+ה?אחרון/,
  /מתחילת\s+השבוע/,
  /בימים\s+האחרונים/,
];

/** Durations. Only banned when the block has no duration to report. */
const DURATION_WORDS = /(שבוע|שבועות|חודש|חודשים)/;

/** How each tracked behaviour actually surfaces in Hebrew prose.
 *
 *  The `watching` rule used to look for the internal key — `discretionary_exit`
 *  — inside a Hebrew note. That can only fire if the model writes the field
 *  name, which FIELD_NAMES already catches, so the rule never once did its own
 *  job: naming a behaviour the analysis deliberately held back.
 *
 *  Every phrase here describes the ACTION, never the noun. That distinction is
 *  the whole safety margin: /חוקים/ appears in any sentence about a trading
 *  plan and would fire on good insights, while /סטית מהחוקים/ is the model
 *  raising the behaviour itself. A false hard violation costs a retry and
 *  often a blander note than the one it rejected, so a phrase that is merely
 *  probable does not belong in this table — a missing check is cheaper than a
 *  wrong one. Behaviours whose vocabulary has no unambiguous action phrase get
 *  no entry, and are simply not checked.
 *
 *  Only ever applied to `watching` — the primary behaviour is what the model
 *  was ASKED to write about, and is never matched against this. */
const BEHAVIOR_PHRASES: Record<string, RegExp> = {
  discretionary_exit: /(לפני\s+היעד|לפני\s+שהגיע\s+ליעד|סגירה\s+שיקולית)/,
  no_confirmation:    /(בלי|ללא)\s+אישור/,
  rule_violation:     /(סטית|סטייה|חרגת|חריגה)\s+(מ|מה)?(חוקים|כללים|החוקים|הכללים)/,
  size_spike:         /(הגדלת|הכפלת)\s+(את\s+)?(ה)?(פוזיציה|גודל|כמות)/,
  stop_widened:       /(הרחקת|הרחבת|הזזת)\s+(את\s+)?(ה)?סטופ/,
};

const GUARDRAIL_WORDS: Record<string, RegExp> = {
  trade_frequency: /(מספר\s+העסקאות|כמות\s+העסקאות|פחות\s+עסקאות|תדירות)/,
  avg_loss_r:      /(ההפסד|הפסדים)/,
  logging_rate:    /(תיעוד|רישום)/,
  rule_adherence:  /(חוקים|כללים)/,
};

function find(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** The rules that hold for ANY prose this product publishes.
 *
 *  Split out because the daily insight was the only surface that checked
 *  anything. The coach's chat answers and the weekly report went from the
 *  model to the trader with nothing in between — and the two failures that
 *  matter most are not specific to a daily note. A worthless coaching sentence
 *  is worthless in a chat reply; a claim about the trader's psychology is
 *  unfounded in a weekly report for exactly the same reason it is unfounded in
 *  the morning.
 *
 *  Everything here is checkable without knowing what the model was given,
 *  which is what makes it shareable. Rules that depend on the evidence — an
 *  invented pattern, a behaviour that was held back, a duration nobody
 *  measured — stay in `checkInsight`, because they are only violations
 *  relative to a specific block.
 *
 *  `lang` gates the Hebrew-only guards. An English answer to an English
 *  question is not a language failure. */
export function checkProse(text: string, lang: 'he' | 'en' = 'he'): Violation[] {
  const out: Violation[] = [];
  const push = (rule: string, severity: Severity, detail: string) =>
    out.push({ rule, severity, detail });

  const generic = find(text, GENERIC_ADVICE);
  if (generic) push('generic_advice', 'hard', generic);

  const causal = find(text, CAUSAL_CLAIMS);
  if (causal) push('causal_claim', 'hard', causal);

  const field = FIELD_NAMES.find(f => text.includes(f));
  if (field) push('field_name', 'hard', field);
  const short = SHORT_FIELDS.exec(text);
  if (short) push('field_name', 'hard', short[1]);

  if (lang === 'he') {
    // Two guards catching different failures. The first drops an answer that
    // came back as an English sentence; the second drops a Hebrew one carrying
    // English metric labels copied out of the prompt — the case that actually
    // shipped, and the one the first cannot see, because four Latin tokens
    // never outweigh a Hebrew paragraph.
    if (isMostlyLatin(text)) push('latin_output', 'hard', 'answer is mostly Latin');
    // Identifiers only. "R:R" and "PF" are shorthand a mentor writes and this
    // product's own statistics page prints — flagging them here would spend the
    // one corrective retry on a correct sentence.
    if (hasLatinIdentifier(text)) push('latin_metric_label', 'hard', 'English metric label');
  }

  if (text.includes('!')) push('exclamation', 'soft', '!');

  return out;
}

/** Run every check against one generated insight.
 *
 *  `block` is what the model was given. Most of the rules are about the
 *  relationship between the two — a claim is only a violation relative to the
 *  evidence that was available when it was written. */
export function checkInsight(text: string, block: BehaviorBlock): Violation[] {
  const out: Violation[] = [...checkProse(text, 'he')];
  const push = (rule: string, severity: Severity, detail: string) =>
    out.push({ rule, severity, detail });

  // Nothing cleared the bar, so there is no pattern to describe. Rule 15.
  if (block.insufficientEvidence) {
    const invented = find(text, PATTERN_WORDS);
    if (invented) push('invented_pattern', 'hard', invented);
  }

  // A behaviour the model was not given. `watching` is explicitly off limits —
  // those are tracked and deliberately held back this run, so raising one is
  // the model deciding for itself what the trader's problem is.
  for (const kind of block.watching) {
    const phrase = BEHAVIOR_PHRASES[kind];
    const hit = phrase?.exec(text);
    if (hit) push('unlisted_behavior', 'hard', hit[0]);
  }

  const sequence = find(text, SEQUENCE_CLAIMS);
  if (sequence) push('sequence_claim', 'hard', sequence);

  const primary = block.primary;

  // The single most damaging thing the system could publish: an experiment
  // that improved the target while breaking something else, reported as a win.
  if (primary?.outcome?.verdict === 'traded_one_problem_for_another') {
    const unreported = primary.outcome.broken.filter(
      g => !(GUARDRAIL_WORDS[g] ?? /$^/).test(text),
    );
    if (unreported.length) push('unreported_guardrail', 'hard', unreported.join(','));
  }

  // Soft — clumsy rather than untrue.
  if (primary?.knownForDays == null && DURATION_WORDS.test(text)) {
    push('invented_duration', 'soft', DURATION_WORDS.exec(text)![0]);
  }
  const questionMarks = (text.match(/\?/g) ?? []).length;
  if (primary?.question && questionMarks === 0) push('missing_question', 'soft', 'no question asked');
  if (questionMarks > 1) push('two_questions', 'soft', `${questionMarks} question marks`);

  return out;
}

export function hasHardViolation(violations: readonly Violation[]): boolean {
  return violations.some(v => v.severity === 'hard');
}

/** The correction appended for the single retry.
 *
 *  Names what was written and what rule it broke, rather than repeating the
 *  whole rulebook: a model that has just violated rule 13 has already read
 *  rule 13, and re-sending it unchanged mostly produces the same output with
 *  different adjectives. */
export function buildCorrection(violations: readonly Violation[]): string {
  const hard = violations.filter(v => v.severity === 'hard');
  const lines = hard.map(v => {
    switch (v.rule) {
      case 'generic_advice':
        return `- You wrote "${v.detail}". That sentence is true of every trader on every day. Delete it and say something only this trader's data supports, or say less.`;
      case 'causal_claim':
        return `- You wrote "${v.detail}". You cannot know why. Describe what and when; the reason is theirs to give.`;
      case 'field_name':
        return `- You wrote the internal field name "${v.detail}". Say the number in Hebrew instead.`;
      case 'invented_pattern':
        return `- You wrote "${v.detail}", but the analysis found no pattern this run. Write about today alone.`;
      case 'unlisted_behavior':
        return `- You referred to "${v.detail}", which you were not given. Only the behaviour in the block.`;
      case 'sequence_claim':
        return `- You wrote "${v.detail}". You receive one day and cannot see a sequence of days.`;
      case 'latin_output':
        return `- You answered in English. Answer in Hebrew.`;
      case 'latin_metric_label':
        return `- You used an English metric label. Write the metric in Hebrew — "אחוז הצלחה", not "winRate".`;
      case 'unreported_guardrail':
        return `- The experiment improved the target but "${v.detail}" got worse, and you reported only the improvement. Report both, in the same paragraph.`;
      default:
        return `- ${v.rule}: "${v.detail}"`;
    }
  });
  return [
    '',
    'YOUR PREVIOUS ATTEMPT BROKE THESE RULES. Rewrite it:',
    ...lines,
    '',
    'Keep everything that was fine. Fix only what is listed. Shorter is acceptable.',
  ].join('\n');
}
