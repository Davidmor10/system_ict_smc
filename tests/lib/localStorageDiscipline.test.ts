// Every local read and write goes through the owner envelope.
//
// This is a lint, not a unit test, because the bug it guards against does not
// fail loudly. `lib/sync/owned` changed the STORED SHAPE of every cached value
// from a bare array or object to `{o, v}`. Any site still calling
// localStorage.getItem directly kept parsing — and got an object where it
// expected a list, which reads as "you have no rules", "you have no setups",
// "your timezone is the default". No error, no crash, just a screen that is
// quietly wrong, on exactly the data a trader would notice last.
//
// A dozen such sites survived the first pass. The only reliable guard is to
// forbid the call outside the module that owns it.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', 'app');

/** Files allowed to touch localStorage directly, each for a stated reason. */
const ALLOWED: Record<string, string> = {
  'lib/sync/owned.ts':            'the envelope itself',
  'lib/localOwner.ts':            'the pre-hydration wipe, which runs before any account is known',
  'lib/sync/collections.ts':      'snapshots opaque strings, and checks the envelope before it does',
  'lib/confirmationTags.ts':      'reads the pre-envelope key once, to migrate it',
  'lib/journal.ts':               'a push timestamp, carrying no trader data',
  'components/LocalCacheReport.tsx': 'the diagnostic, which exists to see what the envelope hides',
  'layout.tsx':                   'the language preference, which belongs to the device',
  '(home)/layout.tsx':            'the language preference, which belongs to the device',
  '(marketing)/layout.tsx':       'the language preference, which belongs to the device',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('local storage discipline', () => {
  it('is reached only through the owner envelope', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (rel in ALLOWED) continue;
      const src = readFileSync(file, 'utf8');
      if (/localStorage\.(getItem|setItem)\s*\(/.test(src)) offenders.push(rel);
    }
    // Named in the failure so the fix is obvious: route it through
    // readOwned/writeOwned, or add it to ALLOWED with the reason it is safe.
    expect(offenders).toEqual([]);
  });
});
