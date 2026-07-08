import { describe, expect, it } from 'vitest';
import { runFullAnalysis } from '../../app/lib/analytics';
import { buildFactsContext, buildChatPrompt } from '../../app/lib/ai/chatPrompt';
import { makeTrade } from '../helpers/trade';

describe('buildFactsContext', () => {
  it('includes the computed analysis and only appends hypothesis/known-facts when present', () => {
    const analysis = runFullAnalysis([makeTrade({ symbol: 'ES', result: 'WIN' }), makeTrade({ symbol: 'ES', result: 'LOSS' })]);

    const bare = buildFactsContext(analysis, '', '');
    expect(bare).toContain('OVERALL');
    expect(bare).not.toContain('EDGE HYPOTHESIS');
    expect(bare).not.toContain('ESTABLISHED FACTS');

    const full = buildFactsContext(analysis, '- performs better in London', 'CURRENT EDGE HYPOTHESIS: long ES.');
    expect(full).toContain('CURRENT EDGE HYPOTHESIS: long ES.');
    expect(full).toContain('ESTABLISHED FACTS ABOUT THIS TRADER:');
    expect(full).toContain('performs better in London');
  });
});

describe('buildChatPrompt', () => {
  const facts = 'OVERALL: 10 trades, winRate 60%';

  it('embeds the facts, the question, and the hard precision rules', () => {
    const prompt = buildChatPrompt(facts, [], 'מה הסשן הכי טוב שלי?', 'he');
    expect(prompt).toContain(facts);
    expect(prompt).toContain('מה הסשן הכי טוב שלי?');
    // Precision guardrails must be present in the instruction.
    expect(prompt).toContain('Answer ONLY from the statistics above');
    expect(prompt).toContain('sample size');
    expect(prompt).toContain('Never predict the market');
  });

  it('omits the conversation block when there is no history', () => {
    expect(buildChatPrompt(facts, [], 'q', 'he')).not.toContain('RECENT CONVERSATION');
  });

  it('includes only the last few turns of history', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `msg${i}` }));
    const prompt = buildChatPrompt(facts, history, 'q', 'he');
    expect(prompt).toContain('RECENT CONVERSATION');
    expect(prompt).toContain('msg9');   // most recent kept
    expect(prompt).not.toContain('msg0'); // oldest dropped (only last 6 kept)
  });
});
