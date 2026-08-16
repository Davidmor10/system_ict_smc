// ─────────────────────────────────────────────────────────────────────────────
// What comes BACK from a provider, before anything is shown or stored.
//
// Two failures live here, and neither one looks like an error from the outside:
//
//   1. A response that hit the token ceiling. The API call succeeded, the usage
//      row is healthy, the text is Hebrew — and it stops in the middle of a
//      word. The Gemini path has always cut back to the last finished sentence;
//      the Claude path did not, so the one run that crossed the ceiling wrote a
//      broken note onto the trader's dashboard.
//
//   2. A batch of phrases matched to the wrong items. Every number the trader
//      reads next to those sentences — sample size, confidence, the subject
//      itself — is computed, not written by the model. Pair them by array
//      position and one dropped element re-labels every sentence after it.
//      Nothing downstream can detect that; it reads exactly like a correct
//      answer about a different pattern.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupPerformance } from '../../app/lib/analytics';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => createMock(...args) };
  },
}));

const generateInsightTextMock = vi.fn();
vi.mock('../../app/lib/ai/client', () => ({
  generateInsightText: (...args: unknown[]) => generateInsightTextMock(...args),
}));

const { callClaudeInsight, CLAUDE_MAX_TOKENS } = await import('../../app/lib/coach-pipeline/providers/anthropic');
const { generateInsightsPhrasing, generateWorkingStrengthsPhrasing } = await import('../../app/lib/ai/insightPhrasing');

function reply(text: string, stopReason: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

// Long enough to clear the 80-character usable-remainder floor — in Hebrew
// that is roughly two sentences, which is also the shortest thing worth
// putting on the dashboard.
const PARA = 'היום פתחת שלוש עסקאות, וכולן בסשן של ניו יורק בבוקר. שתיים מהן נסגרו ברווח, והשלישית הגיעה לסטופ אחרי כמה דקות.';

describe('Claude output that hit the token ceiling', () => {
  beforeEach(() => createMock.mockReset());

  it('leaves a normally-finished answer exactly as written', async () => {
    createMock.mockResolvedValue(reply(`${PARA} וזה בדיוק מה שתכננת.`, 'end_turn'));
    const out = await callClaudeInsight('sys', 'user');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe(`${PARA} וזה בדיוק מה שתכננת.`);
  });

  it('cuts a truncated answer back to its last finished sentence', async () => {
    createMock.mockResolvedValue(reply(`${PARA} ומה שמעניין באמת הוא שהעסקה השליש`, 'max_tokens'));
    const out = await callClaudeInsight('sys', 'user');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toBe(PARA);
      expect(out.text.endsWith('.')).toBe(true);
    }
  });

  it('refuses the run when nothing survives the cut, rather than storing a fragment', async () => {
    createMock.mockResolvedValue(reply('היום פתחת שלוש עסק', 'max_tokens'));
    const out = await callClaudeInsight('sys', 'user');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errorKind).toBe('other');
  });

  it('still bills for every token the model produced, including the cut ones', async () => {
    createMock.mockResolvedValue(reply(`${PARA} והמשך שנחתך`, 'max_tokens'));
    const out = await callClaudeInsight('sys', 'user');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.tokensOut).toBe(200);
  });

  it('keeps the API ceiling above the 500-token cap the prompt itself asks for', () => {
    // Equal values aim the model squarely at the wall — that is the bug the
    // trim above exists to survive, not a configuration to return to.
    expect(CLAUDE_MAX_TOKENS).toBeGreaterThan(500);
  });
});

describe('batch phrasing is matched by the index the model echoes', () => {
  beforeEach(() => generateInsightTextMock.mockReset());

  const items = [
    { subject: 'A', metric: METRIC(), extra: '' },
    { subject: 'B', metric: METRIC(), extra: '' },
    { subject: 'C', metric: METRIC(), extra: '' },
  ];

  it('places each sentence on the item it names, not the slot it arrived in', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify([
      { i: 3, text: 'about C' },
      { i: 1, text: 'about A' },
      { i: 2, text: 'about B' },
    ]));
    expect(await generateInsightsPhrasing(items, 'he')).toEqual(['about A', 'about B', 'about C']);
  });

  it('leaves a skipped item empty instead of shifting the rest onto it', async () => {
    // The old positional read gave item 2 the sentence written about item 3.
    generateInsightTextMock.mockResolvedValue(JSON.stringify([
      { i: 1, text: 'about A' },
      { i: 3, text: 'about C' },
    ]));
    expect(await generateInsightsPhrasing(items, 'he')).toEqual(['about A', '', 'about C']);
  });

  it('drops an index that refers to an item we never sent', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify([
      { i: 1, text: 'about A' },
      { i: 9, text: 'about nothing' },
    ]));
    expect(await generateInsightsPhrasing(items, 'he')).toEqual(['about A', '', '']);
  });

  it('still reads a bare array of strings positionally', async () => {
    // The floor, not the contract: a model that ignores the shape is no worse
    // off than it was before the index existed.
    generateInsightTextMock.mockResolvedValue(JSON.stringify(['a', 'b', 'c']));
    expect(await generateInsightsPhrasing(items, 'he')).toEqual(['a', 'b', 'c']);
  });

  it('returns null — not a row of blanks — when nothing usable came back', async () => {
    generateInsightTextMock.mockResolvedValue('not json at all');
    expect(await generateInsightsPhrasing(items, 'he')).toBeNull();
  });

  it('applies the same matching to confirmed strengths', async () => {
    const strengths = [
      { subjectLabel: 'ES · ניו יורק AM', metric: METRIC(), baseline: 50, trend: 'up' as const },
      { subjectLabel: 'NQ · לונדון', metric: METRIC(), baseline: 50, trend: 'down' as const },
    ];
    generateInsightTextMock.mockResolvedValue(JSON.stringify([
      { i: 2, text: 'about NQ' },
      { i: 1, text: 'about ES' },
    ]));
    expect(await generateWorkingStrengthsPhrasing(strengths, 'he')).toEqual(['about ES', 'about NQ']);
  });
});

// Only the fields the prompt formatter touches — the pairing is what is under
// test, not the arithmetic.
function METRIC(): GroupPerformance {
  return {
    key: 'x', label: 'x', trades: 10, wins: 6, losses: 4,
    winRate: 60, totalPnl: 1000, avgRR: 1.5, avgWinner: 300, avgLoser: 150,
    profitFactor: 2, confidence: { level: 'medium' as const, sampleSize: 10 },
  };
}
