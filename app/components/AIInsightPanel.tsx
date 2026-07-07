'use client';

import { useEffect, useState } from 'react';
import type { TradeEntry } from '../lib/journal';
import { todayISO } from '../lib/journal';
import { useLanguage } from '../hooks/useLanguage';
import TypingDots from './TypingDots';
import EmptyState from './EmptyState';
import InsightText from './InsightText';

interface AiInsight { type: string; tag_he: string; tag_en: string; text: string; }

const META: Record<string, { fg: string; bg: string; bd: string; rail: string }> = {
  opportunity: { fg: '#4a7c59', bg: 'rgba(111,165,128,.1)', bd: 'rgba(111,165,128,.32)', rail: '#4a7c59' },
  warning:     { fg: '#d4af37', bg: 'rgba(212,175,55,.08)', bd: 'rgba(212,175,55,.25)', rail: '#d4af37' },
  pattern:     { fg: '#7a8fa8', bg: 'rgba(255,255,255,.04)', bd: 'rgba(255,255,255,.08)', rail: '#7a8fa8' },
};

export default function AIInsightPanel({ trades }: { trades: TradeEntry[] }) {
  const { lang } = useLanguage();
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const closedCount = trades.filter(t => t.result !== 'OPEN').length;
  const cacheKey = 'onyx_ai_insights_' + todayISO();

  async function fetchInsights() {
    if (trades.length < 3) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades, lang }),
      });
      if (!res.ok) throw new Error(`Insights request failed: ${res.status}`);
      const data = await res.json();
      const fetched = Array.isArray(data.insights) ? data.insights : [];
      const stamp = new Date().toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
      setInsights(fetched);
      setUpdatedAt(stamp);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ insights: fetched, updatedAt: stamp }));
      } catch { /* storage unavailable — non-fatal */ }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // Same-day cache first — analyzing once per day (like the dashboard's
  // discovery card) instead of re-calling the AI on every page visit, which
  // was burning through the free-tier model quota for nothing.
  useEffect(() => {
    if (closedCount < 3) return;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { insights: AiInsight[]; updatedAt: string };
        if (Array.isArray(parsed.insights) && parsed.insights.length > 0) {
          setInsights(parsed.insights);
          setUpdatedAt(parsed.updatedAt);
          return;
        }
      }
    } catch { /* corrupt cache entry — fall through to a fresh fetch */ }
    fetchInsights();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedCount]);

  return (
    <section className="rounded-xl border border-[#1c1c1e] bg-[#0d0d0f] overflow-hidden [box-shadow:0_0_80px_-40px_rgba(212,175,55,0.35)]">
      <div className="flex items-center justify-between py-[15px] px-[22px] border-b border-[#1c1c1e]" style={{ background: 'linear-gradient(90deg, rgba(212,175,55,0.08), transparent 60%)' }}>
        <div className="flex items-center gap-[11px]">
          <span className="text-[#d4af37] text-sm">◈</span>
          <span className="font-mono text-xs font-bold tracking-[0.26em] text-[#d4af37]">AI INSIGHT</span>
          <span className="text-[13px] text-white/40">תובנות היומן שלך</span>
        </div>
        <div className="flex items-center gap-3.5">
          {updatedAt && !loading && (
            <span className="font-mono text-[11px] font-semibold text-white/40">עודכן {updatedAt}</span>
          )}
          {(insights.length > 0 || error) && (
            <button
              onClick={fetchInsights}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-sm border border-[#d4af37]/45 py-1.5 px-3.5 text-xs font-semibold text-[#d4af37] hover:bg-[#d4af37]/10 disabled:opacity-30 transition-colors"
            >
              רענון <span className="font-mono">↻</span>
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 p-6">
          <TypingDots />
          <span className="font-mono text-xs text-white/30">מנתח את העסקאות שלך...</span>
        </div>
      )}

      {!loading && insights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#1c1c1e]">
          {insights.map((ins, i) => {
            const m = META[ins.type] ?? META.pattern;
            return (
              <div key={i} className="bg-[#0d0d0f] py-[22px] px-6" style={{ borderTop: `3px solid ${m.rail}` }}>
                <div className="flex items-center gap-2 text-sm font-bold mb-[11px]" style={{ color: m.fg }}>
                  <span className="text-[8px]">◆</span>{lang === 'he' ? ins.tag_he : ins.tag_en}
                </div>
                <InsightText text={ins.text} className="text-sm leading-[1.75] text-white/70" />
              </div>
            );
          })}
        </div>
      )}

      {!loading && error && (
        <p className="font-mono text-xs text-[#ef4444]/60 p-6">שגיאה בטעינת התובנה. בדוק את מפתח ה-API.</p>
      )}

      {!loading && insights.length === 0 && !error && (
        <div className="p-6">
          {closedCount < 3 ? (
            <EmptyState
              icon="◈"
              title="עדיין אין מספיק נתונים"
              description="הזן לפחות 3 עסקאות כדי שה-AI יוכל לנתח את הדפוסים שלך ולתת המלצות מדויקות."
            />
          ) : (
            <button
              onClick={fetchInsights}
              className="font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors"
            >
              → נתח את הביצועים שלי
            </button>
          )}
        </div>
      )}
    </section>
  );
}
