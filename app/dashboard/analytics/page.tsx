'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { loadTrades, computeStats, groupByKey, rDistribution } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="px-5 py-4 border border-[#1c1c1e] rounded-sm bg-[#0a0a0b]">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">{label}</p>
      <p className="font-serif text-2xl font-bold" style={{ color: color ?? '#fff' }}>{value}</p>
      {sub && <p className="font-mono text-[10px] text-white/30 mt-1">{sub}</p>}
    </div>
  );
}

function BarChart({ data, maxVal }: { data: { label: string; count: number; isWin: boolean }[]; maxVal: number }) {
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map(({ label, count, isWin }) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1">
          <span className="font-mono text-[9px] text-white/30 tabular-nums">{count || ''}</span>
          <div
            className="w-full rounded-sm transition-all duration-500"
            style={{
              height: maxVal > 0 ? `${(count / maxVal) * 100}%` : '4px',
              background: count === 0 ? '#1c1c1e' : isWin ? '#22c55e' : '#ef4444',
              opacity: count === 0 ? 0.3 : 0.8,
              minHeight: '4px',
            }}
          />
          <span className="font-mono text-[8px] text-white/30 leading-none">{label}</span>
        </div>
      ))}
    </div>
  );
}

function GroupTable({ title, groups }: {
  title: string;
  groups: [string, { winRate: number; tradeCount: number; totalPnl: number; avgR: number }][];
}) {
  return (
    <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b] overflow-hidden">
      <div className="px-5 py-3 border-b border-[#1c1c1e]">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{title}</p>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#111]">
            {['', 'Trades', 'Win%', 'Avg R', 'P&L'].map(h => (
              <th key={h} className="px-4 py-2 text-left font-mono text-[10px] text-white/30 uppercase tracking-[0.16em]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([key, s]) => (
            <tr key={key} className="border-b border-[#0d0d0f] hover:bg-white/[0.02] transition-colors">
              <td className="px-4 py-2.5 font-mono text-sm text-white/80">{key}</td>
              <td className="px-4 py-2.5 font-mono text-sm text-white/50">{s.tradeCount}</td>
              <td className="px-4 py-2.5 font-mono text-sm" style={{ color: s.winRate >= 50 ? '#22c55e' : '#ef4444' }}>
                {s.winRate.toFixed(0)}%
              </td>
              <td className="px-4 py-2.5 font-mono text-sm" style={{ color: s.avgR >= 0 ? '#22c55e' : '#ef4444' }}>
                {s.avgR >= 0 ? '+' : ''}{s.avgR.toFixed(2)}R
              </td>
              <td className="px-4 py-2.5 font-mono text-sm" style={{ color: s.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                {s.totalPnl >= 0 ? '+' : ''}${Math.abs(s.totalPnl).toFixed(0)}
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center font-mono text-sm text-white/20">אין נתונים</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('all');

  useEffect(() => { setTrades(loadTrades()); }, []);

  const now = new Date();
  const filtered = trades.filter(t => {
    if (period === 'all') return true;
    const d = new Date(t.dateISO);
    if (period === 'week')  { const w = new Date(now); w.setDate(now.getDate() - 7);    return d >= w; }
    if (period === 'month') { const m = new Date(now); m.setMonth(now.getMonth() - 1);  return d >= m; }
    return true;
  });

  const stats     = computeStats(filtered);
  const rawDist   = rDistribution(filtered);
  const dist      = rawDist.map(d => ({ label: d.bucket, count: d.count, isWin: d.isWin }));
  const byModel   = [...groupByKey(filtered, t => t.model || 'Unspecified').entries()].sort((a, b) => b[1].tradeCount - a[1].tradeCount);
  const bySession = [...groupByKey(filtered, t => t.session || 'Unknown').entries()];
  const maxDist   = Math.max(...dist.map(d => d.count), 1);
  const pnlColor  = (n: number) => n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : '#fff';

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold text-white">{en ? 'Analytics' : 'ניתוח ביצועים'}</h1>
            <p className="font-mono text-xs text-white/30 mt-1 uppercase tracking-[0.18em]">{filtered.length} trades</p>
          </div>
          <div className="flex gap-1">
            {(['week', 'month', 'all'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-sm font-mono text-xs uppercase tracking-[0.14em] transition-colors ${period === p ? 'bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/30' : 'text-white/40 border border-[#1c1c1e] hover:text-white/70'}`}
              >
                {p === 'week' ? (en ? '7D' : 'שבוע') : p === 'month' ? (en ? '30D' : 'חודש') : (en ? 'All' : 'הכל')}
              </button>
            ))}
          </div>
        </div>

        {/* Core metrics */}
        <div className="grid grid-cols-2 min-[600px]:grid-cols-4 gap-3">
          <MetricCard label={en ? 'Net P&L' : 'רווח נקי'} value={`${stats.totalPnL >= 0 ? '+' : ''}$${Math.abs(stats.totalPnL).toFixed(0)}`} color={pnlColor(stats.totalPnL)} sub={`${stats.wins}W / ${stats.losses}L`} />
          <MetricCard label={en ? 'Win Rate' : 'אחוז ניצחון'} value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? '#22c55e' : '#ef4444'} sub={`${stats.wins + stats.losses} closed`} />
          <MetricCard label={en ? 'Avg R' : 'R ממוצע'} value={`${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`} color={pnlColor(stats.avgR)} />
          <MetricCard label={en ? 'Profit Factor' : 'גורם רווח'} value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} color={stats.profitFactor >= 1.5 ? '#22c55e' : stats.profitFactor >= 1 ? '#d4af37' : '#ef4444'} sub="gross W / gross L" />
        </div>

        {/* R Distribution */}
        <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-5">{en ? 'R Distribution' : 'התפלגות R'}</p>
          <BarChart data={dist} maxVal={maxDist} />
        </div>

        {/* By Setup */}
        <GroupTable title={en ? 'Performance by Setup/Model' : 'ביצועים לפי שיטה'} groups={byModel} />

        {/* By Session */}
        <GroupTable title={en ? 'Performance by Session' : 'ביצועים לפי סשן'} groups={bySession} />

      </div>
    </div>
  );
}
