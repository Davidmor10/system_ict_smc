'use client';

// The browser's half of the diagnosis — see app/dashboard/diagnostics/page.tsx.
//
// Reads localStorage directly rather than through lib/sync/owned, on purpose:
// `readOwned` hides a cache belonging to another account, which is correct for
// the app and useless here. The one question this panel exists to answer is
// whether such a cache is present, so it has to look at the raw value.

import { useEffect, useState } from 'react';
import { LOCAL_OWNER_KEY, CACHE_EPOCH_KEY, CACHE_EPOCH } from '../lib/localOwner';
import { hasHebrew } from '../lib/text/direction';

interface CacheEntry { key: string; owner: string | null; items: number | null }

const WATCHED = [
  'onyx_journal',
  'onyx_playbook',
  'onyx_trading_rules',
  'onyx_confirmations_v2',
  'onyx_notebook_entries_v1',
];

function inspect(key: string): CacheEntry {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { key, owner: null, items: null };
    const parsed = JSON.parse(raw) as unknown;
    // The envelope written by lib/sync/owned: { o: ownerId, v: value }.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'o' in parsed && 'v' in parsed) {
      const { o, v } = parsed as { o: unknown; v: unknown };
      return { key, owner: typeof o === 'string' ? o : null, items: Array.isArray(v) ? v.length : null };
    }
    // Written before the envelope existed. Belongs to nobody, and is ignored
    // by every read path — worth showing precisely because it is invisible.
    return { key, owner: 'ללא בעלים (נכתב לפני התיקון)', items: Array.isArray(parsed) ? parsed.length : null };
  } catch {
    return { key, owner: null, items: null };
  }
}

export default function LocalCacheReport({ serverUserId }: { serverUserId: string | null }) {
  // Rendered after mount: localStorage does not exist during the server render,
  // and a mismatch between the two would be a hydration error, not a report.
  const [state, setState] = useState<{ stamp: string | null; epoch: string | null; entries: CacheEntry[] } | null>(null);

  useEffect(() => {
    try {
      setState({
        stamp: window.localStorage.getItem(LOCAL_OWNER_KEY),
        epoch: window.localStorage.getItem(CACHE_EPOCH_KEY),
        entries: WATCHED.map(inspect).filter(e => e.owner !== null || e.items !== null),
      });
    } catch {
      setState({ stamp: null, epoch: null, entries: [] });
    }
  }, []);

  if (!state) return <p className="text-sm text-[#6a6a6a]">קורא…</p>;

  const stampAgrees = state.stamp !== null && state.stamp === serverUserId;
  const foreign = state.entries.filter(e => e.owner !== null && e.owner !== serverUserId);

  return (
    <div className="space-y-4">
      <dl className="rounded-lg border border-[#2a2a2d] bg-[#0d0d0f] divide-y divide-[#1c1c1e]">
        <Row label="החשבון שהדפדפן מסומן בו" value={state.stamp ?? '— (לא מסומן)'} />
        <Row label="גרסת המטמון" value={`${state.epoch ?? '—'} (הקוד מצפה ל־${CACHE_EPOCH})`} />
      </dl>

      {state.entries.length === 0 ? (
        <p className="text-sm text-[#7fae8c]">אין מטמון מקומי בדפדפן הזה.</p>
      ) : (
        <dl className="rounded-lg border border-[#2a2a2d] bg-[#0d0d0f] divide-y divide-[#1c1c1e]">
          {state.entries.map(e => (
            <Row
              key={e.key}
              label={e.key}
              value={`${e.items === null ? 'לא רשימה' : `${e.items} פריטים`} · ${e.owner ?? 'ללא בעלים'}`}
            />
          ))}
        </dl>
      )}

      <div className="rounded-lg border border-[#2a2a2d] bg-[#0a0a0b] px-4 py-3 text-sm">
        {foreign.length > 0 ? (
          <p className="text-[#c07878]">
            נמצא מטמון ששייך לחשבון אחר. הוא לא מוצג ולא נשלח לענן, אבל הוא עדיין כאן.
          </p>
        ) : !stampAgrees && state.stamp !== null ? (
          <p className="text-[#c07878]">
            הסימון בדפדפן לא תואם לחשבון שהשרת מזהה. טען את הדף מחדש טעינה מלאה.
          </p>
        ) : (
          <p className="text-[#7fae8c]">הדפדפן והשרת מסכימים על אותו חשבון.</p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const rtl = hasHebrew(value);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-[#8a8a8a]">{label}</dt>
      <dd
        className={`text-xs text-[#d8d8d8] break-all ${rtl ? 'text-right' : 'font-mono text-left'}`}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        {value}
      </dd>
    </div>
  );
}
