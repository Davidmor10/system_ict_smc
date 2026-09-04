// The journey screen's structural promises.
//
// Three of them do not show up as a type error or a failing render, and each
// one was a real property of the design rather than an implementation detail:
//
//   • opening a page must not advance the trader's behavioural state or spend
//     a model call — the nightly run is the only thing allowed to write;
//   • the strip on the dashboard and the page it links to must read the same
//     endpoint, or the two surfaces will eventually disagree about how many
//     things the trader has changed;
//   • the behaviour review must not be left behind on the analytics page as
//     well as moved, which would be two copies of one panel.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = (...p: string[]) => join(__dirname, '..', '..', 'app', ...p);
const read = (...p: string[]) => readFileSync(app(...p), 'utf8');

const ROUTE   = read('api', 'coach', 'journey', 'route.ts');
const VIEW    = read('components', 'ProgressView.tsx');
const STATE   = read('components', 'TraderSummary.tsx');
const DASH    = read('components', 'DashboardView.tsx');
const ANALYTICS = read('dashboard', 'ai-analytics', 'page.tsx');
const SERVICE = read('lib', 'intelligence', 'service.ts');

describe('the route is read-only', () => {
  // A page load that re-ran the analysis would rewrite the very history the
  // page is drawing, and would bill a model call per refresh.
  it('never lets a page load persist behavioural state', () => {
    expect(ROUTE).toContain('persist: false');
    expect(ROUTE).not.toContain('persist: true');
  });

  it('never refreshes the intelligence as a side effect of a page load', () => {
    expect(ROUTE).not.toContain('refreshIntelligence');
  });

  // Every reader of the intelligence module refreshes as a side effect of
  // being asked; this accessor exists precisely so a screen does not have to.
  it('has a read-only accessor for the scores, even though nothing shows them', () => {
    expect(SERVICE).toContain('export async function getScoreHistory');
    const body = SERVICE.slice(SERVICE.indexOf('export async function getScoreHistory'));
    expect(body.slice(0, 400)).not.toContain('saveTraderProfile');
  });
});

// ── the score that was pulled ───────────────────────────────────────────────
//
// It could not say which habit moved, only that a number had. The engine
// still runs; the surface is gone. These guard against it coming back by
// accident rather than by decision.

describe('the learning score does not reach a browser', () => {
  it('is not in the payload', () => {
    expect(ROUTE).not.toContain('learningTrajectory');
    expect(ROUTE).not.toContain('trajectory');
  });

  it('is not rendered by either surface', () => {
    for (const src of [VIEW, STATE]) {
      expect(src).not.toContain('ציון למידה');
      expect(src).not.toContain('trajectory');
    }
  });

  // Pulled from the UI, kept in the engine — the distinction the request made.
  it('is still computed nightly', () => {
    expect(SERVICE).toContain('computeLearningScore');
  });
});

describe('no factor is scored 50 because it could not be measured', () => {
  const SCORES = read('lib', 'intelligence', 'scores.ts');

  it('returns null and a reason per factor instead', () => {
    expect(SCORES).toContain('missing?: string');
    expect(SCORES).toContain('score: number | null');
  });

  it('redistributes the weight of what it could not read', () => {
    expect(SCORES).toContain('effectiveWeight');
    expect(SCORES).toContain('MIN_MEASURED_WEIGHT');
  });

  // The learning score reading a placeholder's replacement as improvement was
  // the actual harm; it cannot happen if there are no placeholders.
  it('has no neutral fallback left in the factor readings', () => {
    const body = SCORES.slice(SCORES.indexOf('const raw: Record<EdgeFactorKey'), SCORES.indexOf('const keys = Object.keys'));
    expect(body).not.toMatch(/:\s*50\b/);
    expect(body).not.toMatch(/\?\?\s*50\b/);
  });
});

describe('the state panel and the history page cannot disagree', () => {
  it('both read the same endpoint', () => {
    expect(STATE).toContain('/api/coach/journey');
    expect(VIEW).toContain('/api/coach/journey');
  });

  // The counts are computed once, server-side, from one list of findings.
  it('does not recount findings in either surface', () => {
    expect(ROUTE).toContain('countJourney');
    expect(STATE).not.toContain('countJourney');
    expect(VIEW).not.toContain('countJourney');
  });

  it('is what the dashboard renders', () => {
    expect(DASH).toContain('<TraderSummary');
    expect(DASH).not.toContain('TrackingLine');
    expect(DASH).not.toContain('ProgressStrip');
  });
});

// ── what the state panel is not allowed to be ───────────────────────────────
//
// The request that produced it named three shapes to avoid, and each is a
// thing a dashboard panel drifts into on its own.

describe('the state panel makes one claim, not a scoreboard', () => {
  it('shows no score assembled from weights', () => {
    expect(STATE).not.toContain('edgeScore');
    expect(STATE).not.toContain('learningScore');
  });

  // A red dot cannot be argued with; "5 out of 22 opportunities" can. The
  // emoji only — the file's own comment explains why they are absent, and a
  // test that trips on the explanation is testing the wrong thing.
  it('has no traffic-light verdicts', () => {
    for (const light of ['🟢', '🟡', '🔴']) expect(STATE).not.toContain(light);
  });

  // Trade data can establish where a behaviour concentrates, never why —
  // docs/ai-architecture.md makes that a rule, not a preference. The wording
  // lives in the lib now, which is where its tests are.
  it('says out loud what it does not know', () => {
    const LIB = read('lib', 'progress', 'traderSummary.ts');
    expect(LIB).toContain('עוד אין מספיק עסקאות כדי להשוות');
    expect(LIB).toContain('עוד אין מספיק עסקאות מתועדות');
  });

  it('carries the counterweight, so it is not only a problem finder', () => {
    const LIB = read('lib', 'progress', 'traderSummary.ts');
    expect(LIB).toContain('והשינוי החזיק');
  });

  // The trend sentence compares one group of trades against another, which
  // AGENTS.md gates on the shared test and the shared sample floor.
  it('tests the trend instead of asserting it', () => {
    const LIB = read('lib', 'progress', 'traderSummary.ts');
    expect(LIB).toContain('fisherExactTwoSided');
    expect(LIB).toContain('bonferroni');
    expect(LIB).toContain('canSupportClaim');
    // No locally invented floor — AGENTS.md names the file it must come from.
    expect(LIB).not.toMatch(/const MIN_[A-Z_]* = \d/);
  });
});

describe('a relapse is never counted as a success', () => {
  it('is a field of its own on the dashboard, not folded into the changed count', () => {
    expect(STATE).toContain('relapsed: journey.counts.relapsed');
    expect(STATE).toContain('changed: journey.counts.changed');
  });

  it('is its own field on a behaviour row, never folded into the verdict', () => {
    expect(VIEW).toContain('r.relapses > 0');
    expect(VIEW).toContain('חזרה');
  });
});

// ── the weekly review folded into the rows ──────────────────────────────────
//
// It was a panel reporting movement for the whole account. Per row it is the
// same pair the improvement verdict is judged on — the recent window against
// the whole history — so the panel is gone rather than duplicated.

describe('the weekly behaviour panel', () => {
  it('is not a panel anywhere any more', () => {
    expect(VIEW).not.toContain('WeeklyBehaviorReview');
    expect(ANALYTICS).not.toContain('WeeklyBehaviorReview');
    expect(ANALYTICS).not.toContain('WeeklyTabs');
  });

  it('became a per-row trend instead', () => {
    expect(ROUTE).toContain('trendOf');
    expect(VIEW).toContain('TREND_LABELS');
  });

  it('leaves the weekly results panel where it was', () => {
    expect(ANALYTICS).toContain('WeeklyReportPanel');
  });
});

// ── the two stacks stay apart ───────────────────────────────────────────────
//
// docs/ai-architecture.md splits them by the claims they own. The evolution
// axis is an edge hypothesis — the descriptive stack — and it was briefly
// rendered on a behaviour screen, which is the blend the document exists to
// prevent.

describe('the evolution axis belongs to the descriptive stack', () => {
  it('is no longer served by the behaviour route or drawn on the journey', () => {
    expect(ROUTE).not.toContain('getEvolutionTimeline');
    expect(VIEW).not.toContain('evolution');
  });

  it('is on the analytics page, behind its own route', () => {
    expect(ANALYTICS).toContain('EvolutionAxis');
    const AXIS = read('components', 'EvolutionAxis.tsx');
    expect(AXIS).toContain('/api/ai/evolution');
  });
});

describe('the history page stays a history', () => {
  it('keeps the lifecycle and each behaviour’s own process log', () => {
    expect(VIEW).toContain('STATUS_ORDER');
    expect(VIEW).toContain('r.events');
  });

  it('states plainly that it gives no recommendation', () => {
    expect(VIEW).toContain('אין כאן ציון ואין המלצה');
  });
});

// ── every kind gets a row ───────────────────────────────────────────────────
//
// The taxonomy is a closed set of five. A kind that never fired must still
// appear: "the system looked and found nothing" is the only thing that tells a
// trader what is actually being watched, and an absent row says nothing.

describe('the closed set of behaviours is shown in full', () => {
  it('builds a row from the label map rather than from what was stored', () => {
    expect(ROUTE).toContain('Object.keys(BEHAVIOR_LABELS)');
  });

  it('reads the denominator from the fresh pass, so an undetected kind can still state one', () => {
    expect(ROUTE).toContain('fresh?.opportunities');
  });

  // "Nothing found" and "nothing to look at" are different facts, and neither
  // is a compliment.
  it('never turns an undetected row into a clean bill of health', () => {
    const ROWS = read('lib', 'progress', 'rows.ts');
    expect(ROWS).toContain('undetectedNote');
    expect(ROWS).not.toContain('אין בעיה');
  });
});

// ── a problem that is none of the five ──────────────────────────────────────
//
// The trader writes it as a rule and ticks it on the trade form. That data has
// been collected for weeks and only ever ranked into a sentence for the daily
// note. It arrives here as rows of the same shape.

describe('the trader’s own rules get a record too', () => {
  it('is read from the collection the trade form already writes', () => {
    expect(ROUTE).toContain('loadRuleBreaches');
  });

  // Every rule shares one denominator because the form asks once per trade.
  // Counting against all trades would divide by ungraded ones.
  it('counts breaches against the trades the trader actually graded', () => {
    expect(ROUTE).toContain('gradedTrades');
    expect(ROUTE).toContain("stored.get('rule_violation')?.opportunities");
  });

  // The stages mean confirmed against a counter-example and an experiment with
  // guardrails. None of that has run on a self-reported breach.
  it('gives a rule row no lifecycle stage it did not earn', () => {
    const block = ROUTE.slice(ROUTE.indexOf('const ruleRows'), ROUTE.indexOf('rows: sortRows'));
    expect(block).toContain('status: null');
    expect(block).toContain("stage: 'undetected'");
  });

  it('says on the page why those rows stop short of a verdict', () => {
    expect(VIEW).toContain('רק על מה שסימנת בעצמך');
  });

  it('tells a trader with no rules how to raise one', () => {
    expect(VIEW).toContain('/dashboard/rules');
  });
});

// ── the customer's screen must not need a refresh ───────────────────────────
//
// The status card was server-rendered once. The owner decided in the admin
// panel and the customer kept reading "waiting" — after a rejection, sitting
// still for access that was never coming; after an approval, having paid and
// been shown nothing.

describe('a decision reaches the customer on its own', () => {
  const FLOW = read('components', 'checkout', 'CheckoutFlow.tsx');
  const MINE = read('api', 'payment-requests', 'mine', 'route.ts');

  it('polls while a request is pending', () => {
    expect(FLOW).toContain('/api/payment-requests/mine');
    expect(FLOW).toContain('visibilitychange');
  });

  it('stops as soon as there is nothing pending', () => {
    expect(FLOW).toContain('if (!pendingId) return;');
  });

  // A late answer to an older poll must not put a decided request back to
  // pending, and must not adopt a different request's row.
  it('only ever moves the card forward', () => {
    expect(FLOW).toContain("fresh.id === pendingId && fresh.status !== 'pending'");
  });

  // The approval changed the role on the server; a router navigation would
  // carry the payload from before it did.
  it('sends an approved customer in with a full page load', () => {
    expect(FLOW).toContain('href="/dashboard"');
  });

  it('looks the row up by session rather than by a parameter', () => {
    expect(MINE).toContain('latestRequestFor(userId)');
    expect(MINE).not.toContain('params');
  });
});

// ── a payment page with nowhere to send money ───────────────────────────────

describe('the checkout refuses to take a declaration it cannot honour', () => {
  const FLOW = read('components', 'checkout', 'CheckoutFlow.tsx');

  it('says so instead of rendering a dash that looks intentional', () => {
    expect(FLOW).toContain('התשלום במסלול הזה עדיין לא זמין');
  });

  // The number is the owner's personal one. A row printing "—" for it made an
  // unconfigured page look configured, and publishing it at all is a choice.
  it('shows the number only when the owner published one', () => {
    expect(FLOW).toContain('{props.bitNumber && (');
    expect(FLOW).not.toContain("props.bitNumber ?? '—'");
  });

  it('disables the declaration button', () => {
    expect(FLOW).toContain('|| !payable');
  });
});

// ── an approval that failed halfway ─────────────────────────────────────────
//
// The request is marked approved BEFORE the access is granted. When the grant
// failed, the owner was left with a row reading "approved", a customer with
// nothing, and a retry that could only ever return 409 — the row it looked for
// was no longer pending. The only way out was a hand-written SQL statement.

describe('an approval can be run again to repair itself', () => {
  const REQUESTS = read('lib', 'payments', 'requests.ts');
  const DECISION = read('api', 'payment-requests', '[id]', 'decision', 'route.ts');

  it('reports an already-decided row instead of refusing it', () => {
    expect(REQUESTS).toContain('alreadyDecided');
    expect(REQUESTS).toContain("(existing as { status: string }).status !== status");
  });

  // A repeat only repairs the SAME decision. Re-running an approval over a
  // rejection would overturn it silently.
  it('refuses when the stored decision is a different one', () => {
    const block = REQUESTS.slice(REQUESTS.indexOf('const { data: existing }'));
    expect(block).toContain('return { ok: false }');
  });

  it('re-runs the access grant on the repeat', () => {
    expect(DECISION).toContain('renewalStart');
    expect(DECISION).toContain('repaired: decision.alreadyDecided === true');
  });
});

// ── a renewal must not take back paid time ──────────────────────────────────

describe('the approval extends rather than resets', () => {
  const DECISION = read('api', 'payment-requests', '[id]', 'decision', 'route.ts');

  it('reads what the customer still holds before writing a new expiry', () => {
    expect(DECISION).toContain("select('access_until')");
    expect(DECISION).toContain('accessPeriodEnd(');
    expect(DECISION).toContain('renewalStart(');
  });

  it('no longer writes a month from today unconditionally', () => {
    expect(DECISION).not.toContain('accessPeriodEnd().toISOString()');
  });
});

// ── a trade that could not have happened ────────────────────────────────────
//
// It validates the DATE ON THE TRADE, never the clock. Traders write up their
// week at the weekend, and a journal that refused entries exactly when someone
// sits down to catch up is a journal they stop using.

describe('the trade form checks the date, not the hour it is opened', () => {
  const FORM = read('components', 'TradeForm.tsx');

  it('blocks a future date in the picker and by hand', () => {
    expect(FORM).toContain('max={todayISO()}');
    expect(FORM).toContain('dateProblem(form.date, form.time, todayISO())');
  });

  it('stops the save rather than only colouring the field', () => {
    expect(FORM).toContain('dateIssue === null');
  });

  // Nothing here may consult the current time to decide whether the form works.
  it('never gates the form on when it is being used', () => {
    expect(FORM).not.toContain('new Date().getDay()');
    expect(FORM).not.toContain('closureAt(');
  });
});
