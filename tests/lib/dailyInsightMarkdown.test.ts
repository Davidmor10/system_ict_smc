import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  inlineFormat,
  renderInsightMarkdown,
} from '../../app/components/dailyInsightMarkdown';

describe('escapeHtml', () => {
  it('escapes the 5 HTML-hostile characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });
  it('escapes single quotes and ampersands', () => {
    expect(escapeHtml("It's & so")).toBe('It&#39;s &amp; so');
  });
  it('is a no-op on plain text', () => {
    expect(escapeHtml('regular text 123')).toBe('regular text 123');
  });
});

describe('inlineFormat', () => {
  it('converts **bold**', () => {
    expect(inlineFormat('this is **bold** text')).toBe('this is <strong>bold</strong> text');
  });
  it('converts *italic*', () => {
    expect(inlineFormat('this is *italic* text')).toBe('this is <em>italic</em> text');
  });
  it('handles bold and italic in one line', () => {
    expect(inlineFormat('a **b** c *d* e')).toBe('a <strong>b</strong> c <em>d</em> e');
  });
  it('does not eat html injected inside markers', () => {
    expect(inlineFormat('**<img src=x>**')).toBe('<strong>&lt;img src=x&gt;</strong>');
  });
  it('is non-greedy — a runaway ** does not swallow past the next **', () => {
    expect(inlineFormat('a **b** c **d**')).toBe('a <strong>b</strong> c <strong>d</strong>');
  });
  it('leaves an unmatched ** literal', () => {
    expect(inlineFormat('unmatched **and no close')).toBe('unmatched **and no close');
  });
  it('escapes a raw script tag before any transform', () => {
    expect(inlineFormat('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('renderInsightMarkdown', () => {
  it('splits paragraphs on blank lines', () => {
    const md = 'First paragraph.\n\nSecond paragraph.';
    expect(renderInsightMarkdown(md)).toBe(
      '<p>First paragraph.</p><p>Second paragraph.</p>',
    );
  });

  it('drops empty paragraphs from extra blank lines', () => {
    expect(renderInsightMarkdown('A\n\n\n\nB')).toBe('<p>A</p><p>B</p>');
  });

  it('applies inline formatting inside each paragraph', () => {
    const md = 'You had **3 wins**\n\nAnd *one loss*.';
    expect(renderInsightMarkdown(md)).toBe(
      '<p>You had <strong>3 wins</strong></p><p>And <em>one loss</em>.</p>',
    );
  });

  it('is safe against XSS in paragraph text', () => {
    const md = '<img src=x onerror=alert(1)>\n\n**<b>evil</b>**';
    const html = renderInsightMarkdown(md);
    // The dangerous raw markup is escaped — no live <img>, no <b> tag.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // The **...** wraps ESCAPED HTML, not raw markup.
    expect(html).toContain('<strong>&lt;b&gt;evil&lt;/b&gt;</strong>');
  });

  it('returns empty string for empty markdown', () => {
    expect(renderInsightMarkdown('')).toBe('');
    expect(renderInsightMarkdown('   \n\n  ')).toBe('');
  });

  it('preserves single-line paragraphs (no accidental splitting)', () => {
    expect(renderInsightMarkdown('one line only.')).toBe('<p>one line only.</p>');
  });

  it('handles Hebrew content', () => {
    const md = 'היום היה יום ירוק.\n\n**+2R** בסך הכל.';
    expect(renderInsightMarkdown(md)).toBe(
      '<p>היום היה יום ירוק.</p><p><strong>+2R</strong> בסך הכל.</p>',
    );
  });
});
