import type { ConfidenceLevel } from '../analytics';
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

  return { paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS) };
}
