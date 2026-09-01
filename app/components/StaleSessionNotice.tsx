'use client';

// A tab whose session changed underneath it stops reading and writing — see
// lib/sync/owned. Correct, and completely silent: the window that was left
// open just empties, which looks exactly like losing a journal.
//
// So it says what happened. The `storage` event is what makes it immediate:
// it fires in every OTHER window on the origin when one of them writes, which
// is precisely the moment this tab stopped being valid.

import { useEffect, useState } from 'react';
import { stale } from '../lib/sync/owned';

export default function StaleSessionNotice() {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const check = () => setIsStale(stale());
    check();
    window.addEventListener('storage', check);
    // Also on focus: a tab returned to after signing in elsewhere may have
    // missed the event while the browser was throttling it.
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!isStale) return null;

  return (
    <div
      dir="rtl"
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 border-b border-[#d4af37]/40 bg-[#0d0d0f] px-4 py-3 text-sm text-[#e3c768] shadow-lg"
    >
      <span>נכנסת לחשבון אחר בחלון אחר. החלון הזה הוקפא כדי שהנתונים לא יתערבבו.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 py-1 font-medium text-[#d4af37] transition-colors hover:bg-[#d4af37]/20"
      >
        רענון
      </button>
    </div>
  );
}
