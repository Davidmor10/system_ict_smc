// ─────────────────────────────────────────────────────────────────────────────
// The built-in notebook templates are dropped straight into a contenteditable
// that the trader then types into, which puts two requirements on the HTML that
// nothing else in the app has:
//
//   1. One block per line, with the blank answer lines already present — so a
//      question is filled by clicking and typing, and Enter splits the block
//      the caret is in rather than merging two questions into one paragraph.
//   2. Latin runs isolated. "Max loss ליום" in an RTL block is a bidi problem:
//      the browser reorders the Latin against the surrounding Hebrew and the
//      trader reads "ליום Max loss". dir="ltr" on an INLINE span fixes the
//      ordering without touching alignment — the same attribute on a block
//      would flip the whole line.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '../../app/lib/notebook/store';

/** Latin letter runs that are not already inside a dir="ltr" span. */
function unisolatedLatin(html: string): string[] {
  const withoutIsolated = html.replace(/<span dir="ltr">.*?<\/span>/g, '');
  const stripped = withoutIsolated.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  return stripped.match(/[A-Za-z][A-Za-z .&-]{1,}/g) ?? [];
}

describe('built-in notebook templates', () => {
  it('ships the four the trader works from', () => {
    expect(BUILTIN_TEMPLATES.map(t => t.id)).toEqual(['pre-post', 'pre', 'post', 'all']);
    expect(BUILTIN_TEMPLATES.every(t => t.builtin)).toBe(true);
  });

  for (const tpl of BUILTIN_TEMPLATES) {
    describe(tpl.name, () => {
      it('isolates every Latin run so RTL cannot reorder it', () => {
        expect(unisolatedLatin(tpl.html)).toEqual([]);
      });

      it('gives every question its own blank line to answer on', () => {
        const questions = (tpl.html.match(/<h3>/g) ?? []).length;
        const blanks    = (tpl.html.match(/<p><br><\/p>/g) ?? []).length;
        expect(questions).toBeGreaterThan(0);
        expect(blanks).toBeGreaterThanOrEqual(questions);
      });

      it('opens each line as its own block, never as a run of <br>', () => {
        // Two <br> in a row is the shape that makes Enter merge lines and
        // leaves the trader nudging text around instead of writing.
        expect(tpl.html).not.toMatch(/<br>\s*<br>/);
      });

      it('closes every tag it opens', () => {
        for (const tag of ['h2', 'h3', 'p', 'span']) {
          const open  = (tpl.html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
          const close = (tpl.html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
          expect(`${tag}:${open}`).toBe(`${tag}:${close}`);
        }
      });
    });
  }

  it('asks the post-session questions in the order the trader set', () => {
    const post = BUILTIN_TEMPLATES.find(t => t.id === 'post')!.html;
    const order = [...post.matchAll(/<h3>(\d)\. ([^<]*)/g)].map(m => m[2].trim());
    expect(order[0]).toContain('עקבתי אחרי תוכנית המסחר');
    expect(order[1]).toContain('מה עבד טוב');
    // The observation comes before the correction: "what would I change"
    // answers "what went wrong", so it has to follow it.
    expect(order[2]).toContain('רגשיות');
    expect(order[3]).toContain('מה הייתי משנה');
  });

  it('keeps the pre-market five, with the mental-state prompt', () => {
    const pre = BUILTIN_TEMPLATES.find(t => t.id === 'pre')!.html;
    expect((pre.match(/<h3>/g) ?? []).length).toBe(5);
    expect(pre).toContain('Watchlist');
    expect(pre).toContain('Max loss');
    expect(pre).toContain('מצב מנטלי ופוקוס');
  });
});
