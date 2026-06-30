'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { loadTrades, saveTrades, softDelete, todayISO, tradePnL } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import TradeForm from '../../components/TradeForm';
import AIInsightPanel from '../../components/AIInsightPanel';
import EmptyState from '../../components/EmptyState';

function TradeRow({ trade, onDelete }: { trade: TradeEntry; onDelete: (id: number) => void }) {
  const pnl = tradePnL(trade);
  const win  = trade.result === 'WIN';
  const loss = trade.result === 'LOSS';
  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-[#111] last:border-0 group hover:bg-white/[0.015] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${win ? 'bg-[#22c55e]' : loss ? 'bg-[#ef4444]' : trade.result === 'BE' ? 'bg-[#d4af37]' : 'bg-white/20'}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-white/90">{trade.symbol}{trade.contracts > 1 ? ` ×${trade.contracts}` : ''}</span>
            <span className="font-mono text-xs text-white/40">{trade.direction}</span>
            {trade.model && <span className="px-1.5 py-0.5 rounded-sm bg-[#1c1c1e] text-[10px] font-mono text-white/40">{trade.model}</span>}
            {trade.session && <span className="font-mono text-[10px] text-white/30">{trade.session}</span>}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="font-mono text-[10px] text-white/30">Entry {trade.entry}</span>
            <span className="font-mono text-[10px] text-white/30">SL {trade.stop}</span>
            <span className="font-mono text-[10px] text-white/30">TP {trade.target}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
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
        <button
          onClick={() => onDelete(trade.id)}
          className="opacity-0 group-hover:opacity-100 font-mono text-[10px] text-white/30 hover:text-[#ef4444] transition-all"
          aria-label="Delete trade"
        >✕</button>
      </div>
    </div>
  );
}

export default function JournalPage() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => { setTrades(loadTrades()); }, []);

  function handleSave(trade: TradeEntry) {
    const updated = [trade, ...trades];
    saveTrades(updated);
    setTrades(updated);
    setShowForm(false);
  }

  function handleDelete(id: number) {
    const { updatedTrades } = softDelete(trades, id);
    setTrades(updatedTrades);
  }

  const today = todayISO();
  const dates = [...new Set(trades.map(t => t.dateISO))].sort((a, b) => b.localeCompare(a));

  const filtered = filter === 'all' ? trades : trades.filter(t => t.dateISO === filter);
  const groupedDates = filter === 'all' ? dates : [filter];

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl font-bold text-white">{en ? 'Journal' : 'יומן מסחר'}</h1>
            <p className="font-mono text-xs text-white/30 mt-1 uppercase tracking-[0.18em]">{trades.length} total trades</p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-5 py-2.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold tracking-[0.12em] uppercase hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.3)]"
          >
            {showForm ? (en ? '✕ Cancel' : '✕ ביטול') : (en ? '+ New Trade' : '+ עסקה חדשה')}
          </button>
        </div>

        {/* Trade Form */}
        {showForm && (
          <div className="border border-[#d4af37]/20 rounded-xl bg-[#0a0a0b] p-6">
            <TradeForm onSave={handleSave} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* AI Insight */}
        {trades.length > 0 && <AIInsightPanel trades={trades} />}

        {/* Date filter */}
        {dates.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-sm font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${filter === 'all' ? 'bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/30' : 'text-white/40 border border-[#1c1c1e] hover:text-white/70'}`}
            >
              {en ? 'All' : 'הכל'}
            </button>
            {dates.slice(0, 7).map(d => (
              <button
                key={d}
                onClick={() => setFilter(d)}
                className={`px-3 py-1 rounded-sm font-mono text-[10px] tracking-[0.10em] transition-colors ${filter === d ? 'bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/30' : 'text-white/40 border border-[#1c1c1e] hover:text-white/70'}`}
              >
                {d === today ? (en ? 'Today' : 'היום') : d}
              </button>
            ))}
          </div>
        )}

        {/* Grouped trade list */}
        {filtered.length === 0 ? (
          <EmptyState
            icon="◈"
            title={en ? 'Your journal is empty — and so is your edge, until you log one' : 'היומן שלך ריק — וכך גם היתרון שלך, עד שתתעד עסקה אחת'}
            description={en
              ? 'Every trade you log sharpens the picture: your discipline score, your win rate by session, the patterns the AI surfaces. None of it exists until the first entry. It takes under a minute.'
              : 'כל עסקה שאתה מתעד מחדדת את התמונה: ציון המשמעת שלך, אחוזי ההצלחה לפי סשן, הדפוסים שה-AI מזהה. שום דבר מזה לא קיים לפני העסקה הראשונה. זה לוקח פחות מדקה.'}
            action={
              <button
                onClick={() => setShowForm(true)}
                className="font-mono text-xs text-[#d4af37]/70 hover:text-[#d4af37] transition-colors"
              >
                {en ? '+ Log your first trade' : '+ הזן את העסקה הראשונה שלך'}
              </button>
            }
          />
        ) : (
          groupedDates.map(date => {
            const dayTrades = filtered.filter(t => t.dateISO === date);
            if (dayTrades.length === 0) return null;
            const dayPnl = dayTrades.map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                    {date === today ? (en ? 'Today' : 'היום') : date}
                  </span>
                  <span className={`font-mono text-xs font-bold ${dayPnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                    {dayPnl >= 0 ? '+' : ''}${Math.abs(dayPnl).toFixed(0)}
                  </span>
                </div>
                <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b]">
                  {dayTrades.map(t => <TradeRow key={t.id} trade={t} onDelete={handleDelete} />)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
