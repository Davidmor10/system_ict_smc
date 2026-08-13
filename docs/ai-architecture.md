# The two AI stacks, and who owns which claim

Onyx analyses the same trades twice, through two independent stacks. That is a
deliberate arrangement, not an accident of history — but it has one specific
failure mode, and this document exists to name it and to say how it is
prevented.

## The failure mode

Both stacks look at the same trades and both speak to the same trader on the
same screen. The thing that must never happen is the dashboard announcing an
edge on the morning the daily insight says there is not enough data yet.

That contradiction is invisible in code review, because each side is
individually reasonable. It is perfectly visible to the trader, and when it
happens both surfaces lose their credibility at once — not just the one that
was wrong.

## What each stack owns

**`lib/intelligence` + `lib/ai` — what the trader's history looks like.**

Pattern discovery, the rolling trader profile, the edge hypothesis, the Edge
and Learning scores, the weekly narrative. Descriptive. It answers *where do
this trader's results concentrate*, and its claims are about groups of trades.

Surfaces: the personalized insights panel, "מה באמת עובד לך", the weekly
report, the coach chat's factual context.

**`lib/coach-pipeline` — what the trader does, and whether it changes.**

Behaviour detection against the plan, trigger analysis, evidence tiers,
confidence, the lifecycle, experiments and their guardrails, cross-run memory.
Prescriptive, and the only stack allowed to propose a change and measure it.

Surfaces: the daily insight card and its question.

## The rules that keep them consistent

**One significance test.** `lib/stats/fisher.ts`. Both stacks correct for
multiple comparisons; neither is allowed to present an uncorrected slice as a
finding. The pattern engine ran without this for its entire life — see the
commit that added it for what that produced.

**One set of sample floors.** `lib/stats/evidence.ts`. `MIN_DECIDED_FOR_CLAIM`
is the bar for a pattern's significance, for naming a root-cause mechanism, and
for the behaviour layer's `investigating` step. A number that means the same
thing in two places is defined once.

**One rule about cause.** Neither stack may tell a trader *why* they do
something. `lib/intelligence/rootCause.ts` labels a mechanism from metrics and
requires a real sample to do it; the behaviour layer caps every explanation at
the `possible` tier. Trade data can establish where a behaviour concentrates.
It cannot establish why, and that gap is the trader's to close.

**One output check.** `lib/coach-pipeline/quality/insightCheck.ts` runs on the
daily insight. The legacy phrasing prompts carry the same prohibitions in
prose but are not yet mechanically checked — the obvious next consolidation.

## If you are consolidating

The behaviour layer is the newer and stricter design, and the direction of
travel is toward it: explicit denominators, an evidence tier on every
statement, a lifecycle instead of a score, and memory across runs. Anything
moved out of `lib/intelligence` should arrive there with those properties, not
without them.

Do not merge them by deleting the descriptive stack. "Where do my results
concentrate" is a real question that the behaviour layer does not answer.
