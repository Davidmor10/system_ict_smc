// ─────────────────────────────────────────────────────────────────────────────
// Tiny, safe subset-markdown renderer for the daily insight card. The insight
// prompt (Step 4) forbids headings / lists / code / emojis, so we only handle
// paragraphs plus inline **bold** and *italic*. Everything else is escaped.
//
// Split from DailyInsightCard.tsx into its own file so it can be unit-tested
// without a full component render — this pair (escape + limited-transform) is
// the one place in the UI where model text turns into markup, so it earns a
// direct test.
// ─────────────────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape first, then re-introduce the small set of allowed formatting tags.
 *  Non-greedy on purpose (`+?`) so a runaway ** later in the paragraph doesn't
 *  swallow half the text. Requires non-empty inside the markers. */
export function inlineFormat(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
}

/** Turn the full markdown body into safe HTML paragraphs. */
export function renderInsightMarkdown(md: string): string {
  const paragraphs = md.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return paragraphs.map(p => `<p>${inlineFormat(p)}</p>`).join('');
}
