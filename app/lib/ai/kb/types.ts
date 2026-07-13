// ─────────────────────────────────────────────────────────────────────────────
// Onyx Knowledge Base — structured, book-depth knowledge per trading concept.
// This is Layer 1: instead of relying on the model's rough recollection, the
// coach retrieves the exact entries for the concepts a question touches and is
// handed authoritative definitions to teach from. Plain typed data modules — no
// DB, no embeddings ($0). Retrieval is keyword + alias matching plus one hop
// across the `related` graph edges (see kb/index.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type KbCategory = 'ict' | 'macro' | 'risk' | 'psychology' | 'strategy';

export interface KbEntry {
  /** Stable id, kebab-case (e.g. 'fvg'). Referenced by other entries' `related`. */
  id: string;
  /** Human title shown in the rendered block. */
  title: string;
  /** Terms (English + Hebrew) that should match this entry in a question. */
  aliases: string[];
  category: KbCategory;
  /** Precise definition — the authoritative one, never shallow. */
  definition: string;
  /** Why it happens (the mechanism). */
  why: string;
  /** When you use / rely on it. */
  whenUse: string;
  /** When it does NOT apply / when to avoid leaning on it. */
  whenAvoid: string;
  /** The common mistake traders make about it. */
  mistakes: string;
  /** A concrete example. */
  example: string;
  /** ids of directly related concepts — the graph edges pulled in on retrieval. */
  related: string[];
}
