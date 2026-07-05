import type { TradeEntry } from '../journal';
import { runFullAnalysis, type ConfidenceLevel } from '../analytics';
import { summarizeAnalysis, fmtPF } from './factsBlock';
import { generateInsightText } from './client';
import { HEBREW_MENTOR_STYLE } from './styleGuide';

export interface WeeklyReport {
  biggestStrength: string;
  biggestWeakness: string;
  largestImprovement: string;
  largestDecline: string;
  focusNextWeek: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

/** Local calendar day `daysAgo` days back, `YYYY-MM-DD`. */
function daysAgoISO(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compares the trailing 7-day window against the 7 days before it. Returns
    null when there isn't enough data this week to say anything meaningful —
    the module must never generate a verdict on thin data. */
export async function generateWeeklyReport(trades: TradeEntry[], lang: 'he' | 'en'): Promise<WeeklyReport | null> {
  const weekStart = daysAgoISO(6);
  const prevWeekStart = daysAgoISO(13);

  const thisWeek = trades.filter(t => t.dateISO >= weekStart);
  const prevWeek = trades.filter(t => t.dateISO >= prevWeekStart && t.dateISO < weekStart);

  const closedThisWeek = thisWeek.filter(t => t.result !== 'OPEN');
  if (closedThisWeek.length < 3) return null;

  const thisAnalysis = runFullAnalysis(thisWeek);
  const prevClosed = prevWeek.filter(t => t.result !== 'OPEN');
  const prevAnalysis = prevClosed.length >= 3 ? runFullAnalysis(prevWeek) : null;

  const isHe = lang === 'he';
  const langInstruction = isHe ? HEBREW_MENTOR_STYLE : 'Respond in English.';

  const comparisonBlock = prevAnalysis
    ? `PREVIOUS WEEK (for comparison — ${prevAnalysis.performance.closedTrades} closed trades):\n` +
      `Win rate ${prevAnalysis.performance.winRate.toFixed(0)}%, PF ${fmtPF(prevAnalysis.performance.profitFactor)}, ` +
      `avgRR ${prevAnalysis.performance.avgRR.toFixed(2)}, PnL $${prevAnalysis.performance.totalPnl.toFixed(0)}`
    : `PREVIOUS WEEK: not enough data to compare (fewer than 3 closed trades) — for the improvement/decline fields, say plainly there isn't enough prior-week data yet instead of inventing a comparison.`;

  const prompt = `You are Onyx, an experienced trading mentor doing a weekly review of a futures day-trader's journal — talking straight, like one trader to another. You do NOT predict markets and you NEVER give buy/sell signals — you only summarize what already happened in the trader's own data.

${langInstruction}

THIS WEEK (${thisAnalysis.performance.closedTrades} closed trades):
${summarizeAnalysis(thisAnalysis)}

${comparisonBlock}

Produce exactly one JSON object using ONLY the numbers given above:
{
  "biggestStrength": "<one sentence, the strongest real edge this week, with numbers>",
  "biggestWeakness": "<one sentence, the weakest real spot this week, with numbers>",
  "largestImprovement": "<one sentence citing what improved most vs. last week with numbers, or state plainly there isn't enough prior-week data to compare>",
  "largestDecline": "<one sentence citing what declined most vs. last week with numbers, or state plainly there isn't enough prior-week data to compare>",
  "focusNextWeek": "<one sentence, a single concrete, non-predictive focus area for next week>"
}

Rules:
- Every number must come directly from the data above. Never invent, round dramatically, or estimate.
- Never use phrasing like "should buy", "should sell", "will go up/down", or any market prediction.
- JSON only, no extra text.`;

  const raw = await generateInsightText(prompt);
  let parsed: Partial<Record<'biggestStrength' | 'biggestWeakness' | 'largestImprovement' | 'largestDecline' | 'focusNextWeek', string>> = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }

  if (!parsed.biggestStrength || !parsed.biggestWeakness || !parsed.focusNextWeek) return null;

  const noCompareYet = isHe
    ? 'אין עדיין מספיק נתונים משבוע קודם כדי להשוות.'
    : "Not enough prior-week data to compare yet.";

  return {
    biggestStrength: parsed.biggestStrength,
    biggestWeakness: parsed.biggestWeakness,
    largestImprovement: parsed.largestImprovement ?? noCompareYet,
    largestDecline: parsed.largestDecline ?? noCompareYet,
    focusNextWeek: parsed.focusNextWeek,
    confidenceLevel: thisAnalysis.performance.confidence.level,
    sampleSize: thisAnalysis.performance.confidence.sampleSize,
  };
}
