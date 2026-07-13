// Hybrid retrieval over the knowledge base: match the question against entry
// aliases (weighted by specificity), take the top matches, then pull in their
// directly-related neighbors (one hop across the concept graph). Only the
// retrieved entries are injected into the prompt — never the whole KB — so the
// coach gets book-depth on exactly the concepts a question touches. Pure, $0.

import type { KbEntry } from './types';
import { ICT_ENTRIES } from './ict';

const ALL: KbEntry[] = [...ICT_ENTRIES];
const BY_ID = new Map(ALL.map(e => [e.id, e]));

/** Longer aliases are more specific, so they score higher; a 2-letter acronym
    match is worth less than a full phrase match. */
function aliasWeight(alias: string): number {
  return Math.max(1, Math.min(3, Math.ceil(alias.length / 4)));
}

function scoreEntry(entry: KbEntry, haystack: string): number {
  let s = 0;
  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    if (a && haystack.includes(a)) s += aliasWeight(a);
  }
  return s;
}

/** Returns the entries relevant to a question: the top `max` direct matches
    plus up to 2 related neighbors, deduped. Empty when nothing matches. */
export function retrieveKnowledge(question: string, max = 3): KbEntry[] {
  const haystack = ` ${question.toLowerCase()} `;
  const scored = ALL
    .map(e => ({ e, s: scoreEntry(e, haystack) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return [];

  const primary = scored.slice(0, max).map(x => x.e);
  const picked = new Map<string, KbEntry>(primary.map(e => [e.id, e]));
  const neighborCap = picked.size + 2;
  for (const e of primary) {
    for (const rid of e.related) {
      if (picked.size >= neighborCap) break;
      const n = BY_ID.get(rid);
      if (n && !picked.has(n.id)) picked.set(n.id, n);
    }
  }
  return [...picked.values()];
}

/** Renders retrieved entries into an authoritative prompt block. The coach is
    told to teach FROM these (weaving them into prose), not to dump the fields. */
export function renderKnowledge(entries: KbEntry[]): string {
  if (entries.length === 0) return '';
  const blocks = entries.map(e =>
    `### ${e.title}\n` +
    `Definition: ${e.definition}\n` +
    `Why it happens: ${e.why}\n` +
    `When to use: ${e.whenUse}\n` +
    `When NOT to rely on it: ${e.whenAvoid}\n` +
    `Common mistake: ${e.mistakes}\n` +
    `Example: ${e.example}` +
    (e.related.length ? `\nRelated concepts: ${e.related.join(', ')}` : ''),
  );
  return 'AUTHORITATIVE KNOWLEDGE — for the concepts this question touches. Use these exact, correct definitions and teach from them; they override any vaguer recollection. Do NOT dump these fields as a list — weave the relevant parts into a natural mentor explanation:\n\n' + blocks.join('\n\n');
}

export type { KbEntry } from './types';
export { ALL as KB_ENTRIES };
