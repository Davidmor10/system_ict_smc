// ─────────────────────────────────────────────────────────────────────────────
// Chunker — turns a notebook entry's body into a list of chunks ready to be
// embedded and stored in notebook_chunks. Pure — no I/O, no network.
//
// Algorithm (three-stage cascade — go finer only when needed):
//   1. STRUCTURAL: split on markdown headings (## …), then paragraph breaks
//      (\n\n). Whole paragraphs are the smallest unit we prefer to keep intact.
//   2. SENTENCE: if a paragraph is still bigger than CHUNK_MAX_TOKENS, split
//      it on sentence boundaries ([.!?] followed by whitespace/newline).
//   3. HARD: if a single "sentence" is bigger than CHUNK_MAX_TOKENS (rare —
//      wall-of-text without punctuation), hard-split on word boundaries every
//      CHUNK_TARGET_TOKENS.
//
// After atoms are produced, they are greedily PACKED into chunks up to
// CHUNK_TARGET_TOKENS. Each chunk (except the first) then gets CHUNK_OVERLAP
// tokens of the previous chunk prepended, so meaning that straddles a chunk
// boundary is still retrievable.
// ─────────────────────────────────────────────────────────────────────────────

import { countTokens } from './tokens';

export const CHUNK_TARGET_TOKENS  = 400;
export const CHUNK_MAX_TOKENS     = 500;
export const CHUNK_OVERLAP_TOKENS = 50;

export interface Chunk {
  content:     string;
  token_count: number;
}

// ── Stage 1 — structural split ──────────────────────────────────────────────

/** Split on markdown headings and paragraph breaks. Preserves the heading
 *  line with its section (so `## Morning plan\n...` stays as one atom of
 *  "the plan"). Empty segments are dropped. */
function splitStructural(text: string): string[] {
  // Split on markdown headings but keep the heading with its section.
  const headingRe = /(?=^#{1,6}\s)/m;
  const bySection = text.split(headingRe);

  const paragraphs: string[] = [];
  for (const section of bySection) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    // Paragraph break = two or more newlines. Single newlines stay inside
    // the paragraph (a bulleted list is one paragraph, not many).
    for (const p of trimmed.split(/\n{2,}/)) {
      const t = p.trim();
      if (t) paragraphs.push(t);
    }
  }
  return paragraphs;
}

// ── Stage 2 — sentence split ────────────────────────────────────────────────

/** Split a long paragraph into sentences. Uses `[.!?]` followed by whitespace
 *  as the boundary. Question marks and exclamations mid-sentence would be a
 *  false positive, but for journal writing this heuristic is more than good
 *  enough. Preserves each sentence's trailing punctuation. Hebrew works the
 *  same — punctuation is Latin. */
function splitSentence(text: string): string[] {
  // Split but keep the delimiter attached to the sentence it ends.
  const parts = text.split(/(?<=[.!?])[\s\n]+/);
  return parts.map(p => p.trim()).filter(Boolean);
}

// ── Stage 3 — hard split ────────────────────────────────────────────────────

/** Hard-split by words when a single segment blows past CHUNK_MAX_TOKENS. We
 *  build chunks of roughly `target` tokens by summing word-lengths. Words are
 *  never broken. */
function splitHard(text: string, target: number): string[] {
  const words = text.split(/(\s+)/);   // keep spaces so joining round-trips
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufTok = 0;
  for (const w of words) {
    const wt = countTokens(w);
    if (bufTok + wt > target && buf.length > 0) {
      chunks.push(buf.join('').trim());
      buf = [];
      bufTok = 0;
    }
    buf.push(w);
    bufTok += wt;
  }
  if (buf.length) chunks.push(buf.join('').trim());
  return chunks.filter(Boolean);
}

// ── Atoms — smallest units that will never be broken further ────────────────

/** Feed the cascade: structural → sentence → hard, yielding atoms all
 *  guaranteed to be <= CHUNK_MAX_TOKENS. */
function toAtoms(text: string): string[] {
  const out: string[] = [];
  for (const para of splitStructural(text)) {
    if (countTokens(para) <= CHUNK_MAX_TOKENS) { out.push(para); continue; }
    for (const sent of splitSentence(para)) {
      if (countTokens(sent) <= CHUNK_MAX_TOKENS) { out.push(sent); continue; }
      for (const piece of splitHard(sent, CHUNK_TARGET_TOKENS)) out.push(piece);
    }
  }
  return out;
}

// ── Packing atoms into chunks ───────────────────────────────────────────────

/** Greedily pack atoms into chunks up to target size. Preserves atom order.
 *  Two adjacent short atoms are joined with a blank line (paragraph break)
 *  so the reader can still tell where one ended. */
function packAtoms(atoms: string[]): string[] {
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufTok = 0;
  for (const a of atoms) {
    const at = countTokens(a);
    if (bufTok + at > CHUNK_TARGET_TOKENS && buf.length > 0) {
      chunks.push(buf.join('\n\n'));
      buf = [];
      bufTok = 0;
    }
    buf.push(a);
    bufTok += at;
  }
  if (buf.length) chunks.push(buf.join('\n\n'));
  return chunks;
}

// ── Overlap ─────────────────────────────────────────────────────────────────

/** Take the last ~n tokens of `text`, split on word boundaries so we never
 *  slice mid-word. Returns '' when the text is shorter than n tokens. */
function tailByTokens(text: string, n: number): string {
  if (!text) return '';
  const words = text.split(/(\s+)/);
  const acc: string[] = [];
  let tok = 0;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const w = words[i];
    const wt = countTokens(w);
    if (tok + wt > n) break;
    acc.unshift(w);
    tok += wt;
  }
  return acc.join('').trim();
}

/** Prepend a summary of the previous chunk's tail to each subsequent chunk. */
function withOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  const out = [chunks[0]];
  for (let i = 1; i < chunks.length; i += 1) {
    const tail = tailByTokens(chunks[i - 1], CHUNK_OVERLAP_TOKENS);
    out.push(tail ? `${tail}\n\n${chunks[i]}` : chunks[i]);
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Turn an entry body into ordered chunks ready for embedding + storage.
 *  Returns an empty array for whitespace-only input — caller decides whether
 *  to skip embedding for such entries. */
export function chunkBody(body: string): Chunk[] {
  if (!body || !body.trim()) return [];
  const atoms  = toAtoms(body);
  const packed = packAtoms(atoms);
  const final  = withOverlap(packed);
  return final.map(c => ({ content: c, token_count: countTokens(c) }));
}

// ── Exports for tests ───────────────────────────────────────────────────────
export const __internals = {
  splitStructural, splitSentence, splitHard,
  toAtoms, packAtoms, tailByTokens, withOverlap,
};
