import { describe, expect, it } from 'vitest';
import { retrieveKnowledge, renderKnowledge, KB_ENTRIES } from '../../app/lib/ai/kb';
import { buildChatPrompt } from '../../app/lib/ai/chatPrompt';

describe('knowledge base integrity', () => {
  it('has unique ids and every required field filled', () => {
    const ids = new Set<string>();
    for (const e of KB_ENTRIES) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      for (const f of ['title', 'definition', 'why', 'whenUse', 'whenAvoid', 'mistakes', 'example'] as const) {
        expect(e[f].trim().length, `${e.id}.${f}`).toBeGreaterThan(0);
      }
      expect(e.aliases.length).toBeGreaterThan(0);
    }
  });

  it('every related edge points at a real entry (graph is valid)', () => {
    const ids = new Set(KB_ENTRIES.map(e => e.id));
    for (const e of KB_ENTRIES) {
      for (const rid of e.related) expect(ids.has(rid), `${e.id} → ${rid}`).toBe(true);
    }
  });
});

describe('retrieveKnowledge', () => {
  it('matches the concept in a Hebrew question and pulls related neighbors', () => {
    const ids = retrieveKnowledge('מתי FVG נחשב איכותי?').map(e => e.id);
    expect(ids).toContain('fvg');
    // one hop across the graph brings in a directly-related concept
    expect(ids.some(id => ['ifvg', 'displacement', 'premium-discount', 'liquidity', 'sweep'].includes(id))).toBe(true);
  });

  it('retrieves both concepts in a comparison question', () => {
    const ids = retrieveKnowledge('מה ההבדל בין BOS ל-CHoCH?').map(e => e.id);
    expect(ids).toContain('bos');
    expect(ids).toContain('choch');
  });

  it('returns nothing for a question with no known concept', () => {
    expect(retrieveKnowledge('מה השעה עכשיו?')).toEqual([]);
  });
});

describe('renderKnowledge', () => {
  it('renders an authoritative block with the concept fields, or empty', () => {
    expect(renderKnowledge([])).toBe('');
    const block = renderKnowledge(retrieveKnowledge('מה זה SMT?'));
    expect(block).toContain('AUTHORITATIVE KNOWLEDGE');
    expect(block).toContain('SMT Divergence');
    expect(block).toContain('Common mistake:');
    // teach, don't dump
    expect(block).toContain('weave the relevant parts into a natural mentor explanation');
  });
});

describe('buildChatPrompt — knowledge injection', () => {
  it('injects the retrieved knowledge block when provided', () => {
    const kb = renderKnowledge(retrieveKnowledge('מה זה IFVG?'));
    const prompt = buildChatPrompt('OVERALL: 30 trades', [], 'מה זה IFVG?', 'he', '', '', kb);
    expect(prompt).toContain('AUTHORITATIVE KNOWLEDGE');
    expect(prompt).toContain('Inverse Fair Value Gap');
  });
});
