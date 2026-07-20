// Pure output parsing for the Chat Coach. The prompt makes the model think
// privately inside <thinking>…</thinking> and then write only the user-facing
// answer inside <response>…</response>. This pulls out the response, never lets
// the thinking reach the UI, and defensively scrubs any internal prompt label
// the model may have quoted (e.g. "ESTABLISHED FACTS"). No I/O — fully testable.

// The ALL-CAPS section headers used to structure the prompt. The model is told
// never to name them, but a model can still slip — so we strip them from the
// output as a last line of defense. Longest-first so the specific form is
// removed before the generic one. Kept in sync with chatPrompt.ts by intent.
const INTERNAL_LABELS = [
  'ESTABLISHED FACTS ABOUT THIS TRADER',
  'ESTABLISHED FACTS',
  "THE TRADER'S COMPUTED JOURNAL STATISTICS",
  'COMPUTED JOURNAL STATISTICS',
  'CURRENT EDGE HYPOTHESIS',
  'EDGE HYPOTHESIS',
  'REAL SCHEDULED MACRO EVENTS',
  'PERSONAL CONTEXT TO WEAVE IN',
  'RECENT CONVERSATION',
];

const LABEL_ALT = INTERNAL_LABELS
  .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

// A reference clause is an optional "as recorded in …" connector (Hebrew or
// English) directly in front of a label — we remove the whole clause so we
// don't leave a dangling "כפי שנרשם ב-." behind. The label may also appear bare.
const REFERENCE_CONNECTOR =
  '(?:כפי\\s+ש[^,.\\n]{0,24}?ב-?|כמו\\s+ש[^,.\\n]{0,24}?ב-?|כפי\\s+שצוין\\s+ב-?|כמצוין\\s+ב-?|לפי\\s+ה?-?|על\\s+פי\\s+ה?-?|as\\s+(?:recorded|noted|shown|written|listed|described)(?:\\s+in)?(?:\\s+the)?|per\\s+the|according\\s+to\\s+the)';

const CLAUSE_RE = new RegExp(`[,،]?\\s*${REFERENCE_CONNECTOR}\\s*(?:${LABEL_ALT})`, 'gi');
const BARE_RE = new RegExp(`\\s*(?:${LABEL_ALT})`, 'gi');

/** Removes any internal prompt label the model may have quoted, along with the
    "as recorded in …" connector that introduced it, then tidies the seams
    (doubled spaces, space-before-punctuation, dangling connectors). */
export function stripInternalLabels(text: string): string {
  return text
    .replace(CLAUSE_RE, '')
    .replace(BARE_RE, '')
    // Leftover dangling Hebrew reference connectors with nothing after them.
    .replace(/\s*(?:כפי\s+ש\S+\s+ב-|לפי\s+ה-|על\s+פי\s+ה-)\s*(?=[.,\n]|$)/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/([([]) +/g, '$1')
    .trim();
}

// The private-reasoning scaffold. A model that ignores the <thinking>/<response>
// tag contract (weaker chat models do) can print its chain-of-thought as plain
// prose ahead of the answer. These are the structural anchors that reasoning
// uses — if any appears with no <response> tag, a whole thinking block leaked.
const SCAFFOLD_MARKERS = [
  'THE REAL QUESTION', 'CLASSIFY', 'INVESTIGATE', 'SELF-CHECK',
  'Plan the order', 'NEVER shown to the trader',
];

/** Removes a leaked chain-of-thought scaffold. No-op unless a real scaffold
    marker is present (so a legitimate answer that happens to use a numbered
    list is never touched). When a marker IS present, the answer follows the
    reasoning: cut past the last marker to the next paragraph break; failing
    that, drop the marker lines and numbered-step lines individually. */
export function stripLeakedScaffold(text: string): string {
  if (!SCAFFOLD_MARKERS.some(m => text.includes(m))) return text;

  let lastEnd = -1;
  for (const m of SCAFFOLD_MARKERS) {
    const i = text.lastIndexOf(m);
    if (i >= 0) lastEnd = Math.max(lastEnd, i + m.length);
  }
  if (lastEnd >= 0) {
    const after = text.slice(lastEnd);
    const para = after.search(/\n\s*\n/);
    const candidate = (para >= 0 ? after.slice(para) : after.replace(/^[^\n]*(?:\n|$)/, '')).trim();
    if (candidate) return candidate;
  }

  const kept = text
    .split('\n')
    .filter(line => !SCAFFOLD_MARKERS.some(m => line.includes(m)) && !/^\s*\d[.)]\s+/.test(line))
    .join('\n')
    .trim();
  return kept || text;
}

/** The trader must only ever see the final answer. Run BOTH scrubbers on every
    path — each is a no-op when its target isn't present, so this is safe even
    on a cleanly-tagged response. */
function clean(text: string): string {
  return stripInternalLabels(stripLeakedScaffold(text.trim()));
}

/** Return only the <response> body. If the model didn't use the tags (a
    fallback model, or output truncated before the closing tag), degrade
    gracefully to whatever real answer is present — scaffold- and label-scrubbed. */
export function extractResponse(raw: string): string {
  const closed = raw.match(/<response>([\s\S]*?)<\/response>/i);
  if (closed) return clean(closed[1]);
  const open = raw.match(/<response>([\s\S]*)/i); // opened but truncated before close
  if (open) return clean(open[1]);
  // No response tag at all — drop any thinking block, then strip a tag-less
  // scaffold the model may have printed as plain prose before the answer.
  const stripped = raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?(thinking|response)>/gi, '')
    .trim();
  return clean(stripped || raw);
}
