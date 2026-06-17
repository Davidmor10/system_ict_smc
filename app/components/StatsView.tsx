'use client';

import { useEffect, useMemo } from 'react';
import { useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import {
  loadTrades,
  statsByGroup,
  groupByKey,
  rDistribution,
  type TradeEntry,
  type GroupStats,
  type IFVGConfirmation,
} from '../lib/journal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Bi = { he: string; en: string };
const pick = (b: Bi, en: boolean) => (en ? b.en : b.he);

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    maximumFractionDigits: 0, signDisplay: 'always',
  }).format(Number.isFinite(n) ? n : 0);

const pct = (n: number) => `${Math.round(n)}%`;

function StatRow({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1c1c1e] last:border-0">
      <span className="font-mono text-[10px] text-white/45 uppercase tracking-[0.16em]">{label}</span>
      <span className={`font-mono text-[11px] font-bold tabular-nums ${green !== undefined ? (green ? 'text-[#6fa580]' : 'text-[#c98080]') : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

function ProgressBar({ pct: p, color = 'bg-[#d4af37]' }: { pct: number; color?: string }) {
  return (
    <div className="h-[3px] bg-[#1c1c1e] rounded-full overflow-hidden mt-3">
      <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, p)}%` }} />
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ num, title, subtitle }: { num: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between mb-[26px] pb-5 border-b border-[#1c1c1e]">
      <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">{num}</span>
      <div className="text-right" dir="rtl">
        <h2 className="font-serif text-[26px] font-bold text-white leading-none">{title}</h2>
        <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/45 mt-2">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Session labels ───────────────────────────────────────────────────────────

const SESSIONS = [
  { id: 'ASIA',   mono: '01 · ASIA',    bi: { he: 'אסיה',        en: 'Asia'       } },
  { id: 'LONDON', mono: '02 · LONDON',  bi: { he: 'לונדון',       en: 'London'     } },
  { id: 'NY_AM',  mono: '03 · NY AM',   bi: { he: 'ניו יורק AM', en: 'New York AM'} },
  { id: 'NY_PM',  mono: '04 · NY PM',   bi: { he: 'ניו יורק PM', en: 'New York PM'} },
] as const;

const DAYS = [
  { iso: 1, bi: { he: 'ב׳', en: 'Mon' } },
  { iso: 2, bi: { he: 'ג׳', en: 'Tue' } },
  { iso: 3, bi: { he: 'ד׳', en: 'Wed' } },
  { iso: 4, bi: { he: 'ה׳', en: 'Thu' } },
  { iso: 5, bi: { he: 'ו׳', en: 'Fri' } },
] as const;

const SETUP_META = {
  REVERSAL:     { bi: { he: 'ריברסל',   en: 'Reversal'     }, sub: 'Liquidity Sweep + Flip'  },
  CONTINUATION: { bi: { he: 'המשכיות',  en: 'Continuation' }, sub: '15M / 5M Gap Entry'      },
} as const;

const IFVG_META: Record<string, { bi: Bi; sub: string }> = {
  IFVG_1M: { bi: { he: 'IFVG · 1M', en: 'IFVG · 1M' }, sub: 'רגל מניפולציה 1 דקה'  },
  IFVG_2M: { bi: { he: 'IFVG · 2M', en: 'IFVG · 2M' }, sub: 'רגל מניפולציה 2 דקות' },
  IFVG_3M: { bi: { he: 'IFVG · 3M', en: 'IFVG · 3M' }, sub: 'רגל מניפולציה 3 דקות' },
  IFVG_5M: { bi: { he: 'IFVG · 5M', en: 'IFVG · 5M' }, sub: 'רגל מניפולציה 5 דקות' },
};

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-5 text-center">
      <span className="font-serif text-2xl font-bold text-white/40 tracking-[0.1em]">אין עסקאות עדיין</span>
      <span className="font-mono text-sm text-white/30 leading-relaxed max-w-sm">
        הוסף עסקאות ביומן המסחר — הנתונים יופיעו כאן אוטומטית.
      </span>
      <a href="/dashboard/journal"
        className="px-4 py-2 border border-[#d4af37]/40 text-[#d4af37] font-mono text-sm font-bold rounded">
        → יומן מסחר
      </a>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StatsView() {
  const { lang } = useLanguage();
  const en = lang === 'en';

  const [trades, setTrades] = useState<TradeEntry[]>([]);
  useEffect(() => { setTrades(loadTrades()); }, []);

  const overall = useMemo(() => statsByGroup(trades), [trades]);

  const bySession = useMemo(() =>
    groupByKey(trades, t => t.session), [trades]);

  const byDow = useMemo(() =>
    groupByKey(trades, t => String(new Date(t.dateISO + 'T12:00:00Z').getUTCDay())), [trades]);

  const bySetup = useMemo(() =>
    groupByKey(trades, t => t.setup ?? 'REVERSAL'), [trades]);

  const byIFVG = useMemo(() =>
    groupByKey(trades, t => t.confirmation ?? 'IFVG_2M'), [trades]);

  const byAlignment = useMemo(() =>
    groupByKey(trades, t => t.biasAlignment ?? 'COUNTER'), [trades]);

  const rDist = useMemo(() => rDistribution(trades), [trades]);

  const byHour = useMemo(() =>
    groupByKey(trades, t => t.time.slice(0, 2)), [trades]);

  // Find best session by winRate
  const bestSession = useMemo(() => {
    let best = '';
    let bestWr = -1;
    for (const s of SESSIONS) {
      const g = bySession.get(s.id);
      if (g && g.winRate > bestWr) { bestWr = g.winRate; best = s.id; }
    }
    return best;
  }, [bySession]);

  // Find best IFVG
  const bestIFVG = useMemo(() => {
    const keys: string[] = ['IFVG_1M','IFVG_2M','IFVG_3M','IFVG_5M'];
    let best = ''; let bestWr = -1;
    for (const k of keys) {
      const g = byIFVG.get(k as IFVGConfirmation);
      if (g && g.winRate > bestWr) { bestWr = g.winRate; best = k; }
    }
    return best;
  }, [byIFVG]);

  const netCls = (n: number) => n >= 0 ? 'text-[#6fa580]' : 'text-[#c98080]';
  const wrColor = (wr: number) => wr >= 60 ? 'bg-[#4a7c59]' : wr >= 45 ? 'bg-[#d4af37]' : 'bg-[#7c3a3a]';
  const wrTextColor = (wr: number) => wr >= 60 ? 'text-[#6fa580]' : wr >= 45 ? 'text-[#d4af37]' : 'text-[#c98080]';

  const maxRCount = Math.max(...rDist.map(b => b.count), 1);

  // Heatmap: IDT hours 16-22
  const HEATMAP_HOURS = [16, 17, 18, 19, 20, 21, 22];

  return (
    <div className="flex-1 min-h-0 bg-[#000000] text-white overflow-y-auto">

      {/* Sticky topbar */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-10 h-[58px] bg-[rgba(8,8,9,.86)] backdrop-blur-md border-b border-[#1c1c1e]">
        <div className="flex items-center gap-3" dir="rtl">
          <span className="px-3 py-1 rounded-sm border border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37] font-mono text-[11px] font-bold tracking-[0.2em] uppercase [box-shadow:0_0_20px_rgba(212,175,55,0.25)]">PRO</span>
          <span className="font-serif text-[18px] font-bold text-white">
            {pick({ he: 'יומן מסחר · ניתוח ביצועים', en: 'Trading Journal · Performance Analysis' }, en)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-sm border border-[#1c1c1e] bg-[#0d0d0f] font-mono text-[11px] text-white/60">
            {pick({ he: `סה״כ ${overall.tradeCount} עסקאות`, en: `${overall.tradeCount} Trades` }, en)}
          </span>
          <span className={`px-3 py-1 rounded-sm border border-[#1c1c1e] bg-[#0d0d0f] font-mono text-[11px] font-bold ${overall.winRate >= 50 ? 'text-[#6fa580]' : 'text-[#c98080]'}`}>
            {pick({ he: `Win Rate ${pct(overall.winRate)}`, en: `Win Rate ${pct(overall.winRate)}` }, en)}
          </span>
          <span className={`px-3 py-1 rounded-sm border border-[#1c1c1e] bg-[#0d0d0f] font-mono text-[11px] font-bold ${netCls(overall.totalPnl)}`}>
            {pick({ he: `נטו ${usd(overall.totalPnl)}`, en: `Net ${usd(overall.totalPnl)}` }, en)}
          </span>
        </div>
      </div>

      {trades.length === 0 ? <EmptyState /> : (
        <div className="px-10 pb-20">

          {/* ── 01 · Session + Day ─────────────────────────────── */}
          <div className="py-12 border-b border-[#1c1c1e]">
            <SectionHeader num="01"
              title={pick({ he: 'ביצועי מודל', en: 'Model Performance' }, en)}
              subtitle={pick({ he: 'לפי סשן ויום שבוע', en: 'By Session & Day of Week' }, en)} />

            {/* Session cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[16px] mb-8">
              {SESSIONS.map(s => {
                const g: GroupStats = bySession.get(s.id) ?? { winRate: 0, tradeCount: 0, totalPnl: 0, avgR: 0, wins: 0, losses: 0 };
                const isBest = s.id === bestSession && g.tradeCount > 0;
                return (
                  <div key={s.id}
                    className={`bg-[#0d0d0f] border rounded-[6px] p-[22px] flex flex-col gap-3 ${isBest ? 'border-[#d4af37]/40' : 'border-[#1c1c1e]'}`}>
                    <div>
                      <div className="font-mono text-[10px] font-bold text-white/40 tracking-[0.2em] uppercase">{s.mono}</div>
                      <div className="font-serif text-[17px] font-bold text-white mt-1">{pick(s.bi, en)}</div>
                    </div>
                    {isBest && (
                      <span className="self-start font-mono text-[9px] font-bold text-[#d4af37] border border-[#d4af37]/40 px-2 py-0.5 rounded">✦ BEST</span>
                    )}
                    <div className={`font-mono text-[48px] font-black tabular-nums leading-none ${isBest ? 'text-[#d4af37] [text-shadow:0_0_30px_rgba(212,175,55,0.4)]' : 'text-white'}`}>
                      {g.tradeCount > 0 ? pct(g.winRate) : '—'}
                    </div>
                    <ProgressBar pct={g.winRate} color={isBest ? 'bg-[#d4af37]' : 'bg-white/30'} />
                    <div className="flex flex-col gap-0.5 mt-1">
                      <StatRow label={pick({ he: 'עסקאות', en: 'Trades' }, en)} value={String(g.tradeCount)} />
                      <StatRow label={pick({ he: 'נטו $', en: 'Net $' }, en)} value={usd(g.totalPnl)} green={g.totalPnl >= 0} />
                      <StatRow label={pick({ he: 'ממוצע R', en: 'Avg R' }, en)} value={g.tradeCount > 0 ? g.avgR.toFixed(2) : '—'} green={g.avgR >= 0} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Day of week cards */}
            <div className="grid grid-cols-5 gap-[12px]">
              {DAYS.map(d => {
                const g: GroupStats = byDow.get(String(d.iso)) ?? { winRate: 0, tradeCount: 0, totalPnl: 0, avgR: 0, wins: 0, losses: 0 };
                return (
                  <div key={d.iso} className="bg-[#0d0d0f] border border-[#1c1c1e] rounded-[5px] p-[16px] text-center flex flex-col gap-2">
                    <div className="font-mono text-[11px] font-bold text-white/50 uppercase tracking-[0.2em]">{pick(d.bi, en)}</div>
                    <div className={`font-mono text-[28px] font-black tabular-nums ${g.tradeCount > 0 ? wrTextColor(g.winRate) : 'text-white/25'}`}>
                      {g.tradeCount > 0 ? pct(g.winRate) : '—'}
                    </div>
                    <ProgressBar pct={g.winRate} color={g.tradeCount > 0 ? wrColor(g.winRate) : 'bg-[#1c1c1e]'} />
                    <div className="font-mono text-[10px] text-white/40 mt-1">
                      {g.tradeCount} {pick({ he: 'עסקאות', en: 'trades' }, en)} · {usd(g.totalPnl)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 02 · Edge Analytics ────────────────────────────── */}
          <div className="py-12 border-b border-[#1c1c1e]">
            <SectionHeader num="02"
              title={pick({ he: 'ניתוח קצה', en: 'Edge Analytics' }, en)}
              subtitle="Setup · IFVG · Bias Alignment · R Distribution" />

            {/* Setup comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px] mb-8">
              {(['REVERSAL','CONTINUATION'] as const).map(key => {
                const meta = SETUP_META[key];
                const g: GroupStats = bySetup.get(key) ?? { winRate: 0, tradeCount: 0, totalPnl: 0, avgR: 0, wins: 0, losses: 0 };
                const avgWin = g.wins > 0 ? g.totalPnl / g.wins : 0;
                return (
                  <div key={key} className="bg-[#0d0d0f] border border-[#1c1c1e] rounded-[6px] overflow-hidden">
                    <div className="bg-black px-6 py-4 border-b border-[#1c1c1e] flex items-center justify-between">
                      <div>
                        <div className="font-serif text-[18px] font-bold text-white">{pick(meta.bi, en)}</div>
                        <div className="font-mono text-[10px] text-white/40 tracking-[0.14em] mt-0.5">{meta.sub}</div>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className={`font-mono text-[52px] font-black tabular-nums leading-none mb-1 ${g.tradeCount > 0 ? wrTextColor(g.winRate) : 'text-white/25'}`}>
                        {g.tradeCount > 0 ? pct(g.winRate) : '—'}
                      </div>
                      <div className="font-mono text-[11px] text-white/40 mb-4">
                        Win Rate · {g.tradeCount} {pick({ he: 'עסקאות', en: 'trades' }, en)}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: pick({ he: 'נטו $', en: 'Net $' }, en), val: usd(g.totalPnl), green: g.totalPnl >= 0 },
                          { label: pick({ he: 'ממוצע R', en: 'Avg R' }, en), val: g.tradeCount > 0 ? g.avgR.toFixed(2) : '—', green: g.avgR >= 0 },
                          { label: pick({ he: 'ממוצע W', en: 'Avg W' }, en), val: g.wins > 0 ? usd(avgWin) : '—', green: true },
                        ].map(m => (
                          <div key={m.label} className="bg-[#141416] border border-[#1c1c1e] rounded p-3 text-center">
                            <div className="font-mono text-[9px] text-white/40 uppercase tracking-[0.16em] mb-1">{m.label}</div>
                            <div className={`font-mono text-[13px] font-bold tabular-nums ${m.green !== undefined ? (m.green ? 'text-[#6fa580]' : 'text-[#c98080]') : 'text-white'}`}>{m.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* IFVG Confirmation */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-8">
              {(['IFVG_1M','IFVG_2M','IFVG_3M','IFVG_5M'] as IFVGConfirmation[]).map(key => {
                const meta = IFVG_META[key];
                const g: GroupStats = byIFVG.get(key) ?? { winRate: 0, tradeCount: 0, totalPnl: 0, avgR: 0, wins: 0, losses: 0 };
                const isBest = key === bestIFVG && g.tradeCount > 0;
                return (
                  <div key={key} className={`bg-[#0d0d0f] border rounded-[5px] p-[18px] flex flex-col gap-3 ${isBest ? 'border-[#d4af37]/35' : 'border-[#1c1c1e]'}`}>
                    <div>
                      <div className="font-mono text-[11px] font-bold text-[#d4af37] tracking-[0.16em]">{pick(meta.bi, en)}</div>
                      <div className="font-mono text-[10px] text-white/35 mt-0.5" dir="rtl">{meta.sub}</div>
                    </div>
                    <div className={`font-mono text-[38px] font-black tabular-nums leading-none ${g.tradeCount > 0 ? wrTextColor(g.winRate) : 'text-white/25'}`}>
                      {g.tradeCount > 0 ? pct(g.winRate) : '—'}
                    </div>
                    <ProgressBar pct={g.winRate} />
                    <div className="flex justify-between font-mono text-[10px] text-white/45 mt-1">
                      <span>{usd(g.totalPnl)}</span>
                      <span>{g.tradeCount > 0 ? `${g.avgR.toFixed(2)}R` : '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bias Alignment */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px] mb-8">
              {([
                { key: 'ALIGNED', border: 'border-[#4a7c59]/40', wrCls: 'text-[#6fa580]', bi: { he: 'עם הביאס', en: 'With Bias' } },
                { key: 'COUNTER', border: 'border-[#7c3a3a]/40', wrCls: 'text-[#c98080]', bi: { he: 'נגד הביאס', en: 'Against Bias' } },
              ]).map(({ key, border, wrCls, bi: lbl }) => {
                const g: GroupStats = byAlignment.get(key) ?? { winRate: 0, tradeCount: 0, totalPnl: 0, avgR: 0, wins: 0, losses: 0 };
                return (
                  <div key={key} className={`bg-[#0d0d0f] border ${border} rounded-[6px] p-6 flex items-center justify-between gap-6`}>
                    <div className="flex flex-col gap-2">
                      <div className="font-serif text-[18px] font-bold text-white">{pick(lbl, en)}</div>
                      <div className="flex flex-col gap-0.5">
                        <StatRow label={pick({ he: 'עסקאות', en: 'Trades' }, en)} value={String(g.tradeCount)} />
                        <StatRow label={pick({ he: 'נטו $', en: 'Net $' }, en)} value={usd(g.totalPnl)} green={g.totalPnl >= 0} />
                        <StatRow label={pick({ he: 'ממוצע R', en: 'Avg R' }, en)} value={g.tradeCount > 0 ? g.avgR.toFixed(2) : '—'} green={g.avgR >= 0} />
                      </div>
                    </div>
                    <div className={`font-mono text-[56px] font-black tabular-nums leading-none shrink-0 ${g.tradeCount > 0 ? wrCls : 'text-white/20'}`}>
                      {g.tradeCount > 0 ? pct(g.winRate) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* R Distribution */}
            <div className="bg-[#0d0d0f] border border-[#1c1c1e] rounded-[6px] p-[24px]">
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-white/50">
                  R Distribution
                </span>
                <div className="flex items-center gap-4 font-mono text-[10px] text-white/40">
                  <span><span className="text-[#6fa580]">■</span> {pick({ he: 'רווח', en: 'Win' }, en)}</span>
                  <span><span className="text-[#c98080]">■</span> {pick({ he: 'הפסד', en: 'Loss' }, en)}</span>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-[10px] items-end" style={{ height: 120 }}>
                {rDist.map(b => {
                  const h = maxRCount > 0 ? (b.count / maxRCount) * 100 : 0;
                  return (
                    <div key={b.bucket} className="flex flex-col items-center justify-end h-full relative gap-1">
                      {b.count > 0 && (
                        <span className="font-mono text-[10px] font-bold text-white/60 absolute"
                          style={{ top: `calc(${100 - h}% - 18px)` }}>
                          {b.count}
                        </span>
                      )}
                      <div
                        className={`w-full rounded-t transition-all duration-700 ${b.isWin ? 'bg-[#4a7c59]' : 'bg-[#7c3a3a]'} ${b.count === 0 ? 'opacity-20' : ''}`}
                        style={{ height: `${Math.max(h, b.count > 0 ? 4 : 0)}%` }}
                      />
                      <span className="font-mono text-[9px] text-white/35 text-center whitespace-nowrap">{b.bucket}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── 03 · Heatmap ───────────────────────────────────── */}
          <div className="py-12">
            <SectionHeader num="03"
              title={pick({ he: 'הטמפ ביצועים', en: 'Performance Heatmap' }, en)}
              subtitle={pick({ he: 'לפי שעה · IDT · 16:30–23:00', en: 'By Hour · IDT · 16:30–23:00' }, en)} />

            <div className="bg-[#0d0d0f] border border-[#1c1c1e] rounded-[6px] p-[24px]">
              <div className="flex gap-4 flex-wrap">
                {HEATMAP_HOURS.map(h => {
                  const key = String(h).padStart(2, '0');
                  const g: GroupStats | undefined = byHour.get(key);
                  const wr = g ? g.winRate : 0;
                  const isEmpty = !g || g.tradeCount === 0;

                  let bg = 'bg-[#0d0d0f]';
                  let textCls = 'text-white/20';
                  if (!isEmpty) {
                    if (wr >= 60)      { bg = `bg-[rgba(74,124,89,${(0.15 + wr / 100 * 0.55).toFixed(2)})]`; textCls = 'text-[#6fa580]'; }
                    else if (wr >= 45) { bg = `bg-[rgba(212,175,55,${(0.10 + wr / 100 * 0.40).toFixed(2)})]`; textCls = 'text-[#d4af37]'; }
                    else               { bg = `bg-[rgba(139,58,58,${(0.15 + (1 - wr / 100) * 0.45).toFixed(2)})]`; textCls = 'text-[#c98080]'; }
                  }

                  return (
                    <div key={h} className="flex flex-col items-center gap-1.5">
                      <div className={`w-[38px] h-[38px] rounded border border-[#1c1c1e] flex items-center justify-center ${bg}`}>
                        <span className={`font-mono text-[11px] font-bold tabular-nums ${textCls}`}>
                          {isEmpty ? '—' : pct(wr)}
                        </span>
                      </div>
                      <div className="text-center">
                        <div className="font-mono text-[10px] text-white/40">{key}:00</div>
                        <div className="font-mono text-[9px] text-white/25">{g?.tradeCount ?? 0}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
