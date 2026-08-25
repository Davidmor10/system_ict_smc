<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# The AI stacks

Onyx analyses the same trades through two independent stacks — `lib/intelligence`
(descriptive: patterns, profile, scores, weekly narrative) and
`lib/coach-pipeline` (prescriptive: behaviour, evidence tiers, experiments).

Before changing anything that produces a claim shown to a trader, read
`docs/ai-architecture.md`. It says who owns which claim and which rules keep
the two from contradicting each other on the same screen.

Two of those rules are load-bearing enough to repeat here:

- Any group compared against another goes through `lib/stats/fisher.ts` and is
  corrected for the number of comparisons made. Pattern discovery slices a
  history roughly a hundred ways; at that count, uncorrected slices clear any
  win-rate gap by chance, for every trader, every run.
- Sample floors come from `lib/stats/evidence.ts`, not from a local constant.
