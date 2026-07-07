'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadTrades, saveTrades, softDelete, todayISO, tradePnL, computeStats } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { SESS, getActiveSessionIdx } from '../../lib/sessions';
import TradeForm from '../../components/TradeForm';
import AIInsightPanel from '../../components/AIInsightPanel';
import JournalCalendar from '../../components/JournalCalendar';
import JournalTradeCard from '../../components/JournalTradeCard';
import EmptyState from '../../components/EmptyState';

const M_HEB = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const D_HEB = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'];

function labelDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return `${d} ב${M_HEB[m - 1]} ${y}`;
}
function weekdayLabel(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return D_HEB[new Date(y, m - 1, d).getDay()];
}

const usd = (n: number) => {
  const a = Math.abs(n).toLocaleString('en-US');
  return n > 0 ? '+$' + a : n < 0 ? '-$' + a : '$0';
};
const pnlColor = (n: number) => (n > 0 ? '#4a7c59' : n < 0 ? '#8b3a3a' : 'rgba(255,255,255,0.4)');

export default function JournalPage() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [nowLabel, setNowLabel] = useState('');

  useEffect(() => { setTrades(loadTrades()); }, []);

  // Live-session pill: recompute the clock every 30s so it never goes stale on a long visit.
  useEffect(() => {
    const tick = () => setNowLabel(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  function handleSave(trade: TradeEntry) {
    const updated = [trade, ...trades];
    saveTrades(updated);
    setTrades(updated);
  }

  function handleDelete(id: number) {
    const { updatedTrades } = softDelete(trades, id);
    setTrades(updatedTrades);
  }

  const today = todayISO();
  const activeSessionIdx = getActiveSessionIdx();
  const activeSession = activeSessionIdx >= 0 ? SESS[activeSessionIdx] : null;

  const dates = useMemo(() => [...new Set(trades.map(t => t.dateISO))].sort((a, b) => b.localeCompare(a)), [trades]);
  const shownDates = selectedDate ? dates.filter(d => d === selectedDate) : dates;

  const stats = useMemo(() => computeStats(trades), [trades]);
  const bestTrade = useMemo(() => {
    const pnls = trades.map(tradePnL).filter((n): n is number => n !== null);
    return pnls.length ? Math.max(...pnls) : 0;
  }, [trades]);
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN').length;
  const be = closed.filter(t => t.result === 'BE').length;

  function selectDay(dateISO: string) {
    setSelectedDate(cur => (cur === dateISO ? null : dateISO));
  }
  function setFilter(dateISO: string | null) {
    setSelectedDate(dateISO);
  }

  return (
    <div
      className="flex-1 overflow-y-auto"
      dir="rtl"
      style={{
        background: `
          radial-gradient(60% 70% at 0% 20%, rgba(212,175,55,0.05), transparent 72%),
          radial-gradient(60% 70% at 100% 15%, rgba(122,143,168,0.045), transparent 72%),
          radial-gradient(55% 65% at 0% 85%, rgba(122,143,168,0.035), transparent 70%),
          radial-gradient(55% 65% at 100% 90%, rgba(212,175,55,0.04), transparent 70%),
          radial-gradient(70% 50% at 50% 100%, rgba(212,175,55,0.03), transparent 72%),
          #050505
        `,
      }}
    >
      {/* Header */}
      <div className="border-b border-[#1c1c1e]">
        <div className="max-w-[1480px] mx-auto py-11 px-10 max-[880px]:px-5 max-[880px]:py-7">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="font-mono text-[11px] font-bold tracking-[0.34em] uppercase text-[#d4af37] mb-3.5">TRADING JOURNAL</div>
              <h1 style={{ fontFamily: 'var(--serif)' }} className="text-[46px] max-[880px]:text-[32px] font-bold text-white leading-[1.02] m-0">יומן העסקאות</h1>
              <p className="mt-3 text-[15px] text-white/55 max-w-[440px] leading-relaxed">מעקב, ניתוח ותובנות על ביצועי המסחר שלך — כל עסקה מתועדת עם ההקשר המלא של המושב וההטיה היומית.</p>
            </div>
            <div className="flex items-center gap-3.5 flex-wrap">
              <div className="flex items-center gap-2.5 py-[9px] px-3.5 rounded-sm border" style={{ borderColor: activeSession ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.1)', background: activeSession ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)' }}>
                <span className="w-[7px] h-[7px] rounded-full" style={{ background: activeSession ? '#d4af37' : 'rgba(255,255,255,0.3)', boxShadow: activeSession ? '0 0 8px rgba(212,175,55,0.7)' : 'none' }} />
                <span className="font-mono text-xs font-bold tracking-[0.18em]" style={{ color: activeSession ? '#d4af37' : 'rgba(255,255,255,0.4)' }} dir="ltr">
                  {activeSession ? `${activeSession.he} · ${nowLabel}` : 'מחוץ לשעות מסחר'}
                </span>
              </div>
              <button
                onClick={() => setShowForm(v => !v)}
                className="inline-flex items-center gap-2 py-[13px] px-6 rounded-sm bg-[#d4af37] text-black text-sm font-bold hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.4)]"
              >
                <span className="font-mono text-base">{showForm ? '✕' : '+'}</span> {showForm ? 'ביטול' : 'עסקה חדשה'}
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div className="flex items-stretch mt-[34px] pt-7 border-t border-[#1c1c1e] flex-wrap gap-6">
            <div className="flex-none pe-12 border-e border-[#1c1c1e]">
              <div className="text-xs font-medium text-white/40 mb-2.5">רווח נקי כולל</div>
              <div className="font-mono text-[44px] max-[880px]:text-[32px] font-black tabular-nums tracking-[-0.02em] leading-none" style={{ color: pnlColor(stats.totalPnL), textShadow: stats.totalPnL >= 0 ? '0 0 30px rgba(74,124,89,0.35)' : 'none' }}>
                {usd(stats.totalPnL)}
              </div>
            </div>
            <div className="flex-1 flex items-center ps-12 gap-14 flex-wrap">
              <div>
                <div className="text-xs font-medium text-white/40 mb-2.5">אחוז הצלחה</div>
                <div className="font-mono text-[32px] font-black tabular-nums leading-none text-[#d4af37]" style={{ textShadow: '0 0 22px rgba(212,175,55,0.5)' }}>{stats.winRate.toFixed(0)}%</div>
                <div className="text-[11px] text-white/40 mt-[7px]">{wins} נצחונות · {be} ללא שינוי</div>
              </div>
              <div>
                <div className="text-xs font-medium text-white/40 mb-2.5">יחס סיכון ממוצע</div>
                <div className="font-mono text-[32px] font-black tabular-nums leading-none text-white">{stats.avgR.toFixed(2)}R</div>
              </div>
              <div>
                <div className="text-xs font-medium text-white/40 mb-2.5">העסקה המובילה</div>
                <div className="font-mono text-[32px] font-black tabular-nums leading-none" style={{ color: pnlColor(bestTrade) }}>{usd(bestTrade)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1480px] mx-auto py-10 px-10 max-[880px]:px-5 max-[880px]:py-6 space-y-11">

        {/* Trade Form */}
        {showForm && (
          <div className="rounded-2xl bg-[#0a0a0b] p-6 sm:p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_24px_60px_-24px_rgba(0,0,0,0.7)]">
            <TradeForm
              trades={trades}
              onSave={handleSave}
              onCancel={() => setShowForm(false)}
              onDone={() => setShowForm(false)}
            />
          </div>
        )}

        {/* AI Insight */}
        {trades.length > 0 && <AIInsightPanel trades={trades} />}

        {/* Monthly P&L calendar */}
        {trades.length > 0 && (
          <JournalCalendar trades={trades} selectedDate={selectedDate} onSelectDate={selectDay} />
        )}

        {/* Trade log */}
        <section>
          <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
            <div>
              <div className="font-mono text-[11px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-[9px]">TRADE LOG</div>
              <h2 style={{ fontFamily: 'var(--serif)' }} className="text-[30px] font-bold text-white m-0">פירוט העסקאות</h2>
              <div className="mt-1.5 text-[13px] text-white/40">{selectedDate ? labelDate(selectedDate) : 'מציג את כל העסקאות'}</div>
            </div>
            {dates.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-white/40 me-1">סינון</span>
                {dates.slice(0, 6).map(d => (
                  <button
                    key={d}
                    onClick={() => setFilter(d)}
                    className={`py-2 px-[15px] rounded-sm border font-mono text-xs font-bold tracking-[0.04em] transition-all duration-200 ${
                      selectedDate === d ? 'bg-[#d4af37] text-black border-[#d4af37]' : 'text-white/55 border-[#2a2a2d] hover:text-white/80'
                    }`}
                  >
                    {d === today ? 'היום' : d}
                  </button>
                ))}
                <button
                  onClick={() => setFilter(null)}
                  className={`py-2 px-[18px] rounded-sm border text-xs font-bold transition-all duration-200 ${
                    !selectedDate ? 'bg-[#d4af37] text-black border-[#d4af37]' : 'text-white/55 border-[#2a2a2d] hover:text-white/80'
                  }`}
                >
                  הכל
                </button>
              </div>
            )}
          </div>

          {trades.length === 0 ? (
            <EmptyState
              icon="◈"
              title="היומן שלך ריק — וכך גם היתרון שלך, עד שתתעד עסקה אחת"
              description="כל עסקה שאתה מתעד מחדדת את התמונה: ציון המשמעת שלך, אחוזי ההצלחה לפי סשן, הדפוסים שה-AI מזהה. שום דבר מזה לא קיים לפני העסקה הראשונה. זה לוקח פחות מדקה."
              action={
                <button onClick={() => setShowForm(true)} className="font-mono text-xs text-[#d4af37]/70 hover:text-[#d4af37] transition-colors">
                  + הזן את העסקה הראשונה שלך
                </button>
              }
            />
          ) : (
            shownDates.map(date => {
              const dayTrades = trades.filter(t => t.dateISO === date);
              if (dayTrades.length === 0) return null;
              const dayPnl = dayTrades.map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
              return (
                <div key={date} className="mt-9 first:mt-0">
                  <div className="flex items-baseline gap-3.5 mb-[18px]">
                    <span style={{ fontFamily: 'var(--serif)' }} className="text-[22px] font-bold text-white">{labelDate(date)}</span>
                    <span className="h-px flex-1 bg-[#1c1c1e]" />
                    <span className="text-[13px] text-white/40">{weekdayLabel(date)} · {dayTrades.length} עסקאות</span>
                    <span className="font-mono text-[19px] font-extrabold tabular-nums" style={{ color: pnlColor(dayPnl) }}>{usd(dayPnl)}</span>
                  </div>
                  <div className="flex flex-col gap-4">
                    {dayTrades.map(t => <JournalTradeCard key={t.id} trade={t} onDelete={handleDelete} />)}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
