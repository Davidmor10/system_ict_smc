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
const STATE   = read('components', 'CurrentState.tsx');
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
    expect(DASH).toContain('<CurrentState />');
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
  // docs/ai-architecture.md makes that a rule, not a preference.
  it('says out loud what it does not know', () => {
    expect(STATE).toContain('unknownLine');
    expect(STATE).toContain('לא ממצא לטובתך ולא לרעתך');
  });

  it('carries the counterweight, so it is not only a problem finder', () => {
    expect(STATE).toContain('כבר השתנו והחזיקו');
  });
});

describe('a relapse is never counted as a success', () => {
  it('is a field of its own on the panel, not folded into the changed count', () => {
    expect(STATE).toContain('counts.relapsed');
    expect(STATE).toContain('counts.changed');
  });

  it('is stated on the page for a behaviour that came back', () => {
    expect(VIEW).toContain('relapses');
    expect(VIEW).toContain('אחרי שנסגרה');
  });
});

describe('the behaviour review moved rather than being copied', () => {
  it('is on the journey page', () => {
    expect(VIEW).toContain('WeeklyBehaviorReview');
  });

  it('is no longer a buried tab on the analytics page', () => {
    expect(ANALYTICS).not.toContain('WeeklyTabs');
    expect(ANALYTICS).not.toContain('WeeklyBehaviorReview');
  });

  it('leaves the weekly results panel where it was', () => {
    expect(ANALYTICS).toContain('WeeklyReportPanel');
  });
});

describe('the history page stays a history', () => {
  it('keeps the lifecycle, the evolution axis and the process log', () => {
    expect(VIEW).toContain('STATUS_ORDER');
    expect(VIEW).toContain('ציר ההתפתחות');
    expect(VIEW).toContain('יומן התהליך');
  });

  it('states plainly that it gives no recommendation', () => {
    expect(VIEW).toContain('אין כאן ציון ואין המלצה');
  });
});
