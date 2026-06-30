'use client';

import { useEffect, useState } from 'react';
import type { TradeEntry } from '../lib/journal';
import { useLanguage } from '../hooks/useLanguage';
import TypingDots from './TypingDots';
import EmptyState from './EmptyState';
import InsightText from './InsightText';

interface AiInsight { type: string; tag_he: string; tag_en: string; text: string; }

const META: Record<string, { fg: string; bg: string; bd: string }> = {
  opportunity: { fg: '#6fa580', bg: 'rgba(111,165,128,.1)', bd: 'rgba(111,165,128,.32)' },
  warning:     { fg: '#d4af37', bg: 'rgba(212,175,55,.08)', bd: 'rgba(212,175,55,.25)' },
  pattern:     { fg: '#c0c0c0', bg: 'rgba(255,255,255,.04)', bd: 'rgba(255,255,255,.08)' },
};

export default function AIInsightPanel({ trades }: { trades: TradeEntry[] }) {
  const { lang } = useLanguage();
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const closedCount = trades.filter(t => t.result !== 'OPEN').length;

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
      const data = await res.json();
      setInsights(Array.isArray(data.insights) ? data.insights : []);
      setUpdatedAt(new Date().toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch when 3+ closed trades and no insight yet
  useEffect(() => {
    if (closedCount >= 3 && insights.length === 0 && !loading) {
      fetchInsights();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedCount]);

  const lastUpdatedLabel = lang === 'he' ? 'עדכון אחרון' : 'Last updated';

  return (
    <div className="border border-[#1c1c1e] rounded-xl bg-[#0a0a0b] p-6 flex flex-col gap-3 transition-all duration-200 hover:scale-[1.01] hover:border-[#2a2a2d]">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">AI Insight</p>
        <div className="flex items-center gap-3">
          {updatedAt && !loading && (
            <span className="font-mono text-[9px] text-white/25" dir="ltr">{lastUpdatedLabel}: {updatedAt}</span>
          )}
          {(insights.length > 0 || error) && (
            <button
              onClick={fetchInsights}
              disabled={loading}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d4af37]/50 hover:text-[#d4af37] disabled:opacity-30 transition-colors"
            >
              {loading ? '...' : '↺ Refresh'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2">
          <TypingDots />
          <span className="font-mono text-xs text-white/30">{lang === 'he' ? 'מנתח את העסקאות שלך...' : 'Analyzing your trades...'}</span>
        </div>
      )}

      {!loading && insights.length > 0 && (
        <div className="flex flex-col gap-3">
          {insights.map((ins, i) => {
            const m = META[ins.type] ?? META.pattern;
            return (
              <div key={i} className="flex items-start gap-3 rounded-lg p-3" style={{ background: m.bg, border: `1px solid ${m.bd}` }}>
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] shrink-0 mt-0.5" style={{ color: m.fg }}>
                  {lang === 'he' ? ins.tag_he : ins.tag_en}
                </span>
                <InsightText text={ins.text} className="font-mono text-sm text-white/75 leading-relaxed" />
              </div>
            );
          })}
        </div>
      )}

      {!loading && error && (
        <p className="font-mono text-xs text-[#ef4444]/60">שגיאה בטעינת התובנה. בדוק את מפתח ה-API.</p>
      )}

      {!loading && insights.length === 0 && !error && (
        closedCount < 3 ? (
          <EmptyState
            icon="◈"
            title={lang === 'he' ? 'עדיין אין מספיק נתונים' : 'Not enough data yet'}
            description={lang === 'he'
              ? 'הזן לפחות 3 עסקאות כדי שה-AI יוכל לנתח את הדפוסים שלך ולתת המלצות מדויקות.'
              : 'Log at least 3 trades so the AI can analyze your patterns and give you accurate recommendations.'}
          />
        ) : (
          <button
            onClick={fetchInsights}
            className="font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors"
          >
            → {lang === 'he' ? 'נתח את הביצועים שלי' : 'Analyze my performance'}
          </button>
        )
      )}
    </div>
  );
}
