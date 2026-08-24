'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadTrades, saveTrades, softDelete, todayISO, hydrateTradesFromCloud } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { activeSessions, getActiveSessionIdx } from '../../lib/sessions';
import { clockInZone } from '../../lib/time/zone';
import TradeForm from '../../components/TradeForm';
import JournalCalendar from '../../components/JournalCalendar';
import TradeDetailsTable from '../../components/journal/TradeDetailsTable';
import EmptyState from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';

const M_HEB = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function labelDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return `${d} ב${M_HEB[m - 1]} ${y}`;
}

/** useSearchParams() opts the tree into client-side rendering, which Next
 *  requires to sit behind a Suspense boundary — see the default export below. */
function JournalPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [nowLabel, setNowLabel] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TradeEntry | null>(null);
  /** The trade whose chart screenshot is being viewed. The journal stored
   *  screenshots for months with nothing that displayed them; the table's
   *  "גרף" button is the first thing that does. */
  const [chartTrade, setChartTrade] = useState<TradeEntry | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradeEntry | null>(null);
  const [presetModel, setPresetModel] = useState<string | null>(null);
  // Ref-based scroll target for the form panel. window.scrollTo() is a no-op
  // here because the actual scroll container is a nested overflow-y-auto
  // element, not the window itself — so clicking Edit on a trade far down
  // the list looked like it did nothing (the form was opening off-screen).
  const formRef = useRef<HTMLDivElement | null>(null);

  // Instant paint from the local cache, then reconcile with the cloud (pulls in
  // trades logged on other devices, propagates deletes) — the fix for the
  // journal appearing empty after re-login / on a new device.
  useEffect(() => {
    setTrades(loadTrades());
    hydrateTradesFromCloud().then(setTrades).catch(() => { /* keep local */ });
  }, []);

  // Live-session pill: recompute the clock every 30s so it never goes stale on a long visit.
  useEffect(() => {
    const tick = () => setNowLabel(clockInZone());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  function handleSave(trade: TradeEntry) {
    // Upsert semantics: if a trade with this id already exists (edit flow),
    // replace it in place; otherwise prepend as a new trade. The previous
    // version blindly prepended, which duplicated trades on every edit or
    // result-change round-trip.
    const idx = trades.findIndex(t => t.id === trade.id);
    const updated = idx >= 0
      ? trades.map((t, i) => (i === idx ? trade : t))
      : [trade, ...trades];
    saveTrades(updated);
    setTrades(updated);
  }

  function handleDelete(id: number) {
    const { updatedTrades } = softDelete(trades, id);
    setTrades(updatedTrades);
  }

  /** Full edit — opens TradeForm prefilled with the trade. Save updates in
      place via handleSave's upsert. Result buttons live inside the form. */
  function handleEdit(trade: TradeEntry) {
    setEditingTrade(trade);
    setShowForm(true);
    // Ref-based scroll works regardless of which ancestor is the actual
    // scroll container. Delayed slightly so the panel is mounted first.
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
  function closeForm() {
    setShowForm(false);
    setEditingTrade(null);
    setPresetModel(null);
  }

  // "שימוש בסטאפ" on the setups page lands here with ?setup=<name>. Open the
  // form already pointed at that setup, so the trip from "this is my rule" to
  // "here is a trade that followed it" is one click and no re-picking.
  //
  // Read once, on mount: the parameter describes how the page was ENTERED. Left
  // in the URL it would re-arm on every later open of the form, quietly
  // stamping a setup onto trades the trader never associated with it.
  useEffect(() => {
    const name = searchParams.get('setup');
    if (!name) return;
    setPresetModel(name);
    setEditingTrade(null);
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    router.replace('/dashboard/journal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayISO();
  // Indexed against the enabled windows — the same table getActiveSessionIdx
  // matched on.
  const sessions = useMemo(() => activeSessions(), []);
  const activeSessionIdx = getActiveSessionIdx();
  const activeSession = activeSessionIdx >= 0 ? sessions[activeSessionIdx] : null;

  const dates = useMemo(() => [...new Set(trades.map(t => t.dateISO))].sort((a, b) => b.localeCompare(a)), [trades]);
  // The table groups by day itself, so the page hands it a flat list carrying
  // the date filter that is already on screen above it.
  const shownTrades = useMemo(
    () => (selectedDate ? trades.filter(t => t.dateISO === selectedDate) : trades),
    [trades, selectedDate],
  );

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
        <div className="max-w-[2000px] mx-auto py-11 px-10 max-[880px]:px-5 max-[880px]:py-7">
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
                onClick={() => {
                  if (showForm) closeForm();
                  else { setEditingTrade(null); setShowForm(true); }
                }}
                className="inline-flex items-center gap-2 py-[13px] px-6 rounded-sm bg-[#d4af37] text-black text-sm font-bold hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.4)]"
              >
                <span className="font-mono text-base">{showForm ? '✕' : '+'}</span> {showForm ? 'ביטול' : 'עסקה חדשה'}
              </button>
            </div>
          </div>

          {/* How many trades are in view, and nothing else.
              Net profit, win rate, average R and the best trade all live on
              the dashboard, which is their home — four numbers repeated on a
              second screen are four chances for two screens to disagree. */}
          <div className="mt-[34px] pt-7 border-t border-[#1c1c1e]">
            <span className="font-mono text-[13px] font-bold tracking-[0.16em] uppercase text-white/40">
              {trades.length} עסקאות{selectedDate ? ' ביום שנבחר' : ' ביומן'}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[2000px] mx-auto py-10 px-10 max-[880px]:px-5 max-[880px]:py-6 space-y-11">

        {/* Trade Form */}
        {showForm && (
          <div
            ref={formRef}
            className="rounded-2xl bg-[#0a0a0b] p-6 sm:p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_24px_60px_-24px_rgba(0,0,0,0.7)] scroll-mt-6"
          >
            {editingTrade && (
              <div className="mb-4 -mt-1 flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.16em] text-[#d4af37]">
                <span>▸</span> עריכת עסקה קיימת · {editingTrade.symbol} · {editingTrade.dateISO}
              </div>
            )}
            {/* A field filled in by a link, not by the trader, has to say so —
                otherwise the setup chip looks like something they picked. */}
            {!editingTrade && presetModel && (
              <div className="mb-4 -mt-1 flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.16em] text-[#d4af37]">
                <span>◈</span> נפתח עם הסטאפ <span className="text-white">{presetModel}</span>
              </div>
            )}
            <TradeForm
              key={editingTrade?.id ?? (presetModel ? `new:${presetModel}` : 'new')}
              trades={trades}
              initial={editingTrade ?? undefined}
              presetModel={presetModel ?? undefined}
              onSave={handleSave}
              onCancel={closeForm}
              onDone={closeForm}
            />
          </div>
        )}

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
            <TradeDetailsTable
              trades={shownTrades}
              onEdit={handleEdit}
              onDelete={t => setDeleteTarget(t)}
              onOpenChart={t => setChartTrade(t)}
            />
          )}
        </section>
      </div>

      {chartTrade?.screenshots?.[0] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="צילום הגרף של העסקה"
          onClick={() => setChartTrade(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
        >
          {/* The image is the dialog; anywhere else closes it. No frame, no
              chrome — the screenshot is what the trader came to look at. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chartTrade.screenshots[0]}
            alt={`גרף · ${chartTrade.symbol} · ${chartTrade.dateISO}`}
            className="max-h-full max-w-full rounded-sm border border-[#2a2a2d] object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setChartTrade(null)}
            aria-label="סגור"
            className="fixed top-6 end-6 font-mono text-sm text-white/60 transition-colors hover:text-white"
          >✕</button>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="למחוק עסקה?"
        message={deleteTarget
          ? <>העסקה ב-<span className="text-white">{deleteTarget.symbol}</span> ({deleteTarget.direction === 'LONG' ? 'לונג' : 'שורט'}) מ-<span className="text-white">{labelDate(deleteTarget.dateISO)}</span> תימחק לצמיתות. אי אפשר לשחזר אותה.</>
          : ''}
        confirmLabel="מחק"
        cancelLabel="ביטול"
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}


export default function JournalPage() {
  return (
    <Suspense fallback={null}>
      <JournalPageInner />
    </Suspense>
  );
}
