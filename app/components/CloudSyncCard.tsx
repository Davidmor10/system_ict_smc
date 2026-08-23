'use client';

import { useState } from 'react';
import { hydrateTradesFromCloud, loadTrades, type TradeEntry } from '../lib/journal';

/** Cloud reconciliation — what this device holds vs. what the account holds.
 *
 *  The journal reads localStorage; every AI panel reads the cloud. When those
 *  two disagree the trader sees analysis of trades their journal does not
 *  show, with no way to tell why. Deletes now repair themselves, but a delete
 *  that failed BEFORE that existed left rows nothing will ever come back for.
 *  This is the manual door for exactly that case: it states the gap in plain
 *  numbers and makes the trader choose which side is right. Neither button
 *  runs on its own. */
export default function CloudSyncCard() {
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [extraIds, setExtraIds] = useState<number[]>([]);
  const [missingCount, setMissingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function check() {
    setState('checking');
    setResult(null);
    try {
      const res = await fetch('/api/journal');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const cloud: Array<TradeEntry & { deletedAt?: string | null }> = Array.isArray(data?.trades) ? data.trades : [];
      const localIds = new Set(loadTrades().map(t => t.id));
      const cloudLive = cloud.filter(t => !t.deletedAt);
      setExtraIds(cloudLive.filter(t => !localIds.has(t.id)).map(t => t.id));
      setMissingCount([...localIds].filter(id => !cloudLive.some(t => t.id === id)).length);
      setState('done');
    } catch {
      setState('error');
    }
  }

  async function deleteFromCloud() {
    setBusy(true);
    try {
      const res = await fetch('/api/journal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: [], deletedIds: extraIds }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setResult(`${extraIds.length} עסקאות נמחקו מהענן. התובנות ייבנו מחדש מהעסקאות שנשארו.`);
      setExtraIds([]);
    } catch {
      setResult('המחיקה נכשלה. נסה שוב.');
    } finally {
      setBusy(false);
    }
  }

  async function pullDown() {
    setBusy(true);
    try {
      const trades = await hydrateTradesFromCloud();
      setResult(`המכשיר הזה מחזיק עכשיו ${trades.length} עסקאות.`);
      setExtraIds([]);
    } catch {
      setResult('המשיכה נכשלה. נסה שוב.');
    } finally {
      setBusy(false);
    }
  }

  const inSync = state === 'done' && extraIds.length === 0 && missingCount === 0;

  return (
    <div className="rounded-[12px] border border-[#1c1c1e] bg-white/[0.02] p-5">
      <div className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/60 mb-2">סנכרון היומן</div>
      <p className="text-[13px] text-white/50 leading-relaxed">
        היומן נקרא מהמכשיר הזה, והניתוחים של ה-AI נקראים מהענן. אם השניים לא מסכימים,
        תראה ניתוח של עסקאות שהיומן כבר לא מציג. כאן אפשר לבדוק ולהחליט מי צודק.
      </p>

      <div className="flex gap-2 mt-4 flex-wrap">
        <button
          type="button" onClick={check} disabled={state === 'checking' || busy}
          className="inline-flex items-center gap-2 py-2.5 px-5 rounded-[8px] border border-[#2a2a2d] text-white/80 text-[12px] font-bold hover:text-white hover:border-white/25 transition-colors disabled:opacity-40"
        >
          {state === 'checking' ? 'בודק…' : 'בדוק מול הענן'}
        </button>
      </div>

      {state === 'error' && (
        <p className="text-[13px] text-[#f0899e] mt-3">הבדיקה נכשלה — בדוק את החיבור ונסה שוב.</p>
      )}

      {inSync && !result && (
        <p className="text-[13px] text-[#4a7c59] mt-3">הענן והמכשיר הזה מסכימים. אין מה לתקן.</p>
      )}

      {state === 'done' && extraIds.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-[#d4af37]/30 bg-[#d4af37]/[0.05] p-4">
          <p className="text-[13px] text-white/80 leading-relaxed">
            בענן יש <b className="text-[#d4af37]">{extraIds.length}</b> עסקאות שלא קיימות במכשיר הזה.
            אלה העסקאות שה-AI סופר ואתה לא רואה ביומן.
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              type="button" onClick={deleteFromCloud} disabled={busy}
              className="inline-flex items-center gap-2 py-2.5 px-5 rounded-[8px] border border-[#8b3a3a]/45 text-[#f0899e] text-[12px] font-bold hover:bg-[#8b3a3a]/10 transition-colors disabled:opacity-40"
            >
              מחק אותן מהענן
            </button>
            <button
              type="button" onClick={pullDown} disabled={busy}
              className="inline-flex items-center gap-2 py-2.5 px-5 rounded-[8px] border border-[#2a2a2d] text-white/80 text-[12px] font-bold hover:text-white hover:border-white/25 transition-colors disabled:opacity-40"
            >
              הורד אותן למכשיר הזה
            </button>
          </div>
          <p className="text-[12px] text-white/35 mt-3 leading-relaxed">
            מחיקה מהענן היא רכה — העסקאות מסומנות כמחוקות ולא נמחקות פיזית.
          </p>
        </div>
      )}

      {state === 'done' && missingCount > 0 && (
        <p className="text-[13px] text-white/60 mt-3">
          {missingCount} עסקאות קיימות רק במכשיר הזה. הן יעלו לענן אוטומטית בטעינה הבאה של היומן.
        </p>
      )}

      {result && <p className="text-[13px] text-[#4a7c59] mt-3">{result}</p>}
    </div>
  );
}
