import { describe, expect, it } from 'vitest';
import {
  deterministicEntryUuid,
  htmlToText,
  sha256Hex,
} from '../../app/lib/coach-pipeline/mirror/notebookToIntelligence';

// ═══════════════════════════════════════════════════════════════════════════
// deterministicEntryUuid
// ═══════════════════════════════════════════════════════════════════════════

describe('deterministicEntryUuid', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('produces a canonical uuid layout', () => {
    expect(deterministicEntryUuid('user_a', 'entry-1')).toMatch(UUID_RE);
  });

  it('is stable — the same entry always maps to the same row', () => {
    const a = deterministicEntryUuid('user_a', 'entry-1');
    const b = deterministicEntryUuid('user_a', 'entry-1');
    expect(a).toBe(b);
  });

  it('separates entries within one user', () => {
    expect(deterministicEntryUuid('user_a', 'entry-1'))
      .not.toBe(deterministicEntryUuid('user_a', 'entry-2'));
  });

  // The tenant is inside the hash, so two users sharing a client-side entry id
  // — which is likely, since those ids are generated per-device — must never
  // resolve to the same row.
  it('separates the same entry id across users', () => {
    expect(deterministicEntryUuid('user_a', 'entry-1'))
      .not.toBe(deterministicEntryUuid('user_b', 'entry-1'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// htmlToText — what gets embedded, and what the model reads
// ═══════════════════════════════════════════════════════════════════════════

describe('htmlToText', () => {
  it('strips tags', () => {
    expect(htmlToText('<p>hello <b>world</b></p>')).toBe('hello world');
  });

  it('keeps paragraph structure as blank lines', () => {
    // The chunker splits on \n\n, so losing this would merge unrelated
    // paragraphs into one chunk.
    const out = htmlToText('<p>first</p><p>second</p>');
    expect(out).toBe('first\n\nsecond');
  });

  it('turns <br> into a newline', () => {
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });

  it('marks list items so they survive as a list', () => {
    expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
  });

  it('decodes the entities the editor emits', () => {
    expect(htmlToText('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b');
    expect(htmlToText('<p>&lt;tag&gt;</p>')).toBe('<tag>');
    expect(htmlToText('<p>it&#39;s &quot;fine&quot;</p>')).toBe(`it's "fine"`);
  });

  it('handles Hebrew unchanged', () => {
    expect(htmlToText('<p>רדפתי אחרי הפסד היום</p>')).toBe('רדפתי אחרי הפסד היום');
  });

  it('collapses runaway blank lines', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('returns empty for markup with no text', () => {
    expect(htmlToText('<p></p><br><div></div>')).toBe('');
  });

  it('is empty-safe', () => {
    expect(htmlToText('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sha256Hex — the change detector that decides whether we pay to re-embed
// ═══════════════════════════════════════════════════════════════════════════

describe('sha256Hex', () => {
  it('is 64 hex chars', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable, so an unchanged entry never re-embeds', () => {
    expect(sha256Hex('same body')).toBe(sha256Hex('same body'));
  });

  it('changes on an edit, so a changed entry always re-embeds', () => {
    expect(sha256Hex('body')).not.toBe(sha256Hex('body '));
  });
});
