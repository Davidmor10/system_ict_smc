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
const STRIP   = read('components', 'ProgressStrip.tsx');
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

  it('reads the stored scores instead of refreshing them', () => {
    expect(ROUTE).toContain('getScoreHistory');
    expect(ROUTE).not.toContain('refreshIntelligence');
  });

  // Every reader of the intelligence module refreshes as a side effect of
  // being asked; this accessor exists precisely so a screen does not have to.
  it('has a read-only accessor to call', () => {
    expect(SERVICE).toContain('export async function getScoreHistory');
    const body = SERVICE.slice(SERVICE.indexOf('export async function getScoreHistory'));
    expect(body.slice(0, 400)).not.toContain('saveTraderProfile');
  });
});

describe('the strip and the page cannot disagree', () => {
  it('both read the same endpoint', () => {
    expect(STRIP).toContain('/api/coach/journey');
    expect(VIEW).toContain('/api/coach/journey');
  });

  // The counts are computed once, server-side, from one list of findings.
  it('does not recount findings in either surface', () => {
    expect(ROUTE).toContain('countJourney');
    expect(STRIP).not.toContain('countJourney');
    expect(VIEW).not.toContain('countJourney');
  });

  it('is what the dashboard renders', () => {
    expect(DASH).toContain('<ProgressStrip />');
    expect(DASH).not.toContain('TrackingLine');
  });
});

describe('a relapse is never counted as a success', () => {
  it('is a field of its own on the strip, not folded into the changed count', () => {
    expect(STRIP).toContain('counts.relapsed');
    expect(STRIP).toContain('counts.changed');
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

describe('an unmeasurable score is said, not drawn', () => {
  // The engine returns a neutral 50 when it cannot compare. Drawn on an axis
  // that is a flat line at the midpoint — months of standing still shown to a
  // trader who has simply never been measured.
  it('branches on `known` before rendering a number', () => {
    expect(VIEW).toContain('t.known');
    expect(VIEW).toContain('עוד אין מספיק היסטוריה');
  });

  it('hides the score on the strip too while it is unknown', () => {
    expect(STRIP).toContain('trajectory.known');
  });
});
