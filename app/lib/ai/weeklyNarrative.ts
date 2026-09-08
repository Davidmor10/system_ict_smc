import type { ConfidenceLevel } from '../analytics';
import { checkProse, hasHardViolation, buildCorrection } from '../coach-pipeline/quality/insightCheck';
import { generateInsightJson } from './client';
import { logger } from '../logger';
import { CHALLENGE_TRADER_STYLE, HEBREW_MENTOR_STYLE } from './styleGuide';

export interface NarrativeFacts {
  thisWeekSummary: string;
  prevWeekSummary: string | null;
  baselineSummary: string | null;
  comparisonSummary: string;
  patternMemorySummary: string;
  knownFactsSummary: string;
  rootCauseSummary: string;
  hypothesisSummary: string | null;
  notesObservations: string[];
  /** Fewer than 2 prior weekly reports exist for this user — sample size
      alone doesn't capture "consistency across weeks," so the model is told
      explicitly to say it's still building a picture rather than overstate. */
  isEarlyInHistory: boolean;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

export interface WeeklyNarrative {
  paragraphs: string[];
}

const MIN_PARAGRAPHS = 3;
const MAX_PARAGRAPHS = 6;

/** Deliberately anchors the model on the product owner's own example of the
    causal depth expected — cited verbatim so "explain why" isn't just an
    instruction, it's demonstrated. */
const GOOD_BAD_EXAMPLE = `EXAMPLE OF THE DEPTH EXPECTED (do not copy the numbers, only the reasoning style):
GOOD: "This week your average RR rose from 1.4R to 2.1R, even though your win rate stayed almost the same. That means the improvement came mainly from better exits, not more winning trades."
BAD (never write like this): "Your performance improved." — this only states a metric moved, without explaining what actually changed or why it matters.`;

/** Replaces the old fixed-template weekly report (biggestStrength/
    biggestWeakness/largestImprovement/largestDecline/focusNextWeek) with a
    free-flowing Hebrew narrative. The no-template rule is enforced
    structurally: the requested JSON has no named category fields at all —
    only `paragraphs`, so there's nowhere for the model to fall back into a
    checklist. Everything cited must already exist in the facts blocks passed
    in; this function only builds the prompt, calls the LLM, and parses the
    result — it never computes a statistic itself. */
export async function generateNarrativeText(facts: NarrativeFacts, lang: 'he' | 'en', clerkId?: string | null): Promise<WeeklyNarrative | null> {
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';
  const challengeInstruction = facts.notesObservations.length > 0 ? `\n\n${CHALLENGE_TRADER_STYLE}` : '';

  const prompt = `You are Onyx, an experienced trading mentor writing a real weekly analysis letter for a futures day-trader — not a report generator filling in a template. You do NOT predict markets and you NEVER give buy/sell signals — you only explain what the trader's own data shows.

${langInstruction}${challengeInstruction}

THIS WEEK:
${facts.thisWeekSummary}

LAST WEEK:
${facts.prevWeekSummary ?? 'Not enough data from last week to compare yet.'}

TRAILING 4-WEEK BASELINE:
${facts.baselineSummary ?? 'Not enough historical data yet for a baseline.'}

COMPARISON:
${facts.comparisonSummary}

ROOT CAUSE:
${facts.rootCauseSummary}

RECURRING PATTERNS TRACKED OVER TIME:
${facts.patternMemorySummary}

DURABLE FACTS ALREADY KNOWN ABOUT THIS TRADER:
${facts.knownFactsSummary}

${facts.hypothesisSummary ? `CURRENT EDGE HYPOTHESIS:\n${facts.hypothesisSummary}\n` : ''}
${facts.notesObservations.length > 0 ? `THE TRADER'S OWN NOTES THIS WEEK (verbatim quotes):\n${facts.notesObservations.map(n => `"${n}"`).join('\n')}\n` : ''}
${GOOD_BAD_EXAMPLE}

${facts.isEarlyInHistory ? 'This trader does not have much history with the system yet — say plainly that you are still building a picture of them, and keep conclusions modest.' : ''}
${facts.confidenceLevel === 'low' ? `There are only ${facts.sampleSize} relevant trades behind this — treat this as early feedback, not a strong conclusion, and say so.` : ''}

Write a real analysis, not a checklist. Across 3-6 short Hebrew paragraphs, make sure you collectively cover:
- What actually happened this week.
- What changed compared to last week and the trailing baseline, and WHY (use the root cause above when one is given).
- Which conditions helped and which hurt.
- Whether one instrument/session/setup carried the week (cite the concentration numbers when the comparison flags over-reliance).
- What this reveals about the trader's current edge (reference the hypothesis and durable facts above where relevant, don't repeat them as a bare list).
- What to pay attention to next week.

Produce exactly one JSON object:
{ "paragraphs": ["<paragraph 1>", "<paragraph 2>", "..."] }

Rules:
- ${MIN_PARAGRAPHS} to ${MAX_PARAGRAPHS} paragraphs, each 1-4 sentences.
- Every number must come directly from the facts above. Never invent, round dramatically, or estimate.
- No named categories, no "biggest strength/weakness" style headers inside the paragraphs — write it as connected prose a mentor would actually say.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  let raw: string;
  try {
    // JSON at the API level, not only in the prompt's words. The letter already
    // asks for an object, which is the shape this mode requires.
    raw = await generateInsightJson(prompt, clerkId === undefined ? undefined : { clerkId, purpose: 'weekly_narrative' });
  } catch (err) {
    logger.error('generateNarrativeText: AI generation failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }

  let parsed: { paragraphs?: unknown } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }

  if (!Array.isArray(parsed.paragraphs)) {
    logger.warn('generateNarrativeText: unparseable model output', { raw: raw.slice(0, 300) });
    return null;
  }
  const paragraphs = parsed.paragraphs.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  if (paragraphs.length < MIN_PARAGRAPHS) return null;

  const kept = paragraphs.slice(0, MAX_PARAGRAPHS);

  // The letter parsed. Whether it is a letter this product is allowed to send
  // is a separate question, and nothing asked it until now: the daily insight
  // has checked its own output since it shipped, and this — the longest piece
  // of prose the system writes, the one the trader is most likely to read end
  // to end — went from the model to the page unexamined.
  //
  // One corrective retry, then keep whichever version is cleaner. A weekly
  // letter carrying a platitude is still worth more than no letter at all, so
  // a failed re-ask never costs the report; it is logged instead.
  try {
    const violations = checkProse(kept.join('\n\n'), lang);
    if (hasHardViolation(violations)) {
      logger.warn('weekly narrative violated its own rules', {
        clerkId, rules: violations.filter(v => v.severity === 'hard').map(v => v.rule),
      });
      const retry = await generateInsightJson(
        prompt + buildCorrection(violations),
        clerkId === undefined ? undefined : { clerkId, purpose: 'weekly_narrative_retry' },
      );
      const match = retry.match(/\{[\s\S]*\}/);
      const reparsed = match ? (JSON.parse(match[0]) as { paragraphs?: unknown }) : {};
      if (Array.isArray(reparsed.paragraphs)) {
        const fixed = reparsed.paragraphs
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          .slice(0, MAX_PARAGRAPHS);
        if (fixed.length >= MIN_PARAGRAPHS && !hasHardViolation(checkProse(fixed.join('\n\n'), lang))) {
          return { paragraphs: fixed };
        }
      }
    }
  } catch (err) {
    logger.warn('weekly narrative recheck failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { paragraphs: kept };
}

// ── The thin week ────────────────────────────────────────────────────────────
//
// A week below the claim floor gets a written report either way — the factual
// one in lib/intelligence/weeklyFactual, built from counts with no model in
// the loop. This adds the one thing a count cannot give: a reading of THESE
// trades against what the journal already knows about this trader.
//
// The distinction the prompt is built around, and the reason this is a
// separate function rather than a looser weekly letter:
//
//   · Four trades cannot establish anything. No trend, no cause, no edge —
//     that fence is the whole reason the full report has a floor at all.
//   · Four trades CAN be recognised. Whether they look like the trader's
//     ordinary week or unlike it is a comparison against a large sample, and
//     the large sample is the journal, not the week.
//
// So it may say "this is the pattern you already have, here it is again" or
// "this week does not look like your usual", and it may not say "this week
// shows" anything at all.
//
// Returns null on any failure. The report is written without it — the factual
// spine must never depend on a model being reachable.

export interface ThinWeekFacts {
  /** One line per closed trade this week, already in Hebrew. */
  weekTrades: string[];
  /** The week's counts, in a sentence. */
  weekSummary: string;
  /** The whole journal — the only sample large enough to be a reference. */
  journalSummary: string;
  /** Durable facts already established about this trader. */
  knownFactsSummary: string;
  /** Recurring conditions tracked over time. */
  patternMemorySummary: string;
  /** Decided trades this week. Named in the prompt so the model argues from
   *  the real number rather than from a vague "few". */
  decidedThisWeek: number;
}

const THIN_MIN_PARAGRAPHS = 1;
const THIN_MAX_PARAGRAPHS = 2;

export async function generateThinWeekObservation(
  facts: ThinWeekFacts, lang: 'he' | 'en', clerkId?: string | null,
): Promise<string[] | null> {
  const langInstruction = lang === 'he' ? HEBREW_MENTOR_STYLE : 'Respond in English.';

  const prompt = `You are Onyx, an experienced trading mentor. This trader closed only ${facts.decidedThisWeek} decided trades this week — far too few to conclude anything from the week itself. You do NOT predict markets and you NEVER give buy/sell signals.

${langInstruction}

THIS WEEK'S TRADES, ONE PER LINE:
${facts.weekTrades.join('\n')}

THIS WEEK IN NUMBERS:
${facts.weekSummary}

THE WHOLE JOURNAL — the only sample here large enough to be a reference point:
${facts.journalSummary}

DURABLE FACTS ALREADY ESTABLISHED ABOUT THIS TRADER:
${facts.knownFactsSummary}

RECURRING CONDITIONS TRACKED OVER TIME:
${facts.patternMemorySummary}

YOUR JOB, and its hard limit:
Write ${THIN_MIN_PARAGRAPHS}-${THIN_MAX_PARAGRAPHS} short paragraphs that place THIS WEEK'S trades against what is already known about this trader from the whole journal.

You MAY say:
- That these specific trades look like the trader's ordinary behaviour — and point at the durable fact or tracked pattern they match.
- That they look UNLIKE it, naming which established fact they depart from.
- What is worth watching in the coming weeks as a result — as a question to keep an eye on, never as a finding.
- Something concrete about an individual trade above, since a single trade is a fact about itself.

You MUST NOT say, under any circumstances:
- That this week shows a trend, an improvement, or a deterioration. ${facts.decidedThisWeek} trades cannot show any of those.
- That anything CAUSED this week's result.
- That the trader has, or has lost, an edge, based on this week.
- Any statistic about this week beyond the plain counts given above. No win rate for the week, no average for the week.
- Anything about the market's future.

If this week's trades genuinely do not connect to anything established, say exactly that in one sentence — that they are too few and too ordinary to add to the picture yet — and stop. Saying nothing was found is a legitimate answer and a better one than a manufactured connection.

Produce exactly one JSON object:
{ "paragraphs": ["<paragraph 1>", "<paragraph 2 — optional>"] }

Rules:
- Each paragraph 1-3 sentences.
- Every number must come from the blocks above. Never invent or estimate one.
- JSON only, no extra text.`;

  let raw: string;
  try {
    raw = await generateInsightJson(prompt, clerkId === undefined ? undefined : { clerkId, purpose: 'thin_week_observation' });
  } catch (err) {
    logger.warn('generateThinWeekObservation: AI generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  let paragraphs: string[];
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as { paragraphs?: unknown }) : {};
    if (!Array.isArray(parsed.paragraphs)) return null;
    paragraphs = parsed.paragraphs
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .slice(0, THIN_MAX_PARAGRAPHS);
  } catch {
    return null;
  }
  if (paragraphs.length < THIN_MIN_PARAGRAPHS) return null;

  // The same quality gate the weekly letter goes through. There is no retry
  // here on purpose: this paragraph is an addition to a report that is already
  // complete without it, so a violating draft is dropped rather than argued
  // with. A thin week is exactly where a platitude does the most damage.
  try {
    const violations = checkProse(paragraphs.join('\n\n'), lang);
    if (hasHardViolation(violations)) {
      logger.warn('thin-week observation violated its own rules, dropped', {
        clerkId, rules: violations.filter(v => v.severity === 'hard').map(v => v.rule),
      });
      return null;
    }
  } catch {
    return null;
  }

  return paragraphs;
}
