'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Decides whether this account has ever been set up, and shows the first-run
// screen if not.
//
// THREE THINGS IT MUST NOT DO, in order of how bad they are:
//
//   1. Show the setup to a trader who is already using the app. Finishing it
//      writes a settings doc, so a false positive would overwrite a real
//      balance with a default. Two independent guards: a settings doc that
//      exists, and a journal that has trades in it. Either one means "not new".
//
//   2. Ask twice. `onboardedAt` is written on finish AND on skip, and the doc
//      syncs, so a second device does not re-ask.
//
//   3. Flash. Nothing renders until the cloud hydrate has answered — an
//      overlay that appears for 200ms on every load is worse than no overlay.
//
// A hydrate that FAILS resolves to null, which looks identical to a new
// account. That is why the journal is checked too: the trader who would be
// hurt by a false positive is precisely the one who has trades.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { hydrateDoc } from '../lib/sync/collections';
import { SETTINGS_KEY, SETTINGS_KIND, type UserSettings } from '../lib/settings/types';
import { loadTrades } from '../lib/journal';
import FirstRunSetup from './FirstRunSetup';

export default function FirstRunGate() {
  const { user } = useUser();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;

    // A journal with anything in it is an account in use, whatever the
    // settings doc says or fails to say.
    if (loadTrades().length > 0) return;

    hydrateDoc<UserSettings>(SETTINGS_KIND, SETTINGS_KEY)
      .then(doc => {
        if (!alive) return;
        // `onboardedAt` is the real signal. `updatedAt` covers every account
        // that saved settings before this screen existed — they have been
        // through the page by hand and must not be sent back to the start.
        const seen = !!doc && (doc.onboardedAt != null || doc.updatedAt != null);
        setShow(!seen);
      })
      .catch(() => { /* Could not tell — say nothing rather than re-onboard. */ });

    return () => { alive = false; };
  }, []);

  if (!show) return null;
  return <FirstRunSetup onDone={() => setShow(false)} suggestedName={user?.firstName ?? null} />;
}
