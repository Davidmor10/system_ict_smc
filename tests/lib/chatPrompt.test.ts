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

  it('embeds the facts, the question, the mentor-voice rules and the precision guardrails', () => {
    const prompt = buildChatPrompt(facts, [], 'מה הסשן הכי טוב שלי?', 'he');
    expect(prompt).toContain(facts);
    expect(prompt).toContain('מה הסשן הכי טוב שלי?');
    // Precision guardrails for personal-journal claims must still be present.
    expect(prompt).toContain('ONLY the statistics above');
    expect(prompt).toContain('sample size');
    expect(prompt).toContain('predict what the market will do');
    // Mentor-voice rules (the whole point of the redesign) must be present.
    expect(prompt).toContain('no bullet-dumping');
    expect(prompt).toContain('Teach, don\'t summarize');
  });

  it('grounds ICT/SMC expertise and welcomes broad trading-world topics', () => {
    const prompt = buildChatPrompt(facts, [], 'מה זה IFVG?', 'he');
    expect(prompt).toContain('DOMAIN EXPERTISE');
    expect(prompt).toContain('IFVG');
    expect(prompt).toContain('SMT divergence');
    // Broadened scope: geopolitics / economic news are explicitly in-scope.
    expect(prompt).toContain('geopolitics');
    // ...but the honesty guardrails still hold.
    expect(prompt).toContain('no live market feed');
  });

  it('carries the professional-precision corrections and CoT output contract', () => {
    const prompt = buildChatPrompt(facts, [], 'מה ההבדל בין BOS ל-CHoCH?', 'he');
    // Precision corrections for the exact mistakes we saw.
    expect(prompt).toContain('PROFESSIONAL PRECISION');
    expect(prompt).toContain('the manipulation leg) is BAIT, not confirmation');
    expect(prompt).toContain('shifts rate-cut/hike expectations'); // NFP mechanism
    expect(prompt).toContain('Correlation is not causation');
    // Chain-of-thought contract: think privately, answer inside <response>.
    expect(prompt).toContain('<thinking>');
    expect(prompt).toContain('<response>');
    // Multi-question handling + banned filler.
    expect(prompt).toContain('answer each one separately under its own short heading');
    expect(prompt).toContain('השוק מורכב ודינמי'); // named as banned filler
  });

  it('frames personal answers as a data investigation, not generic advice', () => {
    const prompt = buildChatPrompt(facts, [], 'האם אני לוקח יותר מדי עסקאות?', 'he');
    // Must forbid the generic "go check the data" cop-out and demand confidence tiers.
    expect(prompt).toContain('צריך לבדוק את הנתונים');           // named as a thing NOT to say
    expect(prompt).toContain('כרגע אין לי מספיק נתונים כדי לקבוע את זה');
    expect(prompt).toContain('data investigator');
    expect(prompt).toContain('sample size');
  });

  it('bans inventing experience level or unsupported emotional reasons', () => {
    const prompt = buildChatPrompt(facts, [], 'q', 'he');
    expect(prompt).toContain('אתה עדיין בתהליך למידה');          // named as a thing NOT to say
    expect(prompt).toContain('experience level');
    expect(prompt).toContain('recorded emotional state');
  });

  it('forbids Markdown output and inventing macro events', () => {
    const prompt = buildChatPrompt(facts, [], 'q', 'he');
    expect(prompt).toContain('PLAIN TEXT');
    expect(prompt).toContain('never write **like this**');
    expect(prompt).toContain('NEVER invent a macro event');
  });

  it('injects the real macro-events block when one is provided', () => {
    const macro = 'TODAY (2026-07-09, Israel time):\n• 15:30 — HIGH · USD · CPI m/m';
    const prompt = buildChatPrompt(facts, [], 'אילו דוחות חשובים היום?', 'he', macro);
    expect(prompt).toContain(macro);
    expect(prompt).toContain('Israel time');
  });

  it('is honest when no macro data is loaded', () => {
    const prompt = buildChatPrompt(facts, [], 'מה יש היום?', 'he');
    expect(prompt).toContain("live economic calendar couldn't be loaded");
  });

  it('weaves in a personal-overlap hint when provided', () => {
    const prompt = buildChatPrompt(facts, [], 'כדאי לסחור היום?', 'he', 'some macro', 'CPI overlaps your weakest session');
    expect(prompt).toContain('CPI overlaps your weakest session');
  });

  it('falls back to an explicit no-data note when the facts block is empty', () => {
    const prompt = buildChatPrompt('', [], 'מה זה FVG?', 'he');
    expect(prompt).toContain('No journal data available for this trader yet');
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
