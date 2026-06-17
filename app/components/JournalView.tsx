'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { useCountUp } from '../hooks/useCountUp';
import { useMarketStream } from '../hooks/useMarketStream';
import type { SessionName } from '../hooks/useMarketStream';
import {
  type TradeEntry,
  type TradeResult,
  type Bias,
  type Setup,
  type IFVGConfirmation,
  type BiasAlignment,
  type LockoutConfig,
  type LockoutState,
  type DeletedTradeEntry,
  computeStats,
  todayISO,
  loadTrades,
  saveTrades,
  loadLockoutConfig,
  saveLockoutConfig,
  DEFAULT_LOCKOUT,
  evaluateLockout,
  PT_VALUE,
  loadTrash,
  softDelete,
  restoreTrade,
  daysUntilExpiry,
} from '../lib/journal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Bi = { he: string; en: string };
const pick = (b: Bi, en: boolean) => (en ? b.en : b.he);

const GOLD_GLOW = 'text-[#d4af37] [text-shadow:0_0_22px_rgba(212,175,55,0.5)]';

const SESSION_LABELS: Record<SessionName, string> = {
  ASIA:   'אסיה · 02:00–07:00',
  LONDON: 'לונדון · 09:00–12:00',
  NY_AM:  'ניו יורק AM · 16:00–18:00',
  NY_PM:  'ניו יורק PM · 19:50–22:00',
};

function getCurrentSession(): SessionName | null {
  const now = new Date();
  const idt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hour12: false,
  }).format(now);
  const [h, m] = idt.split(':').map(Number);
  const mins = h * 60 + m;
  if (mins >= 2*60  && mins < 7*60)  return 'ASIA';
  if (mins >= 9*60  && mins < 12*60) return 'LONDON';
  if (mins >= 16*60 && mins < 18*60) return 'NY_AM';
  if (mins >= 20*60 && mins < 22*60) return 'NY_PM';
  return null;
}

function biasCls(b: Bias): string {
  return b === 'BULLISH' ? 'text-[#6fa580]' : b === 'BEARISH' ? 'text-[#c98080]' : 'text-white/50';
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    maximumFractionDigits: 0, signDisplay: 'always',
  }).format(Number.isFinite(n) ? n : 0);

const fmtPF = (n: number) => (n === Infinity ? '∞' : n.toFixed(2));

// ─── Segmented control ────────────────────────────────────────────────────────

function Seg<T extends string>({
  value, options, onChange, size = 'sm',
}: {
  value: T;
  options: { val: T; label: string; activeCls?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'lg';
}) {
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button
          key={o.val}
          type="button"
          onClick={() => onChange(o.val)}
          className={`flex-1 border font-mono font-bold transition-colors duration-200 rounded-sm ${
            size === 'lg' ? 'px-4 py-[11px] text-[12px]' : 'px-3 py-[8px] text-[11px]'
          } ${
            value === o.val
              ? (o.activeCls ?? 'bg-[#d4af37]/15 border-[#d4af37]/60 text-[#d4af37]')
              : 'bg-[#0d0d0f] border-[#2a2a2d] text-white/45 hover:text-white/70'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Chart upload ─────────────────────────────────────────────────────────────

function ChartUpload() {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  const handleFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPreview({ url: URL.createObjectURL(file), name: file.name });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
        Chart
      </label>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
        className={`flex items-center gap-2 h-[42px] px-3 rounded border border-dashed cursor-pointer transition-all duration-300 ${
          dragOver ? 'border-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] bg-[#0d0d0f] hover:border-[#d4af37]/40'
        }`}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt="chart" className="h-6 w-6 rounded object-cover border border-[#d4af37]/30" />
            <span className="font-mono text-[11px] text-white/70 truncate max-w-[120px]">{preview.name}</span>
            <button onClick={e => { e.stopPropagation(); setPreview(null); }}
              className="ml-auto font-mono text-[11px] text-white/30 hover:text-[#c98080]">✕</button>
          </>
        ) : (
          <span className="font-mono text-[11px] text-[#d4af37]/60">⬆ העלה גרף</span>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => handleFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}

// ─── Label for form sections ──────────────────────────────────────────────────

function FormSection({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pb-2 mb-3 border-b border-[#1c1c1e]">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#d4af37]">{label}</span>
    </div>
  );
}

// ─── Result tag in table ──────────────────────────────────────────────────────

function ResultTag({ r }: { r: TradeResult }) {
  const cls = r === 'WIN'  ? 'border-[#4a7c59]/60 text-[#6fa580] bg-[#4a7c59]/10' :
              r === 'LOSS' ? 'border-[#7c3a3a]/60 text-[#c98080] bg-[#7c3a3a]/10' :
              r === 'BE'   ? 'border-[#d4af37]/50 text-[#d4af37] bg-[#d4af37]/8'  :
                             'border-[#2a2a2d] text-white/50';
  return (
    <span className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold`+` ${cls}`}>{r}</span>
  );
}

// ─── Setup tag in table ───────────────────────────────────────────────────────

function SetupTag({ s }: { s: Setup | undefined }) {
  if (!s) return <span className="text-white/25 font-mono text-[10px]">—</span>;
  const cls = s === 'REVERSAL'
    ? 'border-[#4a7c59]/50 text-[#6fa580] bg-[#4a7c59]/10'
    : 'border-[#d4af37]/40 text-[#d4af37] bg-[#d4af37]/8';
  const label = s === 'REVERSAL' ? 'ריברסל' : 'המשכיות';
  return <span className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold ${cls}`}>{label}</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JournalView() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const { esDailyBias } = useMarketStream();

  const [trades, setTrades]       = useState<TradeEntry[]>([]);
  const [addOpen, setAddOpen]     = useState(false);
  const [lockoutCfg, setLockoutCfg]   = useState<LockoutConfig>(DEFAULT_LOCKOUT);
  const [lockoutOpen, setLockoutOpen] = useState(false);
  const [trash, setTrash]         = useState<DeletedTradeEntry[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);

  const [draft, setDraft] = useState<Partial<TradeEntry & { manualTime?: string }>>({
    symbol: 'ES', direction: 'LONG', result: 'OPEN', model: '',
    setup: 'REVERSAL', confirmation: 'IFVG_2M',
    dateISO: todayISO(),
  });

  useEffect(() => {
    setTrades(loadTrades());
    setLockoutCfg(loadLockoutConfig());
    setTrash(loadTrash());
  }, []);

  const lockout: LockoutState = useMemo(
    () => evaluateLockout(trades, lockoutCfg),
    [trades, lockoutCfg],
  );

  function handleDelete(id: number) {
    const { updatedTrades, updatedTrash } = softDelete(trades, id);
    setTrades(updatedTrades);
    setTrash(updatedTrash);
  }

  function updateLockoutCfg(patch: Partial<LockoutConfig>) {
    setLockoutCfg(prev => {
      const next = { ...prev, ...patch };
      saveLockoutConfig(next);
      return next;
    });
  }

  const session      = getCurrentSession();
  const sessionLabel = session ? SESSION_LABELS[session] : 'Between Sessions';
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const nowStr = new Date().toTimeString().slice(0, 5);

  // ── Stats ─────────────────────────────────────────────────────────────
  const allStats   = useMemo(() => computeStats(trades), [trades]);
  const todayTrades = useMemo(
    () => trades.filter(t => t.dateISO === todayISO()),
    [trades],
  );
  const todayStats  = useMemo(() => computeStats(todayTrades), [todayTrades]);
  const avgTrade    = allStats.count > 0 ? allStats.totalPnL / allStats.count : 0;

  const animWinRate = useCountUp(allStats.winRate, 500);
  const animPnL     = useCountUp(allStats.totalPnL, 600);
  const animPF      = useCountUp(allStats.profitFactor === Infinity ? 0 : allStats.profitFactor, 500);

  // ── Live R preview ────────────────────────────────────────────────────
  const liveE    = Number(draft.entry)  || 0;
  const liveS    = Number(draft.stop)   || 0;
  const liveT    = Number(draft.target) || 0;
  const liveSym  = draft.symbol ?? 'ES';
  const livePtV  = PT_VALUE[liveSym];
  const liveRisk = liveE && liveS ? Math.abs(liveE - liveS) : 0;
  const liveDirN = draft.direction === 'SHORT' ? -1 : 1;
  const liveRR   = liveRisk > 0 && liveT ? ((liveT - liveE) * liveDirN) / liveRisk : 0;
  const liveRiskUsd  = liveRisk * livePtV;
  const livePotUsd   = liveRR * liveRiskUsd;

  function setField(key: string, val: string | number) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  function submitTrade() {
    const e = Number(draft.entry), s = Number(draft.stop), t = Number(draft.target);
    if (!e || !s || !t) return;
    const sym    = draft.symbol    ?? 'ES';
    const dir    = draft.direction ?? 'LONG';
    const result = draft.result    ?? 'OPEN';
    const bias   = esDailyBias.bias;
    const ptVal  = PT_VALUE[sym];
    const risk   = Math.abs(e - s);
    const dirNum = dir === 'LONG' ? 1 : -1;
    const plannedR = risk > 0 ? ((t - e) * dirNum) / risk : 0;
    const tradeR: number = result === 'WIN' ? plannedR : result === 'LOSS' ? -1 : 0;
    const pnlUsd: number = result === 'WIN' ? tradeR * ptVal : result === 'LOSS' ? -risk * ptVal : 0;
    const biasAlignment: BiasAlignment =
      ((bias === 'BULLISH' && dir === 'LONG') || (bias === 'BEARISH' && dir === 'SHORT'))
        ? 'ALIGNED' : 'COUNTER';

    const newTrade: TradeEntry = {
      id: Date.now(),
      dateISO: draft.dateISO ?? todayISO(),
      time: session ? nowStr : ((draft as { manualTime?: string }).manualTime ?? nowStr),
      symbol: sym,
      direction: dir,
      entry: e, stop: s, target: t,
      session: session ?? 'NONE',
      bias,
      model: (draft.model ?? '').trim() || 'Unspecified',
      result,
      notes: draft.notes ?? '',
      setup: draft.setup ?? 'REVERSAL',
      confirmation: draft.confirmation ?? 'IFVG_2M',
      biasAlignment,
      tradeR,
      pnlUsd,
    };

    setTrades(prev => {
      const updated = [newTrade, ...prev];
      saveTrades(updated);
      return updated;
    });
    setAddOpen(false);
    setDraft({ symbol: 'ES', direction: 'LONG', result: 'OPEN', model: '', setup: 'REVERSAL', confirmation: 'IFVG_2M', dateISO: todayISO() });
  }

  const inputCls =
    'w-full bg-[#0d0d0f] border border-[#2a2a2d] rounded-sm px-3 py-[9px] text-[13px] font-bold font-mono text-white ' +
    'tabular-nums tracking-wide outline-none transition-colors duration-200 focus:border-[#d4af37]/60 placeholder:text-white/20';

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black text-white">

      {/* ── Topbar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 h-[58px] flex items-center justify-between px-9 bg-[rgba(8,8,9,.92)] backdrop-blur border-b border-[#1c1c1e] shrink-0">
        <div className="flex items-center gap-3" dir="rtl">
          <span className="px-3 py-1 rounded-sm border border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37] font-mono text-[11px] font-bold tracking-[0.2em] uppercase [box-shadow:0_0_18px_rgba(212,175,55,0.22)]">
            PRO
          </span>
          <h1 className="font-serif text-[20px] font-bold text-white leading-none">יומן מסחר</h1>
          <span className="font-mono text-[11px] text-white/40 hidden sm:block">{dateStr}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${session ? 'bg-[#d4af37] animate-pulse' : 'bg-white/30'}`} />
          <span className={`font-mono text-[12px] font-bold tracking-[0.14em] uppercase ${session ? 'text-[#d4af37]' : 'text-white/40'}`}>
            {sessionLabel}
          </span>
        </div>
      </div>

      {/* ── PerfStrip ──────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-px bg-[#1c1c1e] border-b border-[#1c1c1e] shrink-0">
        {/* 1 · עסקאות היום */}
        <div className="bg-black px-6 py-[18px] flex flex-col gap-[7px]">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/45">עסקאות היום</span>
          <span className="font-mono text-[28px] font-black tabular-nums text-white">
            {todayStats.count}
            <span className="text-[13px] font-bold text-white/40 ml-2">{todayStats.wins}W · {todayStats.losses}L</span>
          </span>
          <span className="font-mono text-[10px] text-white/30">סה״כ: {allStats.count} עסקאות</span>
        </div>

        {/* 2 · Win Rate */}
        <div className="bg-black px-6 py-[18px] flex flex-col gap-[7px]">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/45">Win Rate</span>
          <span className={`font-mono text-[28px] font-black tabular-nums ${GOLD_GLOW}`}>
            {animWinRate.toFixed(1)}%
          </span>
          <span className="font-mono text-[10px] text-white/30">{allStats.wins} ניצחונות · {allStats.losses} הפסדים</span>
        </div>

        {/* 3 · Profit Factor */}
        <div className="bg-black px-6 py-[18px] flex flex-col gap-[7px]">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/45">Profit Factor</span>
          <span className={`font-mono text-[28px] font-black tabular-nums ${GOLD_GLOW}`}>
            {allStats.profitFactor === Infinity ? '∞' : animPF.toFixed(2)}
          </span>
          <span className="font-mono text-[10px] text-white/30">רווחים / הפסדים</span>
        </div>

        {/* 4 · P&L */}
        <div className="bg-black px-6 py-[18px] flex flex-col gap-[7px]">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/45">סה״כ P&L</span>
          <span className={`font-mono text-[28px] font-black tabular-nums ${animPnL >= 0 ? 'text-[#6fa580]' : 'text-[#c98080]'}`}>
            {usd(animPnL)}
          </span>
          <span className="font-mono text-[10px] text-white/30">ממוצע עסקה {usd(avgTrade)}</span>
        </div>

        {/* 5 · הפסדים היום */}
        <div className="bg-black px-6 py-[18px] flex flex-col gap-[7px]">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/45">הפסדים היום</span>
          <span className="font-mono text-[28px] font-black tabular-nums text-white">
            {lockout.lossesToday}
            <span className="text-[13px] font-bold text-white/40">/{lockoutCfg.maxLosses || '∞'}</span>
          </span>
          <span className={`font-mono text-[10px] ${GOLD_GLOW}`}>⚙ Lockout: {lockoutCfg.maxLosses} הפסדים מקס׳</span>
        </div>
      </div>

      {/* ── Lockout Banner ─────────────────────────────────────── */}
      {lockout.locked && (
        <div className="flex items-center justify-between px-9 py-[11px] border-b border-[#7c3a3a]/40 bg-[#7c3a3a]/8 shrink-0">
          <div className="flex items-center gap-2.5" dir="rtl">
            <span className="h-2 w-2 rounded-full bg-[#c98080] animate-pulse shrink-0" />
            <div>
              <span className="block font-mono text-[13px] font-black text-[#c98080] tracking-wide">
                עצור להיום — נעילת הגנה הופעלה
              </span>
              <span className="block font-mono text-[10px] text-white/50 mt-0.5">
                {lockout.reasons.includes('losses') && `${lockout.lossesToday} הפסדים היום`}
                {lockout.reasons.includes('losses') && lockout.reasons.includes('dailyLoss') && ' · '}
                {lockout.reasons.includes('dailyLoss') && `PnL יומי ${usd(lockout.pnlToday)}`}
              </span>
            </div>
          </div>
          <span className="px-3 py-1 rounded-sm border border-[#c98080]/50 bg-[#c98080]/10 text-[#c98080] font-serif text-[11px] font-bold tracking-[0.2em] uppercase">
            Locked
          </span>
        </div>
      )}

      {/* ── Lockout Settings ───────────────────────────────────── */}
      {lockoutOpen && (
        <div className="flex items-center gap-[18px] flex-wrap px-9 py-[13px] border-b border-[#1c1c1e] bg-[#0d0d0f] shrink-0" dir="ltr">
          <label className="flex items-center gap-2 font-mono text-[12px] font-bold text-white/80 cursor-pointer">
            <input type="checkbox" checked={lockoutCfg.enabled}
              onChange={e => updateLockoutCfg({ enabled: e.target.checked })}
              className="accent-[#d4af37]" />
            Enable Lockout
          </label>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">מקס׳ הפסדים / יום</label>
            <input type="number" min={0} value={lockoutCfg.maxLosses}
              onChange={e => updateLockoutCfg({ maxLosses: Math.max(0, Math.floor(Number(e.target.value))) })}
              className="bg-[#1c1c1e] border border-[#2a2a2d] rounded px-2.5 py-1.5 font-mono text-[13px] font-bold text-white w-20 outline-none focus:border-[#d4af37]/50" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">מקס׳ הפסד יומי ($)</label>
            <input type="number" min={0} step={50} value={lockoutCfg.maxDailyLossUsd}
              onChange={e => updateLockoutCfg({ maxDailyLossUsd: Math.max(0, Math.floor(Number(e.target.value))) })}
              className="bg-[#1c1c1e] border border-[#2a2a2d] rounded px-2.5 py-1.5 font-mono text-[13px] font-bold text-white w-24 outline-none focus:border-[#d4af37]/50" />
          </div>
          <span className="font-mono text-[10px] text-white/35 max-w-xs leading-relaxed">
            0 מבטל את הטריגר. הנעילה מתאפסת אוטומטית ביום הבא.
          </span>
        </div>
      )}

      {/* ── Log Area ───────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">

        {/* Log Header */}
        <div className="flex items-center justify-between px-9 py-[14px] border-b border-[#1c1c1e] bg-[#0d0d0f] shrink-0">
          <span className="font-mono text-[13px] font-bold uppercase tracking-[0.18em] text-white">Trade Log</span>
          <div className="flex items-center gap-2">
            {lockoutCfg.enabled && lockoutCfg.maxLosses > 0 && (
              <span className={`font-mono text-[11px] font-bold ${lockout.locked ? 'text-[#c98080]' : 'text-white/45'}`}>
                Losses {lockout.lossesToday}/{lockoutCfg.maxLosses}
              </span>
            )}
            <button onClick={() => setTrashOpen(o => !o)}
              className="flex items-center gap-2 px-3 py-1.5 border border-[#2a2a2d] rounded text-xs font-bold font-mono tracking-wider text-white/50 hover:text-white/80 transition-colors">
              🗑 <span>{pick({ he: 'סל מחזור', en: 'Trash' }, en)}</span>
              {trash.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-[#7c3a3a]/25 text-[#c98080] text-[9px] font-black flex items-center justify-center">
                  {trash.length}
                </span>
              )}
            </button>
            <button onClick={() => setLockoutOpen(o => !o)}
              className="px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] bg-[#0d0d0f] border border-[#2a2a2d] text-white/50 rounded hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-all duration-300">
              ⚙ Lockout
            </button>
            <button
              onClick={() => { if (!lockout.locked) setAddOpen(o => !o); }}
              disabled={lockout.locked}
              className={`px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] border rounded transition-all duration-300 ${
                lockout.locked
                  ? 'bg-[#c98080]/10 text-[#c98080]/50 border-[#c98080]/25 cursor-not-allowed'
                  : 'bg-[#d4af37]/10 text-[#d4af37] border-[#d4af37]/35 hover:bg-[#d4af37]/18 hover:border-[#d4af37]/60'
              }`}
            >
              {lockout.locked ? '🔒 Locked' : '+ הוסף עסקה'}
            </button>
          </div>
        </div>

        {/* ── Trash Panel ────────────────────────────────────────── */}
        {trashOpen && (
          <div className="border-b border-[#7c3a3a]/30 bg-[#7c3a3a]/5 shrink-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#7c3a3a]/20">
              <span className="text-xs font-bold font-mono uppercase tracking-[0.18em] text-[#c98080]/80">
                {pick({ he: 'סל מחזור', en: 'Recycle Bin' }, en)}
              </span>
              <span className="text-xs font-mono text-white/35">
                {pick({ he: 'נמחק אוטומטית לאחר 30 יום', en: 'Auto-deleted after 30 days' }, en)}
              </span>
            </div>
            {trash.length === 0 ? (
              <div className="px-5 py-6 text-center font-mono text-sm text-white/30">
                {pick({ he: 'הסל ריק', en: 'Trash is empty' }, en)}
              </div>
            ) : (
              <div className="divide-y divide-[#7c3a3a]/10 max-h-64 overflow-y-auto">
                {trash.map(({ trade: t, deletedAt }) => (
                  <div key={t.id} className="flex items-center justify-between px-5 py-3 gap-4">
                    <div className="flex items-center gap-4 min-w-0 font-mono text-xs">
                      <span className="text-white/40 tabular-nums">{t.time}</span>
                      <span className="text-white font-bold">{t.symbol}</span>
                      <span className={t.direction === 'LONG' ? 'text-[#6fa580] font-bold' : 'text-[#c98080] font-bold'}>
                        {t.direction}
                      </span>
                      <span className="text-white/60 tabular-nums">{t.entry.toFixed(2)}</span>
                      <span className={`font-bold ${
                        t.result === 'WIN'  ? 'text-[#6fa580]' :
                        t.result === 'LOSS' ? 'text-[#c98080]' :
                        t.result === 'BE'   ? 'text-[#d4af37]' : 'text-white/50'
                      }`}>{t.result}</span>
                      <span className="text-white/30">{t.session}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] font-mono text-white/30 tabular-nums">
                        {pick({ he: `נמחק בעוד ${daysUntilExpiry(deletedAt)} יום`, en: `expires in ${daysUntilExpiry(deletedAt)}d` }, en)}
                      </span>
                      <button
                        onClick={() => {
                          const { updatedTrades, updatedTrash } = restoreTrade(trades, trash, t.id);
                          setTrades(updatedTrades);
                          setTrash(updatedTrash);
                        }}
                        className="px-3 py-1 text-[11px] font-bold font-mono tracking-wider uppercase border border-[#d4af37]/40 text-[#d4af37] rounded hover:bg-[#d4af37]/10 transition-colors"
                      >
                        {pick({ he: '↩ שחזר', en: '↩ Restore' }, en)}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Add Entry Form ─────────────────────────────────────── */}
        {addOpen && (
          <div className="border-b border-[#1c1c1e] bg-black px-9 py-[22px] shrink-0">

            {/* Auto-stamp strip */}
            <div className="flex items-center gap-6 p-[11px_16px] bg-[#0d0d0f] border border-[#1c1c1e] rounded-[5px] mb-5">
              {[
                { label: 'סשן',      val: session ?? 'None'         },
                { label: 'ביאס ES',  val: esDailyBias.bias          },
                { label: 'שעה ET',   val: nowStr                    },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d4af37] animate-pulse" />
                  <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.16em]">{item.label}</span>
                  <span className={`font-mono text-[11px] font-bold ${GOLD_GLOW}`}>{item.val}</span>
                </div>
              ))}
              <span className="ml-auto font-mono text-[10px] text-white/25">← מוחתם אוטומטית</span>
            </div>

            {/* Section: פרטי עסקה */}
            <FormSection label="פרטי עסקה" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-[14px] mb-4">
              {/* תאריך */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{pick({ he: 'תאריך', en: 'Date' }, en)}</label>
                <input
                  type="date"
                  value={(draft as { dateISO?: string }).dateISO ?? todayISO()}
                  onChange={e => setField('dateISO', e.target.value)}
                  dir="ltr"
                  className="bg-[#101013] border border-[#2a2a2d] rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#d4af37]/50"
                />
              </div>
              {/* שעת כניסה ידנית — רק כשאין סשן */}
              {!session && (
                <div className="flex flex-col gap-2">
                  <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{pick({ he: 'שעת כניסה', en: 'Entry Time' }, en)}</label>
                  <input
                    type="time"
                    value={(draft as { manualTime?: string }).manualTime ?? nowStr}
                    onChange={e => setField('manualTime', e.target.value)}
                    dir="ltr"
                    className="bg-[#101013] border border-[#2a2a2d] rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#d4af37]/50"
                  />
                </div>
              )}
              {/* נכס */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">נכס</label>
                <Seg value={draft.symbol ?? 'ES'} onChange={v => setField('symbol', v)}
                  options={[{ val: 'ES', label: 'ES' }, { val: 'NQ', label: 'NQ' }]} />
              </div>
              {/* כיוון */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">כיוון</label>
                <Seg value={draft.direction ?? 'LONG'} onChange={v => setField('direction', v)}
                  options={[
                    { val: 'LONG',  label: '▲ לונג',  activeCls: 'bg-[#4a7c59]/18 border-[#4a7c59]/60 text-[#6fa580]' },
                    { val: 'SHORT', label: '▼ שורט', activeCls: 'bg-[#7c3a3a]/18 border-[#7c3a3a]/60 text-[#c98080]' },
                  ]} />
              </div>
              {/* כניסה */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">כניסה</label>
                <input type="number" inputMode="decimal" placeholder="0.00"
                  value={draft.entry ?? ''} onChange={e => setField('entry', e.target.value)}
                  className={inputCls} />
              </div>
              {/* סטופ */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">סטופ</label>
                <input type="number" inputMode="decimal" placeholder="0.00"
                  value={draft.stop ?? ''} onChange={e => setField('stop', e.target.value)}
                  className={inputCls} />
              </div>
              {/* טארגט */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">טארגט</label>
                <input type="number" inputMode="decimal" placeholder="0.00"
                  value={draft.target ?? ''} onChange={e => setField('target', e.target.value)}
                  className={inputCls} />
              </div>
            </div>

            {/* R preview bar */}
            <div className="flex items-center gap-4 flex-wrap p-[12px_16px] bg-[#0d0d0f] border border-[#d4af37]/22 rounded-[5px] mb-4">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-white/35 uppercase tracking-[0.16em]">R:R מתוכנן</span>
                <span className={`font-mono text-[18px] font-black tabular-nums ${GOLD_GLOW}`}>
                  {liveRR > 0 ? liveRR.toFixed(2) : '—'}
                </span>
              </div>
              <div className="h-5 w-px bg-[#1c1c1e]" />
              <span className="font-mono text-[11px] font-bold text-white/45">
                סיכון <span className="text-[#c98080]">{liveRiskUsd > 0 ? usd(-liveRiskUsd).replace('+','') : '—'}</span>
                {' · '}{liveSym}
              </span>
              <div className="h-5 w-px bg-[#1c1c1e]" />
              <span className="font-mono text-[11px] font-bold text-white/45">
                פוטנציאל <span className="text-[#6fa580]">{livePotUsd > 0 ? usd(livePotUsd) : '—'}</span>
              </span>
              <div className="ml-auto">
                <Seg<TradeResult> value={draft.result ?? 'OPEN'} onChange={v => setField('result', v)}
                  options={[
                    { val: 'WIN',  label: 'WIN',  activeCls: 'bg-[#4a7c59]/18 border-[#4a7c59]/60 text-[#6fa580]' },
                    { val: 'LOSS', label: 'LOSS', activeCls: 'bg-[#7c3a3a]/18 border-[#7c3a3a]/60 text-[#c98080]' },
                    { val: 'BE',   label: 'BE',   activeCls: 'bg-[#d4af37]/15 border-[#d4af37]/50 text-[#d4af37]' },
                    { val: 'OPEN', label: 'OPEN', activeCls: 'bg-white/8 border-white/30 text-white' },
                  ]} />
              </div>
            </div>

            {/* Section: סיווג סטאפ */}
            <FormSection label="סיווג סטאפ · נדרש לניתוח ביצועים" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] mb-4">
              {/* סוג סטאפ */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">סוג סטאפ</label>
                <Seg<Setup> value={draft.setup ?? 'REVERSAL'} onChange={v => setField('setup', v)} size="lg"
                  options={[
                    {
                      val: 'REVERSAL',
                      label: 'ריברסל — לקיחת נזילות + היפוך',
                      activeCls: 'bg-[#4a7c59]/15 border-[#4a7c59]/55 text-[#6fa580]',
                    },
                    {
                      val: 'CONTINUATION',
                      label: 'המשכיות — כניסה לגאפ 15M / 5M',
                      activeCls: 'bg-[#d4af37]/12 border-[#d4af37]/50 text-[#d4af37]',
                    },
                  ]} />
              </div>
              {/* IFVG */}
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">אישור · IFVG רגל מניפולציה</label>
                <Seg<IFVGConfirmation> value={draft.confirmation ?? 'IFVG_2M'} onChange={v => setField('confirmation', v)} size="lg"
                  options={[
                    { val: 'IFVG_1M', label: '1M' },
                    { val: 'IFVG_2M', label: '2M' },
                    { val: 'IFVG_3M', label: '3M' },
                    { val: 'IFVG_5M', label: '5M' },
                  ]} />
              </div>
            </div>

            {/* Section: הערות */}
            <FormSection label="הערות" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">הערות חופשיות</label>
                <input type="text" dir="rtl" placeholder="תיאור הסטאפ..."
                  value={draft.notes ?? ''} onChange={e => setField('notes', e.target.value)}
                  className={inputCls} />
              </div>
              <ChartUpload />
            </div>

            {/* Footer */}
            <div className="flex gap-[10px] pt-5 border-t border-[#1c1c1e] mt-5">
              <button onClick={submitTrade}
                className="flex-1 py-[11px] font-mono text-[12px] font-bold uppercase tracking-[0.18em] bg-[#4a7c59]/15 text-[#6fa580] border border-[#4a7c59]/50 rounded hover:bg-[#4a7c59]/25 transition-all duration-300">
                ✓ שמור עסקה
              </button>
              <button onClick={() => setAddOpen(false)}
                className="px-6 py-[11px] font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-white/45 border border-[#2a2a2d] rounded hover:text-white transition-all duration-300">
                ביטול
              </button>
            </div>
          </div>
        )}

        {/* ── Table ──────────────────────────────────────────────── */}
        <div className="flex-1">
          {trades.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <span className="font-serif text-xl font-bold text-white/50 tracking-[0.12em] uppercase">No Trades Recorded</span>
              <span className="text-base font-bold font-mono text-white/40 leading-relaxed max-w-md">
                Use + הוסף עסקה to log a setup. Session, bias &amp; time are auto-stamped.
              </span>
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-[#0d0d0f] border-b border-[#1c1c1e] z-10">
                <tr>
                  <th className="w-10"></th>
                  {[pick({he:'תאריך',en:'Date'},en),'שעה','נכס','כיוון','כניסה','סטופ','טארגט','R:R','תוצאה'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                  <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">סשן</th>
                  <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">ביאס</th>
                  <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-[#d4af37] whitespace-nowrap">סטאפ ✦</th>
                  <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-[#d4af37] whitespace-nowrap">IFVG ✦</th>
                  <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">הערות</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const rrRaw = Math.abs(t.entry - t.stop) > 0
                    ? ((t.target - t.entry) * (t.direction === 'LONG' ? 1 : -1)) / Math.abs(t.entry - t.stop)
                    : 0;
                  return (
                    <tr key={t.id} className="group border-b border-[#1c1c1e] hover:bg-[#0d0d0f] transition-colors duration-200">
                      <td className="w-10 px-2 py-2">
                        <button
                          onClick={() => handleDelete(t.id)}
                          title="העבר לסל מחזור"
                          className="w-8 h-8 rounded border border-[#7c3a3a]/30 bg-[#7c3a3a]/8 text-[#c98080]/40 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#7c3a3a]/25 hover:border-[#7c3a3a]/60 hover:text-[#c98080] transition-all duration-200 text-sm"
                        >
                          🗑
                        </button>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white/45 tabular-nums whitespace-nowrap">
                        {new Date(t.dateISO).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'2-digit' })}
                      </td>
                      <td className="px-3 py-2.5 text-white/50 tabular-nums whitespace-nowrap">{t.time}</td>
                      <td className="px-3 py-2.5 text-white font-bold">{t.symbol}</td>
                      <td className={`px-3 py-2.5 font-bold ${t.direction === 'LONG' ? 'text-[#6fa580]' : 'text-[#c98080]'}`}>
                        {t.direction}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-white font-bold">{t.entry.toFixed(2)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-[#c98080] font-bold">{t.stop.toFixed(2)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-[#6fa580] font-bold">{t.target.toFixed(2)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-[#d4af37] font-bold">
                        {rrRaw !== 0 ? rrRaw.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2.5"><ResultTag r={t.result} /></td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-[#d4af37] font-bold whitespace-nowrap">{t.session}</td>
                      <td className={`hidden md:table-cell px-3 py-2.5 font-bold ${biasCls(t.bias)}`}>{t.bias}</td>
                      <td className="hidden md:table-cell px-3 py-2.5"><SetupTag s={t.setup} /></td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-[#d4af37] font-bold whitespace-nowrap">
                        {t.confirmation ? t.confirmation.replace('IFVG_', 'IFVG ') : '—'}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-white/45 max-w-[150px] truncate">{t.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
