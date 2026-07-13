import { describe, expect, it } from 'vitest';
import { buildChatPrompt } from '../../app/lib/ai/chatPrompt';
import { ICT_SMC_EXPERTISE, TRADING_PRECISION } from '../../app/lib/ai/styleGuide';

// Regression guards: prove the corrected definitions stay in the prompt and the
// old shallow/wrong habits can't silently creep back. These fail loudly if
// someone edits the prompt back toward the mistakes real testing surfaced.
const prompt = buildChatPrompt('OVERALL: 30 trades, winRate 60%', [], 'שאלה', 'he');

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
    expect(prompt).toContain('THE REAL QUESTION');
    expect(prompt).toContain('BENEATH the surface');
    expect(prompt).toContain('answers the deeper question');
  });

  it('Rule B: self-check the answer and rewrite it if any check fails', () => {
    expect(prompt).toContain('SELF-CHECK');
    expect(prompt).toContain('rewrite it before you output');
    expect(prompt).toContain('debunk a common mistake');
    expect(prompt).toContain('does it TEACH rather than just define');
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
