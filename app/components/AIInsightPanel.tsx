'use client';

import { useState, useEffect, useRef } from 'react';
import type { TradeEntry } from '../lib/journal';

export default function AIInsightPanel({ trades }: { trades: TradeEntry[] }) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const lastFetchRef = useRef<number>(0);

  const closedCount = trades.filter(t => t.result !== 'OPEN').length;

  async function fetchInsight() {
    if (trades.length === 0) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: trades.slice(0, 30) }),
      });
      const data = await res.json();
      setInsight(data.insight ?? null);
      lastFetchRef.current = Date.now();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch when 5+ closed trades and no insight yet
  useEffect(() => {
    if (closedCount >= 5 && !insight && !loading) {
      fetchInsight();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedCount]);

  return (
    <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">AI Insight</p>
        {(insight || error) && (
          <button
            onClick={fetchInsight}
            disabled={loading}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d4af37]/50 hover:text-[#d4af37] disabled:opacity-30 transition-colors"
          >
            {loading ? '...' : '↺ Refresh'}
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
          <span className="font-mono text-xs text-white/30 animate-pulse">מנתח את העסקאות שלך...</span>
        </div>
      )}

      {!loading && insight && (
        <p className="font-mono text-sm text-white/70 leading-relaxed" dir="ltr">{insight}</p>
      )}

      {!loading && error && (
        <p className="font-mono text-xs text-[#ef4444]/60">שגיאה בטעינת התובנה. בדוק את מפתח ה-API.</p>
      )}

      {!loading && !insight && !error && (
        <div>
          {closedCount < 5 ? (
            <p className="font-mono text-xs text-white/20">הזן לפחות 5 עסקאות כדי לקבל תובנות AI.</p>
          ) : (
            <button
              onClick={fetchInsight}
              className="font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors"
            >
              → נתח את הביצועים שלי
            </button>
          )}
        </div>
      )}
    </div>
  );
}
