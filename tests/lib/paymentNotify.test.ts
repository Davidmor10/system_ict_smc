// The owner's notification.
//
// It runs after the payment request is already recorded, so its one absolute
// obligation is to never throw: a customer must not be told their submission
// failed because a mail provider was down.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { notifyOwner, adminPanelUrl } from '../../app/lib/payments/notify';

const ENV = { ...process.env };

const note = {
  name: 'דוד מור',
  email: 'david@example.com',
  plan: 'pro' as const,
  amount: 99,
  time: '09:14',
};

function configure() {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.OWNER_NOTIFY_EMAIL = 'owner@onyx.com';
  process.env.OWNER_NOTIFY_FROM = 'onyx@onyx.com';
  process.env.NEXT_PUBLIC_APP_URL = 'https://onyxtrading.vercel.app';
}

beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.RESEND_API_KEY;
  delete process.env.OWNER_NOTIFY_EMAIL;
  delete process.env.OWNER_NOTIFY_FROM;
  delete process.env.ADMIN_EMAIL;
});
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); });

describe('notifyOwner', () => {
  it('sends when it is configured', async () => {
    configure();
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await notifyOwner(note)).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('carries the details the owner matches the transfer against', async () => {
    configure();
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, text: async () => '' };
    }));

    await notifyOwner(note);
    const sent = JSON.parse(body);
    expect(sent.subject).toContain('PRO');
    expect(sent.subject).toContain('99');
    expect(sent.subject).toContain('דוד מור');
    expect(sent.html).toContain('david@example.com');
    expect(sent.html).toContain('09:14');
    // Replying goes to the customer, not into the void.
    expect(sent.reply_to).toBe('david@example.com');
  });

  it('links straight to the panel rather than to the plan grid', async () => {
    configure();
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, text: async () => '' };
    }));

    await notifyOwner(note);
    expect(JSON.parse(body).html).toContain('/checkout?view=admin');
  });

  // The name and the address are typed by a customer, and the owner is the
  // one reader who has to be able to trust what the message says.
  it('escapes customer-supplied text out of the markup', async () => {
    configure();
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, text: async () => '' };
    }));

    await notifyOwner({ ...note, name: '<img src=x onerror=alert(1)>' });
    const html = JSON.parse(body).html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('sends to every address in a comma-separated list', async () => {
    configure();
    process.env.OWNER_NOTIFY_EMAIL = 'a@onyx.com, b@onyx.com';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, text: async () => '' };
    }));

    await notifyOwner(note);
    expect(JSON.parse(body).to).toEqual(['a@onyx.com', 'b@onyx.com']);
  });

  it('falls back to ADMIN_EMAIL when no notify address is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.OWNER_NOTIFY_FROM = 'onyx@onyx.com';
    process.env.ADMIN_EMAIL = 'owner@onyx.com';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, text: async () => '' };
    }));

    expect(await notifyOwner(note)).toBe('sent');
    expect(JSON.parse(body).to).toEqual(['owner@onyx.com']);
  });

  // Unconfigured is not a failure. Payments still work; the owner just has to
  // open the panel themselves, which is where this started.
  it('reports not_configured instead of trying, when the key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await notifyOwner(note)).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports not_configured when there is no sender or recipient', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    expect(await notifyOwner(note)).toBe('not_configured');
  });

  // The two that matter most: the request is already recorded by now.
  it('returns failed rather than throwing when the provider rejects it', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, text: async () => 'domain not verified' })));
    await expect(notifyOwner(note)).resolves.toBe('failed');
  });

  it('returns failed rather than throwing when the network is down', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(notifyOwner(note)).resolves.toBe('failed');
  });
});

describe('adminPanelUrl', () => {
  it('points at the panel', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://onyxtrading.vercel.app';
    expect(adminPanelUrl()).toBe('https://onyxtrading.vercel.app/checkout?view=admin');
  });

  it('does not double the slash when the base carries one', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://onyxtrading.vercel.app/';
    expect(adminPanelUrl()).toBe('https://onyxtrading.vercel.app/checkout?view=admin');
  });
});
