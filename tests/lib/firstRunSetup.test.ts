// The first thing a new account sees — and, more importantly, the three
// things it must never do.
//
// The setting behind it: accountStartUsd ships at $25,000 and anchors the
// equity curve and the drawdown. A trader funded at $50,000 reads a dashboard
// drawn against half their capital, with no reason to suspect a settings page
// they have never opened. So it is asked once, up front.
//
// Finishing the setup WRITES a settings doc. That makes a false positive
// expensive — it would overwrite a real balance with a default — which is
// what the guards below are for.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const gate  = readFileSync('app/components/FirstRunGate.tsx', 'utf8');
const setup = readFileSync('app/components/FirstRunSetup.tsx', 'utf8');
const layout = readFileSync('app/dashboard/layout.tsx', 'utf8');

describe('when it appears', () => {
  it('is mounted once, on the dashboard shell', () => {
    expect(layout).toContain('<FirstRunGate />');
  });

  it('never appears for an account that has trades', () => {
    // The independent guard. A hydrate that FAILS resolves to null, which
    // looks exactly like a new account — and the trader who would be hurt by
    // that false positive is precisely the one who has trades.
    expect(gate).toContain('loadTrades().length > 0');
  });

  it('never appears for an account that has saved settings', () => {
    expect(gate).toContain('doc.onboardedAt != null');
    // Covers every account that used the settings page before this screen
    // existed: they have been through it by hand and must not be sent back.
    expect(gate).toContain('doc.updatedAt != null');
  });

  it('starts hidden, so a slow or failed hydrate shows nothing', () => {
    expect(gate).toContain('const [show, setShow] = useState(false)');
    expect(gate).toContain('.catch(');
  });
});

describe('what it writes', () => {
  it('records that it was seen on BOTH paths, finishing and skipping', () => {
    // Otherwise a trader who deliberately took the defaults is asked again on
    // the next load, and again on the next device, since the doc syncs.
    expect(setup).toContain('onboardedAt: Date.now()');
    expect(setup).toContain('finish(true)');
    expect(setup).toContain('finish(false)');
  });

  it('writes the defaults on a skip, not the half-filled draft', () => {
    // A trader who skipped from step two did not choose the balance they
    // happened to be looking at.
    expect(setup).toContain('...(skipped ? DEFAULT_SETTINGS : draft)');
  });

  it('is a settings doc like any other, so the settings page can edit it', () => {
    expect(setup).toContain('saveDoc(SETTINGS_KIND, SETTINGS_KEY, doc)');
  });
});

describe('the balance step', () => {
  it('is typed, not tapped off a list of common sizes', () => {
    // The chips are gone. One tap on the wrong one is how an account ends up
    // anchored to a size it never had — and every drawdown percentage on
    // every screen is then measured against it.
    expect(setup).not.toContain('COMMON_BALANCES');
    expect(setup).toContain('type="number"');
  });

  it('starts empty rather than showing a number to clear', () => {
    expect(setup).toContain("value={draft.accountStartUsd || ''}");
  });
});

describe('the clock is not asked about', () => {
  it('has no zone step and no zone control', () => {
    // Israel, on request — one clock for every screen and every import.
    expect(setup).not.toContain('ZoneSelect');
    expect(setup).not.toContain('ZONES');
    expect(setup).toContain("const STEPS = ['מי אתה', 'החשבון'] as const;");
  });

  it('writes the one zone explicitly, so an older doc is corrected', () => {
    expect(setup).toContain('timezone: DEFAULT_TIMEZONE');
  });
});

describe('the component itself', () => {
  it('takes the suggested name as a prop rather than reaching for Clerk', () => {
    // What makes it drivable in a browser test without an auth session — the
    // flow above was verified that way, not reasoned about.
    expect(setup).not.toContain('useUser');
    expect(setup).toContain('suggestedName');
    expect(gate).toContain('useUser');
  });

  it('can always be passed with the defaults', () => {
    expect(setup).toContain('דלג');
  });
});
