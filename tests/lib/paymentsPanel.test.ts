// The verification panel moved out of /checkout and into the dashboard.
//
// Two things have to stay true after that move, and neither shows up in a
// type error if it breaks:
//
//   • the customer-facing checkout must never again read the whole queue —
//     every row in it carries another customer's name and email address;
//   • the new page must gate itself before it reads anything, because a link
//     hidden from the sidebar is not access control.
//
// The third test is the bug that prompted the move: the panel rendered the
// rows the server happened to hold when the page opened and never looked
// again, so a request declared a minute later left the owner staring at an
// empty screen.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = (...p: string[]) => join(__dirname, '..', '..', 'app', ...p);
const read = (...p: string[]) => readFileSync(app(...p), 'utf8');

const CHECKOUT_PAGE = read('checkout', 'page.tsx');
const CHECKOUT_FLOW = read('components', 'checkout', 'CheckoutFlow.tsx');
const PAYMENTS_PAGE = read('dashboard', 'payments', 'page.tsx');
const PANEL = read('components', 'checkout', 'AdminPanel.tsx');
const LAYOUT = read('dashboard', 'layout.tsx');

describe('the customer checkout carries no other customer', () => {
  it('never reads the full queue', () => {
    expect(CHECKOUT_PAGE).not.toContain('listAllRequests');
    expect(CHECKOUT_FLOW).not.toContain('listAllRequests');
  });

  // Scoped by the session's clerk_id, so it cannot return somebody else's.
  it('reads only the viewer’s own request', () => {
    expect(CHECKOUT_PAGE).toContain('latestRequestFor');
  });

  it('has no admin view left to toggle into', () => {
    expect(CHECKOUT_FLOW).not.toContain('canSeeAdmin');
    expect(CHECKOUT_FLOW).not.toContain('initialRequests');
    expect(CHECKOUT_FLOW).not.toContain('view=admin');
  });
});

describe('the panel page gates itself', () => {
  it('refuses a non-admin with the same answer as a missing page', () => {
    expect(PAYMENTS_PAGE).toContain('viewerIsAdmin');
    expect(PAYMENTS_PAGE).toContain('notFound()');
  });

  // Order matters: rows read before the check would be serialised into the
  // HTML of a page that then refuses to render them.
  it('checks before it reads a single row', () => {
    expect(PAYMENTS_PAGE.indexOf('viewerIsAdmin')).toBeLessThan(PAYMENTS_PAGE.indexOf('listAllRequests'));
  });

  // Server-rendered and cached would show a queue from an earlier visit.
  it('is never served from a cache', () => {
    expect(PAYMENTS_PAGE).toContain("export const dynamic = 'force-dynamic'");
  });

  // The sidebar flag is a convenience for drawing the link. It must not be
  // the thing that decides, and the layout must not hand it to a page.
  it('does not take the viewer’s admin flag from the client context', () => {
    expect(PAYMENTS_PAGE).not.toContain('usePlan');
    expect(LAYOUT).toContain('viewerIsAdmin');
  });
});

describe('the panel refetches', () => {
  it('reads the queue back rather than trusting its first paint', () => {
    expect(PANEL).toContain("fetch('/api/payment-requests'");
    expect(PANEL).toContain('cache: \'no-store\'');
  });

  it('refreshes when the owner comes back to the tab', () => {
    expect(PANEL).toContain('visibilitychange');
  });

  it('gives the owner a way to ask for it directly', () => {
    expect(PANEL).toContain('רענון');
  });
});
