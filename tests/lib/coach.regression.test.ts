import { describe, expect, it } from 'vitest';
import { buildChatPrompt } from '../../app/lib/ai/chatPrompt';
import { ICT_SMC_EXPERTISE, TRADING_PRECISION } from '../../app/lib/ai/styleGuide';

// Regression guards: prove the corrected definitions stay in the prompt and the
// old shallow/wrong habits can't silently creep back. These fail loudly if
// someone edits the prompt back toward the mistakes real testing surfaced.
// Build with both technical + macro flags so the domain blocks these guards
// assert on are actually injected (the router gates them per-question now).
const prompt = buildChatPrompt('OVERALL: 30 trades, winRate 60%', [], 'שאלה', 'he', '', '', '', ['SMC_TECHNICAL', 'MACRO_NEWS']);

describe('coach prompt — professional-precision regression', () => {
  it('BOS/CHoCH: structure-based, continuation vs first break against — never "just a slowdown"', () => {
    expect(prompt).toContain('both are BREAKS OF STRUCTURE');
    expect(prompt).toContain('confirms CONTINUATION');
    expect(prompt).toContain('FIRST break AGAINST');
    expect(prompt).toContain('momentum slowing'); // named as what CHoCH is NEVER
  });

  it('NFP: the full transmission chain, not "strong economy = stocks up"', () => {
    expect(prompt).toContain('bond yields');
    expect(prompt).toContain('rate-sensitive');
    expect(prompt).toContain('SURPRISE vs expectations');
    expect(prompt).toContain('never "strong data = strong economy = stocks up."');
  });

  it('FVG: quality is context, not volume; alone it is never enough', () => {
    expect(prompt).toContain('FVG QUALITY is context, not volume');
    expect(prompt).toContain('only earns meaning inside that context');
  });

  it('Edge: how to verify it, and what it is NOT', () => {
    expect(prompt).toContain('statistical advantage that recurs');
    expect(prompt).toContain('profit factor');
    expect(prompt).toContain('Edge is NOT a single setup');
  });

  it('Geopolitics: reaction is a change in expectations, priced-in vs surprise', () => {
    expect(prompt).toContain('change in EXPECTATIONS');
    expect(prompt).toContain('priced in');
  });

  it('personal RR investigation + the honest "not enough exit data" line', () => {
    expect(prompt).toContain('did stops widen, did targets shrink');
    expect(prompt).toContain('אני רואה שה-RR ירד, אבל עדיין אין לי מספיק מידע');
  });

  it('"what I don\'t know about you" answers with concrete untracked data, not filler', () => {
    expect(prompt).toContain('answer with a concrete list of untracked data');
  });

  it('general answers follow mechanism→example→common-mistake→practical, no motivational ending', () => {
    expect(prompt).toContain('the common mistake traders make about it');
    expect(prompt).toContain('never on motivation or a call to action');
  });

  it('expanded banned filler list', () => {
    for (const banned of ['תנסה להרוויח יותר', 'תפסיד פחות', 'אתה עדיין בתהליך', 'השוק מורכב ודינמי']) {
      expect(prompt).toContain(banned);
    }
  });
});

describe('coach prompt — mentor behavioral rules', () => {
  it('Rule A: answer the deeper question beneath the surface one', () => {
    expect(prompt).toContain('the real question beneath the words');
  });

  it('Rule B: reason privately and teach — without shipping an echoable scaffold', () => {
    // The reasoning contract must survive (think first, then answer, teach the
    // mechanism), but WITHOUT a verbatim numbered checklist the model can parrot.
    expect(prompt).toContain('Teach and explain the mechanism');
    expect(prompt).toContain('KNOW vs SUSPECT vs CANNOT');
    // Correcting a common mistake is now CONDITIONAL, not a default requirement.
    expect(prompt).toContain('never insert a generic "traders often…" line by default');
  });

  it('Rule C: the private reasoning must never leak into the visible answer', () => {
    expect(prompt).toContain('MUST NEVER appear in the visible answer');
    expect(prompt).toContain('NEVER print your analysis as plain text');
    expect(prompt).toContain('output ONLY the final answer to the trader');
  });
});

describe('coach prompt — no duplicated definitions', () => {
  it('ICT concepts (CHoCH/FVG) are defined only in ICT_SMC_EXPERTISE', () => {
    expect(ICT_SMC_EXPERTISE).toContain('CHoCH');
    expect(ICT_SMC_EXPERTISE).toContain('FVG');
    // The macro/edge block must no longer redefine them (dedup).
    expect(TRADING_PRECISION).not.toContain('CHoCH');
    expect(TRADING_PRECISION).not.toContain('FVG');
  });
});
