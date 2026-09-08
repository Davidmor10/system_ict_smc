// Does a settings change actually survive, and does it actually do anything?
//
// Two different failures, and the page had one of each.
//
//  1. SAVED BUT NOT SYNCED. save() fired the network write and did not wait
//     for it, then announced "נשמר וסונכרן". A push that failed was queued
//     locally and the trader was told it had reached the server. On a browser
//     never opened again, the change existed on one device — confirmed.
//
//  2. SAVED AND IGNORED. `displayUnit` was a five-way picker captioned "how
//     P&L statistics are shown on the dashboard and on trade cards" and was
//     read by nothing in the app. `defaultSymbol` was captioned "a new trade
//     opens with this instrument selected" and was also read by nothing. Both
//     stored perfectly. A control that changes nothing is worse than a missing
//     one: the trader sets it, sees no effect, and stops trusting the ones
//     that work.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { DEFAULT_SETTINGS, withDefaults, type UserSettings } from '../../app/lib/settings/types';
import { DEFAULT_SESSIONS } from '../../app/lib/sessions';

const view = readFileSync('app/components/SettingsView.tsx', 'utf8');
const sync = readFileSync('app/lib/sync/collections.ts', 'utf8');
const repo = (f: string) => readFileSync(f, 'utf8');

describe('the shape', () => {
  it('gives every field a default, so no input flips controlled to uncontrolled', () => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      expect(v, `default for ${k}`).not.toBeUndefined();
    }
  });

  it('round-trips a fully customised doc without changing a single field', () => {
    const custom: UserSettings = {
      nickname: 'דוד',
      bio: 'סוחר חוזים על NQ',
      tradingStyle: 'swing',
      defaultSymbol: 'MNQ',
      accountStartUsd: 50_000,
      timezone: 'America/New_York',
      sessions: [{ key: 'london', he: 'לונדון', en: 'LONDON', start: 8, end: 12, enabled: true }],
      updatedAt: 123,
    };
    expect(withDefaults(custom)).toEqual(custom);
  });

  it('keeps a 50k balance a 50k balance', () => {
    // The one the trader notices: a prop account seeded at the 25k default
    // renders a drawdown and an equity curve against the wrong capital.
    expect(withDefaults({ accountStartUsd: 50_000 }).accountStartUsd).toBe(50_000);
    expect(withDefaults({}).accountStartUsd).toBe(DEFAULT_SETTINGS.accountStartUsd);
  });

  it('never resets a session table that is merely missing from the doc', () => {
    expect(withDefaults({}).sessions).toEqual(DEFAULT_SESSIONS);
  });
});

describe('every remaining control does something', () => {
  // The guard against another displayUnit. Each field maps to the module that
  // reads it; if a field is added to the page without a reader, add it here
  // with its reader or do not ship the control.
  const readers: Record<string, string[]> = {
    nickname:        ['app/lib/settings/server.ts'],
    bio:             ['app/lib/settings/server.ts'],
    tradingStyle:    ['app/lib/settings/server.ts'],
    accountStartUsd: ['app/components/DashboardView.tsx', 'app/components/StatsView.tsx'],
    defaultSymbol:   ['app/components/TradeForm.tsx'],
    timezone:        ['app/lib/time/zone.ts'],
    sessions:        ['app/lib/sessions.ts'],
  };

  for (const [field, files] of Object.entries(readers)) {
    it(`${field} is read by something outside the settings page`, () => {
      const found = files.some(f => repo(f).includes(field));
      expect(found, `${field} has no reader in ${files.join(', ')}`).toBe(true);
    });
  }

  it('has no field in the type that nothing reads', () => {
    const declared = Object.keys(DEFAULT_SETTINGS);
    for (const f of declared) {
      expect(Object.keys(readers), `${f} is stored but nothing reads it`).toContain(f);
    }
  });

  it('dropped the picker that changed nothing', () => {
    expect(view).not.toContain('displayUnit');
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('displayUnit');
  });
});

describe('what the page is allowed to claim about a save', () => {
  it('waits for the write instead of announcing it', () => {
    expect(view).toContain('const outcome = await saveDoc(');
    expect(view).not.toContain('void saveDoc(');
  });

  it('separates "reached the server" from "sits on this device"', () => {
    expect(sync).toContain("export type SaveOutcome = 'synced' | 'queued'");
    expect(view).toContain("saved === 'queued'");
    expect(view).toContain('נשמר במכשיר הזה בלבד');
  });

  it('does not time the offline notice away like a success toast', () => {
    // A queued write is something the trader may need to act on.
    expect(view).toContain("if (outcome === 'synced') savedTimer.current = setTimeout");
  });
});

describe('the removals', () => {
  it('took the session editor off the page', () => {
    expect(view).not.toContain('SessionEditor');
    expect(view).not.toContain('הוספת סשן');
  });

  it('left the session data itself alone', () => {
    // An account that already moved a window must not have it reset by a UI
    // change, so the field stays in the doc and stays read.
    expect(Object.keys(DEFAULT_SETTINGS)).toContain('sessions');
    expect(repo('app/lib/sessions.ts')).toContain('normalizeSessions');
  });
});
