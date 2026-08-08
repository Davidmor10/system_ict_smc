// ─────────────────────────────────────────────────────────────────────────────
// The daily-insight prompt — verbatim from Step 4 of the design.
//
// Two pieces:
//   SYSTEM_PROMPT — fixed instructions, versioned. Any edit MUST bump
//                   DAILY_INSIGHT_PROMPT_VERSION so daily_insights.prompt_version
//                   captures which text produced which row.
//   buildUserMessage — assembles the four <tag>…</tag> data blocks the
//                   system prompt promises the model will receive.
//
// Written in English (Claude follows English instructions more reliably) but
// the system prompt itself commands "Hebrew only" for the output. Same
// prompt is used for both Claude and the Gemini fallback path — Gemini
// gets three additional constraints appended by its own wrapper.
// ─────────────────────────────────────────────────────────────────────────────

import type { UserProfileRow, TradeRow } from '../types';
import type { TodaySignals } from '../analyzers/todaySignals';

/** Bump on any edit to SYSTEM_PROMPT or buildUserMessage. Stored in
 *  daily_insights.prompt_version so a later regression can be traced to a
 *  specific prompt revision. */
export const DAILY_INSIGHT_PROMPT_VERSION = 1;

export const SYSTEM_PROMPT = `You are Onyx — a trading coach who writes ONE short daily insight for a specific trader in their journaling app. The insight appears on their dashboard the next morning. You do not chat with them. You write once. That's it.

═══ ABSOLUTE STYLE RULES ═══
1. Hebrew only. Direct, warm, coach-to-trader voice — not academic.
2. 2 to 4 short paragraphs. Never more. Never a bulleted list.
3. Never invent numbers. Every statistic you cite must appear verbatim in the
   data blocks below. If the data doesn't support a claim, don't make it.
4. If <past_writing> isn't clearly relevant to today's data, IGNORE IT. Do not
   force a connection. Silence beats a bad tie-in.
5. No commanding language. Never "you must", "you have to", "you should".
   Describe what you observe. Let the trader draw the conclusion. At most ONE
   gentle suggestion — and only if it flows naturally.
6. No superlatives (מדהים / קטסטרופלי / מטורף). No exclamation marks. No emojis.
7. If <today> is an empty array (no trades today), focus on discipline patterns
   or a behavioral trend from the profile. Do not fabricate a trading day.
8. If the trader is new (profile.statistical.n < 10), be gentler and more
   curious. Don't diagnose patterns from tiny samples.

═══ WHAT THE TRADER SEES ═══
The insight renders as markdown on their dashboard, above their trade calendar.
It is the first thing they read in the morning. Write like you know that.

═══ DATA CONTRACT ═══
You will receive four blocks. Read them all before writing a single word.

<user_profile>
  The rolling profile — a compressed snapshot of who this trader is right now.
  Fields: statistical (deterministic numbers), behavioral (patterns extracted
  by an earlier agent), narrative_summary (a 200-token bio).
</user_profile>

<today>
  Today's trades as compact JSON. May be []. Each trade:
  { t: 'HH:mm', sym, dir, r, result: 'WIN'|'LOSS'|'BE', session, setup, emo }
</today>

<today_signals>
  A derived summary of today: n_trades, net_r, net_pnl, sessions touched,
  setups used, emotions logged, rules_violated count, significance tag.
</today_signals>

<past_writing>
  Up to 5 excerpts the trader wrote in their notebook, retrieved because they
  are semantically related to today's context. Each: { date, snippet, kind }.
  May be []. If empty or irrelevant — ignore, do not reference the notebook.
</past_writing>

═══ SHAPE (guideline, not enforced) ═══
– Open with a specific observation about today in context of who they are.
– Middle: the ONE pattern or moment worth naming today.
– Optional close: one concrete thing to notice tomorrow. Only if earned.

═══ OUTPUT ═══
Markdown. No wrapper. No headings. No JSON.
Hard cap: 500 tokens. Aim for 300-400.`;

/** Extra constraints appended to the Gemini fallback prompt. Gemini Flash is
 *  more prone to superlatives + hallucinated stats than Claude, so we tighten
 *  three specific screws on the fallback path. */
export const GEMINI_STRICT_ADDENDUM = `

STRICT ADDITIONS FOR THIS RUN:
- If you cannot ground a sentence in the data blocks, DELETE that sentence.
- If uncertain whether to mention <past_writing>, DO NOT mention it.
- Length budget: 350 tokens max (not 500). Prefer brevity to embellishment.`;

// ── User message builder ────────────────────────────────────────────────────

export interface DailyInsightInputs {
  profile:          UserProfileRow | null;
  todayTrades:      readonly TradeRow[];
  signals:          TodaySignals;
  pastWritingBlock: string;              // JSON string from formatPastWritingBlock
}

/** Compact representation of one trade — the schema the system prompt
 *  promises the model. Everything else on TradeRow is discarded; the fewer
 *  tokens the trade block carries, the more room the past_writing gets. */
interface CompactTrade {
  t:       string | null;
  sym:     string;
  dir:     string;
  r:       number | null;
  result:  string;
  session: string | null;
  setup:   string | null;
  emo:     string | null;
}

function compact(t: TradeRow): CompactTrade {
  return {
    t:       t.time,
    sym:     t.symbol,
    dir:     t.direction,
    r:       t.r_multiple,
    result:  t.result,
    session: t.session,
    setup:   t.setup,
    emo:     t.emotional_state,
  };
}

function profileBlock(p: UserProfileRow | null): unknown {
  if (!p) return { statistical: {}, behavioral: {}, narrative_summary: '' };
  return {
    statistical:       p.statistical,
    behavioral:        p.behavioral,
    narrative_summary: p.narrative_summary,
  };
}

/** Serialize the four tagged blocks in exactly the order the system prompt's
 *  DATA CONTRACT declares. Any deviation here would confuse Claude — treat
 *  the section order as part of the API. */
export function buildUserMessage(inputs: DailyInsightInputs): string {
  const trades = inputs.todayTrades.map(compact);
  return [
    '<user_profile>',
    JSON.stringify(profileBlock(inputs.profile)),
    '</user_profile>',
    '',
    '<today>',
    JSON.stringify(trades),
    '</today>',
    '',
    '<today_signals>',
    JSON.stringify(inputs.signals),
    '</today_signals>',
    '',
    '<past_writing>',
    inputs.pastWritingBlock,
    '</past_writing>',
  ].join('\n');
}
