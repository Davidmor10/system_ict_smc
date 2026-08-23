// ─────────────────────────────────────────────────────────────────────────────
// The notebook's confirm dialog renders its message as HTML.
//
// That is fine for the `<b>` the message templates add themselves, and not fine
// for the folder / tag / entry / template names interpolated between them —
// those are typed by the trader. A folder named `<img src=x onerror=…>` used to
// execute the moment its delete dialog opened, and because the notebook syncs
// across devices, it executed again on each one.
//
// Same shape as the daily-insight renderer: escape everything, then allow back
// a fixed, tiny set. Never strip what looks dangerous.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { boldOnly } from '../../app/components/NotebookView';

describe('boldOnly', () => {
  it('keeps the bold the message templates add', () => {
    expect(boldOnly('התיקייה <b>📁 מסחר</b> תימחק.')).toBe('התיקייה <b>📁 מסחר</b> תימחק.');
  });

  it('neutralises a script payload in a name the trader typed', () => {
    const msg = 'התיקייה <b><img src=x onerror=alert(1)></b> תימחק.';
    const out = boldOnly(msg);
    expect(out).toContain('<b>');                    // the template's own tag survives
    expect(out).not.toContain('<img');               // the payload does not
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('neutralises a closing-tag break-out', () => {
    const out = boldOnly('התגית <b></b><script>alert(1)</script></b> תוסר.');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes quotes, so an attribute cannot be closed either', () => {
    const out = boldOnly(`<b>a" onmouseover="alert(1)</b>`);
    expect(out).not.toContain('onmouseover="');
    expect(out).toContain('&quot;');
  });

  it('escapes ampersands first, so an entity cannot be smuggled in', () => {
    // &lt;b&gt; typed by the trader must stay visible text, not become a tag.
    expect(boldOnly('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });

  it('leaves ordinary Hebrew text untouched', () => {
    const msg = 'הרשומה <b>סיכום יום שלישי</b> תימחק לצמיתות.';
    expect(boldOnly(msg)).toBe(msg);
  });
});
