import { describe, expect, it } from 'vitest';
import {
  chunkBody,
  CHUNK_TARGET_TOKENS,
  CHUNK_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  __internals,
} from '../../app/lib/coach-pipeline/chunker';
import { countTokens } from '../../app/lib/coach-pipeline/tokens';

const { splitStructural, splitSentence, splitHard, packAtoms, tailByTokens, withOverlap } = __internals;

// ── Empty / trivial input ───────────────────────────────────────────────────
describe('chunkBody — empty and small inputs', () => {
  it('returns [] for empty string', () => {
    expect(chunkBody('')).toEqual([]);
  });

  it('returns [] for whitespace-only', () => {
    expect(chunkBody('   \n\n\t  ')).toEqual([]);
  });

  it('returns one chunk for short body', () => {
    const chunks = chunkBody('This is a short journal note about the London session.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('This is a short journal note about the London session.');
    expect(chunks[0].token_count).toBeGreaterThan(0);
  });
});

// ── Stage 1 — structural split ──────────────────────────────────────────────
describe('splitStructural', () => {
  it('splits on markdown headings', () => {
    const text = '## Morning plan\nA\n\n## Recap\nB';
    const parts = splitStructural(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('## Morning plan');
    expect(parts[1]).toContain('## Recap');
  });

  it('splits on paragraph breaks (\\n\\n) when no headings', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird.';
    expect(splitStructural(text)).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'Third.',
    ]);
  });

  it('drops empty segments', () => {
    const text = 'A\n\n\n\nB';
    expect(splitStructural(text)).toEqual(['A', 'B']);
  });

  it('keeps a bulleted list as one paragraph (single \\n between items)', () => {
    const text = '- item 1\n- item 2\n- item 3';
    expect(splitStructural(text)).toEqual([text]);
  });
});

// ── Stage 2 — sentence split ────────────────────────────────────────────────
describe('splitSentence', () => {
  it('splits on . ! ? followed by whitespace', () => {
    const text = 'First sentence. Second sentence! Third? Fourth.';
    expect(splitSentence(text)).toEqual([
      'First sentence.', 'Second sentence!', 'Third?', 'Fourth.',
    ]);
  });

  it('keeps punctuation with the sentence it belongs to', () => {
    expect(splitSentence('Hello. World.')[0]).toBe('Hello.');
  });

  it('works with Hebrew text', () => {
    const text = 'זה משפט ראשון. וזה משפט שני!';
    const parts = splitSentence(text);
    expect(parts).toHaveLength(2);
    expect(parts[0].endsWith('.')).toBe(true);
  });
});

// ── Stage 3 — hard split ────────────────────────────────────────────────────
describe('splitHard', () => {
  it('splits a very long run of words into chunks near target', () => {
    const words = Array.from({ length: 3000 }, () => 'word').join(' ');
    const parts = splitHard(words, CHUNK_TARGET_TOKENS);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(countTokens(p)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
  });

  it('never breaks in the middle of a word', () => {
    const words = 'antidisestablishmentarianism '.repeat(200).trim();
    const parts = splitHard(words, CHUNK_TARGET_TOKENS);
    for (const p of parts) {
      // Every space-separated token should be the intact word.
      expect(p.trim().split(/\s+/).every(w => w === 'antidisestablishmentarianism')).toBe(true);
    }
  });
});

// ── Packing ─────────────────────────────────────────────────────────────────
describe('packAtoms', () => {
  it('merges small atoms up to target', () => {
    const atoms = ['A short line.', 'Another short line.', 'Yet another.'];
    const chunks = packAtoms(atoms);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('A short line.');
    expect(chunks[0]).toContain('Yet another.');
  });

  it('starts a new chunk when target would be exceeded', () => {
    const big = 'word '.repeat(500).trim();   // ~215 tokens
    const chunks = packAtoms([big, big, big]);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ── Overlap ─────────────────────────────────────────────────────────────────
describe('tailByTokens', () => {
  it('returns the last N tokens without breaking words', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta';
    const tail = tailByTokens(text, 3);
    expect(tail).not.toContain('alpha');
    expect(tail.split(/\s+/).length).toBeGreaterThan(0);
    // Every word in tail must appear in the original.
    for (const w of tail.split(/\s+/)) expect(text).toContain(w);
  });

  it('returns empty string for empty input', () => {
    expect(tailByTokens('', 50)).toBe('');
  });
});

describe('withOverlap', () => {
  it('does nothing for a single chunk', () => {
    expect(withOverlap(['only one'])).toEqual(['only one']);
  });

  it('prepends prev-tail to every chunk after the first', () => {
    const chunks = ['alpha beta gamma delta epsilon', 'zeta eta theta iota'];
    const out = withOverlap(chunks);
    expect(out[0]).toBe('alpha beta gamma delta epsilon');
    // Second chunk starts with some words from the end of the first.
    expect(out[1].startsWith('zeta')).toBe(false);
  });
});

// ── End-to-end ──────────────────────────────────────────────────────────────
describe('chunkBody — realistic', () => {
  it('journal with 3 sections becomes ≥3 chunks and each is under MAX', () => {
    const body = [
      '## Morning plan',
      'Watching London open for a sweep of Asian range highs. NQ has bias down.',
      '',
      '## Trade 1 — SMT on ES',
      Array.from({ length: 500 }, () => 'analysis').join(' '),   // huge middle section
      '',
      '## Post-session',
      'Discipline held. No revenge after the first stop-out.',
    ].join('\n\n');
    const chunks = chunkBody(body);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      // Cap can be exceeded slightly by overlap prepending — allow +CHUNK_OVERLAP margin.
      expect(c.token_count).toBeLessThanOrEqual(CHUNK_MAX_TOKENS + CHUNK_OVERLAP_TOKENS + 20);
    }
  });

  it('all chunks have a positive token_count', () => {
    const body = 'A. B. C. D. E. F. G. H.'.repeat(50);
    for (const c of chunkBody(body)) {
      expect(c.token_count).toBeGreaterThan(0);
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('chunk contents are ordered — appear in body order', () => {
    const body = 'Alpha section here.\n\nBeta section here.\n\nGamma section here.';
    const chunks = chunkBody(body);
    const joined = chunks.map(c => c.content).join(' ');
    // All three markers appear in order.
    expect(joined.indexOf('Alpha')).toBeLessThan(joined.indexOf('Beta'));
    expect(joined.indexOf('Beta')).toBeLessThan(joined.indexOf('Gamma'));
  });
});
