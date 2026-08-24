// ─────────────────────────────────────────────────────────────────────────────
// What comes BACK from a provider, before anything is shown or stored.
//
// A response that hit the token ceiling does not look like an error from the
// outside: the API call succeeded, the usage row is healthy, the text is
// Hebrew — and it stops in the middle of a word. The Gemini path has always
// cut back to the last finished sentence; the Claude path did not, so the one
// run that crossed the ceiling wrote a broken note onto the trader's
// dashboard.
//
// (The batch-pairing cases that used to sit here went with the two phrasing
// helpers they covered, when the surfaces calling them were removed.)
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => createMock(...args) };
  },
}));

const generateInsightJsonMock = vi.fn();
vi.mock('../../app/lib/ai/client', () => ({
  generateInsightJson: (...args: unknown[]) => generateInsightJsonMock(...args),
}));

const { callClaudeInsight, CLAUDE_MAX_TOKENS } = await import('../../app/lib/coach-pipeline/providers/anthropic');

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

