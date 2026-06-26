'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '../hooks/useLanguage';
import { loadTrades, computeStats, todayISO, tradePnL } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import AIInsightPanel from './AIInsightPanel';

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex-1 min-w-[120px] px-5 py-4 border border-[#1c1c1e] rounded-sm bg-[#0a0a0b]">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">{label}</p>
      <p className="font-serif text-2xl font-bold" style={{ color: color ?? '#fff' }}>{value}</p>
      {sub && <p className="font-mono text-[10px] text-white/30 mt-1">{sub}</p>}
    </div>
  );
}

// ── Trade Row ─────────────────────────────────────────────────────────────────

function TradeRow({ trade }: { trade: TradeEntry }) {
  const pnl = tradePnL(trade);
  const win = trade.result === 'WIN';
  const loss = trade.result === 'LOSS';
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#111] last:border-0">
      <div className="flex items-center gap-3">
        <span className={`w-1.5 h-1.5 rounded-full ${win ? 'bg-[#22c55e]' : loss ? 'bg-[#ef4444]' : 'bg-white/30'}`} />
        <span className="font-mono text-sm text-white/80">{trade.symbol}</span>
        <span className="font-mono text-xs text-white/40">{trade.direction}</span>
        {trade.model && <span className="px-2 py-0.5 rounded-sm bg-[#1c1c1e] text-[10px] font-mono text-white/40">{trade.model}</span>}
      </div>
      <div className="flex items-center gap-4">
        {typeof trade.tradeR === 'number' && (
          <span className={`font-mono text-xs font-bold ${win ? 'text-[#22c55e]' : loss ? 'text-[#ef4444]' : 'text-white/40'}`}>
            {trade.tradeR >= 0 ? '+' : ''}{trade.tradeR.toFixed(2)}R
          </span>
        )}
        {pnl !== null && (
          <span className={`font-mono text-sm font-bold tabular-nums ${pnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(0)}
          </span>
        )}
        <span className="font-mono text-[10px] text-white/30">{trade.time}</span>
      </div>
    </div>
  );
}

// ── Daily Plan ────────────────────────────────────────────────────────────────

function DailyPlan() {
  const [plan, setPlan] = useState('');
  const [saved, setSaved] = useState(false);
  const key = `onyx_daily_plan_${todayISO()}`;

  useEffect(() => {
    setPlan(localStorage.getItem(key) ?? '');
  }, [key]);

  function save() {
    localStorage.setItem(key, plan);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">תוכנית יומית</p>
        <button
          onClick={save}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d4af37]/60 hover:text-[#d4af37] transition-colors"
        >
          {saved ? '✓ נשמר' : 'שמור'}
        </button>
      </div>
      <textarea
        value={plan}
        onChange={e => setPlan(e.target.value)}
        placeholder="מה התוכנית שלך להיום? ביאס, רמות מפתח, שיטה..."
        className="w-full bg-transparent resize-none text-sm text-white/70 placeholder-white/20 outline-none font-mono leading-relaxed"
        rows={4}
        dir="rtl"
      />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DashboardView({ role = 'free' }: { role?: 'free' | 'pro' }) {
  const { lang } = useLanguage();
  const en = lang === 'en';

  const [trades, setTrades] = useState<TradeEntry[]>([]);

  useEffect(() => {
    setTrades(loadTrades());
  }, []);

  const today = todayISO();
  const todayTrades = trades.filter(t => t.dateISO === today);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekISO = weekStart.toISOString().slice(0, 10);
  const weekTrades = trades.filter(t => t.dateISO >= weekISO);

  const todayStats = computeStats(todayTrades);
  const weekStats  = computeStats(weekTrades);
  const allStats   = computeStats(trades);

  const todayPnl = todayTrades.map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
  const weekPnl  = weekTrades.map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);

  const pnlColor = (n: number) => n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : '#fff';
  const fmt$ = (n: number) => `${n >= 0 ? '+' : ''}$${Math.abs(n).toLocaleString()}`;

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-serif text-3xl font-bold text-white">
              {en ? 'Dashboard' : 'לוח בקרה'}
            </h1>
            <p className="font-mono text-xs text-white/30 mt-1 uppercase tracking-[0.18em]">{today}</p>
          </div>
          <Link
            href="/dashboard/journal"
            className="px-5 py-2.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold tracking-[0.12em] uppercase hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.3)]"
          >
            {en ? '+ New Trade' : '+ עסקה חדשה'}
          </Link>
        </div>

        {/* PnL Stats */}
        <div className="flex gap-3 flex-wrap">
          <StatCard
            label={en ? "Today's P&L" : 'רווח/הפסד היום'}
            value={todayTrades.length ? fmt$(todayPnl) : '—'}
            sub={`${todayStats.wins}W / ${todayStats.losses}L`}
            color={pnlColor(todayPnl)}
          />
          <StatCard
            label={en ? 'This Week' : 'השבוע'}
            value={weekTrades.length ? fmt$(weekPnl) : '—'}
            sub={`${weekStats.wins}W / ${weekStats.losses}L`}
            color={pnlColor(weekPnl)}
          />
          <StatCard
            label={en ? 'Win Rate' : 'אחוז ניצחון'}
            value={allStats.count > 0 ? `${allStats.winRate.toFixed(0)}%` : '—'}
            sub={`${allStats.wins + allStats.losses} trades`}
          />
          <StatCard
            label={en ? 'Avg R' : 'R ממוצע'}
            value={allStats.count > 0 ? `${allStats.avgR >= 0 ? '+' : ''}${allStats.avgR.toFixed(2)}R` : '—'}
            color={pnlColor(allStats.avgR)}
          />
        </div>

        {/* Daily Plan + AI Insight */}
        <div className="grid grid-cols-1 min-[700px]:grid-cols-2 gap-4">
          <DailyPlan />
          <AIInsightPanel trades={trades} />
        </div>

        {/* Today's Trades */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.22em] text-white/40">
              {en ? "Today's Trades" : 'עסקאות היום'}
            </h2>
            <Link href="/dashboard/journal" className="font-mono text-[10px] text-[#d4af37]/60 hover:text-[#d4af37] transition-colors uppercase tracking-[0.18em]">
              {en ? 'All →' : '← הכל'}
            </Link>
          </div>
          {todayTrades.length === 0 ? (
            <div className="py-12 text-center border border-[#1c1c1e] rounded-sm">
              <p className="font-mono text-sm text-white/20">{en ? 'No trades today' : 'אין עסקאות היום'}</p>
              <Link href="/dashboard/journal" className="mt-3 inline-block font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors">
                {en ? '+ Log first trade' : '+ הזן עסקה ראשונה'}
              </Link>
            </div>
          ) : (
            <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b] px-4">
              {todayTrades.map(t => <TradeRow key={t.id} trade={t} />)}
            </div>
          )}
        </div>

        {role === 'free' && (
          <div className="p-4 border border-[#d4af37]/20 rounded-sm bg-[#d4af37]/5 flex items-center justify-between">
            <p className="font-mono text-xs text-white/50">{en ? 'Unlock AI insights, Playbook & Rules Engine' : 'פתח תובנות AI, פלייבוק ומנוע חוקים'}</p>
            <Link href="/checkout" className="font-mono text-xs font-bold text-[#d4af37] hover:text-[#e5c84a] transition-colors">
              {en ? 'Upgrade →' : '← שדרג'}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
