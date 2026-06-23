'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { useMarketStatus } from '../hooks/useMarketStatus';

// ─────────────────────────────────────────────────────────────────────────────
//  Daily Bias — deterministic framework (H4/H1 trend + FVG respect/violation).
//  BULLISH : H4 UP  AND H1 UP  AND respects Bullish FVG AND violates Bearish FVG
//  BEARISH : H4 DOWN AND H1 DOWN AND respects Bearish FVG AND violates Bullish FVG
//  NEUTRAL : consolidation / any mismatch
// ─────────────────────────────────────────────────────────────────────────────

type Trend = 'UP' | 'DOWN' | 'SIDEWAYS';
type FVG   = 'RESPECTED' | 'VIOLATED';
type Bias  = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

interface AssetState {
  symbol: string;
  short: string;
  h4: Trend;
  h1: Trend;
  bullishFVG: FVG;
  bearishFVG: FVG;
}

const INITIAL_ASSETS: AssetState[] = [
  { symbol: 'ES1! · S&P 500', short: 'ES', h4: 'UP', h1: 'UP',       bullishFVG: 'RESPECTED', bearishFVG: 'VIOLATED'  },
  { symbol: 'NQ1! · Nasdaq',  short: 'NQ', h4: 'UP', h1: 'SIDEWAYS', bullishFVG: 'RESPECTED', bearishFVG: 'RESPECTED' },
];

function computeBias(s: AssetState): Bias {
  const bullish = s.h4 === 'UP'   && s.h1 === 'UP'   && s.bullishFVG === 'RESPECTED' && s.bearishFVG === 'VIOLATED';
  const bearish = s.h4 === 'DOWN' && s.h1 === 'DOWN' && s.bearishFVG === 'RESPECTED' && s.bullishFVG === 'VIOLATED';
  return bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'NEUTRAL';
}

// ─── localStorage persistence ────────────────────────────────────────────────
const STORAGE_KEY = 'onyx_analysis_inputs';
const isTrend = (v: unknown): v is Trend => v === 'UP' || v === 'DOWN' || v === 'SIDEWAYS';
const isFVG   = (v: unknown): v is FVG   => v === 'RESPECTED' || v === 'VIOLATED';

function loadAssets(): AssetState[] {
  if (typeof window === 'undefined') return INITIAL_ASSETS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_ASSETS;
    const saved = JSON.parse(raw) as Record<string, Partial<AssetState>>;
    return INITIAL_ASSETS.map(a => {
      const s = saved[a.short] ?? {};
      return {
        ...a,
        h4:         isTrend(s.h4)       ? s.h4         : a.h4,
        h1:         isTrend(s.h1)       ? s.h1         : a.h1,
        bullishFVG: isFVG(s.bullishFVG) ? s.bullishFVG : a.bullishFVG,
        bearishFVG: isFVG(s.bearishFVG) ? s.bearishFVG : a.bearishFVG,
      };
    });
  } catch { return INITIAL_ASSETS; }
}

function saveAssets(assets: AssetState[]) {
  if (typeof window === 'undefined') return;
  const payload: Record<string, Pick<AssetState, 'h4' | 'h1' | 'bullishFVG' | 'bearishFVG'>> = {};
  assets.forEach(a => { payload[a.short] = { h4: a.h4, h1: a.h1, bullishFVG: a.bullishFVG, bearishFVG: a.bearishFVG }; });
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* storage unavailable */ }
}

// ─── Bilingual labels ────────────────────────────────────────────────────────
type Bi = { he: string; en: string };
const pick = (b: Bi, en: boolean) => (en ? b.en : b.he);

const TREND_LABEL: Record<Trend, Bi> = {
  UP:       { he: 'עולה',  en: 'Bullish'  },
  DOWN:     { he: 'יורד',  en: 'Bearish'  },
  SIDEWAYS: { he: 'דשדוש', en: 'Sideways' },
};
const TREND_ICON: Record<Trend, string> = { UP: '▲', DOWN: '▼', SIDEWAYS: '◈' };

const FVG_LABEL: Record<FVG, Bi> = {
  RESPECTED: { he: 'מכובד', en: 'Respected' },
  VIOLATED:  { he: 'נשבר',  en: 'Violated'  },
};
const BIAS_WORD: Record<Bias, Bi> = {
  BULLISH: { he: 'שורי',   en: 'BULLISH' },
  BEARISH: { he: 'דובי',   en: 'BEARISH' },
  NEUTRAL: { he: 'ניטרלי', en: 'NEUTRAL' },
};
const BIAS_CLS: Record<Bias, { text: string; border: string; glow: string; bar: string }> = {
  BULLISH: { text: 'text-bullish',   border: 'border-bullish/40',   glow: '[text-shadow:0_0_42px_rgba(74,124,89,0.55)]',  bar: 'bg-bullish'   },
  BEARISH: { text: 'text-bearish',   border: 'border-bearish/40',   glow: '[text-shadow:0_0_42px_rgba(139,58,58,0.55)]',  bar: 'bg-bearish'   },
  NEUTRAL: { text: 'text-[#d4af37]', border: 'border-[#d4af37]/32', glow: '[text-shadow:0_0_42px_rgba(212,175,55,0.55)]', bar: 'bg-[#d4af37]' },
};

const STR = {
  headerTitle:     { he: 'ניתוח שוק · דיילי ביאס',      en: 'Market Analytics · Daily Bias'  },
  noSession:       { he: 'אין סשן פעיל',                 en: 'No active session'              },
  activePfx:       { he: 'סשן פעיל: ',                   en: 'Active Session: '               },
  override:        { he: 'עקוף שעון סשנים',              en: 'Override session clock'         },
  marketClosed:    { he: 'שוק סגור · נפתח ביום שני',     en: 'Market closed · Opens Monday'   },
  locked:          { he: 'אין סשן מסחר פעיל כרגע — הביאס יתעדכן עם תחילת הסשן הבא.', en: 'No active trading session right now — the bias will update at the start of the next session.' },
  sec01title:      { he: 'סשן מסחר',                     en: 'Trading Session'                },
  sec01sub:        { he: 'ציר זמן · IDT · 24 שעות',      en: 'Timeline · IDT · 24 Hours'     },
  sec02title:      { he: 'קונסולת ניתוח',                en: 'Analysis Console'              },
  sec02sub:        { he: 'H4 · H1 · FVG · דיילי ביאס',  en: 'H4 · H1 · FVG · Daily Bias'   },
  sec03title:      { he: 'הנחיית מערכת',                 en: 'System Guidance'               },
  sec03sub:        { he: 'המלצת האלגוריתם להיום',         en: "Algorithm's recommendation"    },
  colInput:        { he: 'קלט גרף',                      en: 'Chart Input'                   },
  colConfluence:   { he: 'קונפלואנס',                    en: 'Confluence'                    },
  colBias:         { he: 'פסיקת ביאס',                   en: 'Bias Verdict'                  },
  marketStructure: { he: 'מבנה שוק',                     en: 'Market Structure'              },
  fvgGroup:        { he: 'Fair Value Gaps',               en: 'Fair Value Gaps'               },
  h4Trend:         { he: 'מגמת H4',                      en: 'H4 Trend'                      },
  h1Trend:         { he: 'מגמת H1',                      en: 'H1 Trend'                      },
  bullFVG:         { he: 'גאפ שורי',                     en: 'Bullish FVG'                   },
  bearFVG:         { he: 'גאפ דובי',                     en: 'Bearish FVG'                   },
  condMet:         { he: 'מתוך 4 תנאים התקיימו',         en: 'of 4 conditions met'           },
  neutral: {
    he: 'הביאס ניטרלי. נחכה לפתיחת השוק ואז נראה אם אפשר להשיג יותר מידע לגבי הכיוון היום בעזרת עוד אינפורמציה מהגרף. אם עדיין לא הצלחנו למצוא מידע שתורם ועוזר, לא נקח עסקה להיום.',
    en: "Bias is neutral. We'll wait for the market open and then see whether the chart offers more information about today's direction. If we still can't find anything that genuinely helps, we won't take a trade today.",
  },
  footnote: {
    he: 'הדיילי ביאס הוא רק עוד נקודת מבט של המערכת וכדאי ומומלץ להפעיל שיקול דעת משלך ומעצמך.',
    en: "The Daily Bias is only one of the system's perspectives — you should always apply your own independent judgment.",
  },
} as const;

// ─── Sessions ────────────────────────────────────────────────────────────────
interface Session { id: string; he: string; en: string; start: number; end: number }
const SESSIONS: Session[] = [
  { id: 'ASIA',   he: 'אסיה',       en: 'Asia',        start: 2 * 60,       end: 7 * 60       },
  { id: 'LONDON', he: 'לונדון',      en: 'London',      start: 9 * 60,       end: 12 * 60      },
  { id: 'NY_AM',  he: 'ניו יורק AM', en: 'New York AM', start: 16 * 60,      end: 18 * 60 + 30 },
  { id: 'NY_PM',  he: 'ניו יורק PM', en: 'New York PM', start: 20 * 60 + 30, end: 23 * 60      },
];

function israelMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  let h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  if (h === 24) h = 0;
  return h * 60 + m;
}
function activeSession(min: number): Session | null {
  return SESSIONS.find(s => min >= s.start && min < s.end) ?? null;
}
function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ num, title, subtitle, dir }: { num: string; title: string; subtitle: string; dir?: 'rtl' | 'ltr' }) {
  return (
    <div className="flex items-end justify-between mb-[26px] pb-5 border-b border-[#1c1c1e]">
      <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">{num}</span>
      <div className={dir === 'ltr' ? 'text-left' : 'text-right'} dir={dir ?? 'rtl'}>
        <h2 className="font-serif text-[26px] font-bold text-white leading-none">{title}</h2>
        <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/45 mt-2">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Section 01 · Session Timeline ───────────────────────────────────────────
function SessionTimeline({ nowMin, session, override, onToggleOverride, en }: {
  nowMin: number; session: Session | null; override: boolean;
  onToggleOverride: () => void; en: boolean;
}) {
  const nowPct = (nowMin / 1440) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 max-[880px]:flex-col max-[880px]:items-stretch">
        {/* Track */}
        <div className="relative flex-1 bg-[#0d0d0f] border border-[#1c1c1e] rounded-[5px]" style={{ height: 88 }}>
          {SESSIONS.map(s => {
            const isActive = !override ? session?.id === s.id : true;
            const left  = (s.start / 1440) * 100;
            const width = ((s.end - s.start) / 1440) * 100;
            return (
              <div
                key={s.id}
                className={`absolute top-[10px] bottom-[10px] rounded-[3px] flex flex-col items-center justify-center transition-all duration-500 ${
                  isActive
                    ? 'bg-[#d4af37]/12 border border-[#d4af37]/60 [box-shadow:0_0_18px_-4px_rgba(212,175,55,0.45)]'
                    : 'bg-[#1a1a1d] border border-[#2a2a2d]'
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                <span className={`font-mono text-[10px] font-bold ${isActive ? 'text-[#d4af37]' : 'text-white/35'}`}>
                  {en ? s.en : s.he}
                </span>
                <span className={`font-mono text-[9px] mt-0.5 ${isActive ? 'text-[#d4af37]/60' : 'text-white/20'}`}>
                  {fmtMin(s.start)}–{fmtMin(s.end)}
                </span>
              </div>
            );
          })}
          {/* Now line */}
          <div
            className="absolute top-0 bottom-0 w-px bg-[#d4af37] [box-shadow:0_0_6px_rgba(212,175,55,0.7)]"
            style={{ left: `${nowPct}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold text-[#d4af37] whitespace-nowrap">
              {fmtMin(nowMin)}
            </span>
          </div>
        </div>

        {/* Override button */}
        <button
          onClick={onToggleOverride}
          dir="rtl"
          className={`shrink-0 max-[880px]:w-full flex items-center gap-2 px-3 py-2 rounded-[5px] border font-mono text-[11px] font-bold transition-colors duration-300 ${
            override ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] text-white/50 hover:text-white'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${override ? 'bg-[#d4af37]' : 'bg-white/25'}`} />
          {pick(STR.override, en)}
        </button>
      </div>

      {/* Hour labels */}
      <div className="flex justify-between">
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map(t => (
          <span key={t} className="font-mono text-[10px] text-white/25">{t}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Section 02 · Asset Console ──────────────────────────────────────────────

function trendBtnCls(v: Trend, sel: Trend): string {
  if (v !== sel) return 'bg-[#101013] border-[#2a2a2d] text-white/50';
  if (v === 'UP')       return 'bg-bullish/18 border-bullish/60 text-[#6fa580]';
  if (v === 'DOWN')     return 'bg-bearish/18 border-bearish/60 text-[#c98080]';
  return 'bg-[#d4af37]/15 border-[#d4af37]/50 text-[#d4af37]';
}
function fvgBtnCls(v: FVG, sel: FVG): string {
  if (v !== sel) return 'bg-[#101013] border-[#2a2a2d] text-white/50';
  return v === 'RESPECTED'
    ? 'bg-bullish/18 border-bullish/60 text-[#6fa580]'
    : 'bg-bearish/18 border-bearish/60 text-[#c98080]';
}

function AssetConsole({ a, i, onChange, en }: {
  a: AssetState; i: number; onChange: (i: number, p: Partial<AssetState>) => void; en: boolean;
}) {
  const bias  = computeBias(a);
  const c     = BIAS_CLS[bias];

  const bullPath = [
    { ok: a.h4 === 'UP',                label: { he: 'מגמת H4 עולה',   en: 'H4 Bullish'           }, val: pick(TREND_LABEL[a.h4], en)       },
    { ok: a.h1 === 'UP',                label: { he: 'מגמת H1 עולה',   en: 'H1 Bullish'           }, val: pick(TREND_LABEL[a.h1], en)       },
    { ok: a.bullishFVG === 'RESPECTED', label: { he: 'גאפ שורי מכובד', en: 'Bullish FVG Respected'}, val: pick(FVG_LABEL[a.bullishFVG], en) },
    { ok: a.bearishFVG === 'VIOLATED',  label: { he: 'גאפ דובי נשבר',  en: 'Bearish FVG Violated' }, val: pick(FVG_LABEL[a.bearishFVG], en) },
  ];
  const bearPath = [
    { ok: a.h4 === 'DOWN',              label: { he: 'מגמת H4 יורד',   en: 'H4 Bearish'           }, val: pick(TREND_LABEL[a.h4], en)       },
    { ok: a.h1 === 'DOWN',              label: { he: 'מגמת H1 יורד',   en: 'H1 Bearish'           }, val: pick(TREND_LABEL[a.h1], en)       },
    { ok: a.bearishFVG === 'RESPECTED', label: { he: 'גאפ דובי מכובד', en: 'Bearish FVG Respected'}, val: pick(FVG_LABEL[a.bearishFVG], en) },
    { ok: a.bullishFVG === 'VIOLATED',  label: { he: 'גאפ שורי נשבר',  en: 'Bullish FVG Violated' }, val: pick(FVG_LABEL[a.bullishFVG], en) },
  ];
  const path  = (bias === 'BEARISH' || (bias === 'NEUTRAL' && a.h4 === 'DOWN')) ? bearPath : bullPath;
  const count = path.filter(p => p.ok).length;

  const tagCls    = bias === 'BULLISH' ? 'text-bullish' : bias === 'BEARISH' ? 'text-bearish' : 'text-[#d4af37]';

  return (
    <div className={`bg-[#0d0d0f] border ${c.border} rounded-[6px] overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between bg-black border-b border-[#1c1c1e]" style={{ padding: '16px 22px' }}>
        <span className="font-mono text-[16px] font-bold text-white">{a.symbol}</span>
        <span className={`font-mono text-[11px] font-bold ${tagCls}`}>● {count}/4 Confluence</span>
      </div>

      {/* 3-column body */}
      <div className="grid max-[880px]:grid-cols-1" style={{ gridTemplateColumns: '1.2fr 1fr 1fr' }}>

        {/* Col 1 — Chart Input */}
        <div className="p-6 flex flex-col gap-5" dir="rtl">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#d4af37]">
            {pick(STR.colInput, en)}
          </span>

          {/* Market Structure group */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 border-b border-[#1c1c1e] pb-1.5">
              {pick(STR.marketStructure, en)}
            </span>
            {([['h4Trend', 'h4'], ['h1Trend', 'h1']] as const).map(([lk, field]) => (
              <div key={field} className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-white/55 shrink-0">{pick(STR[lk], en)}</span>
                <div className="flex gap-1">
                  {(['UP', 'DOWN', 'SIDEWAYS'] as Trend[]).map(v => (
                    <button key={v} onClick={() => onChange(i, { [field]: v })}
                      className={`px-3 py-[7px] rounded-sm border font-mono text-[11px] font-bold transition-colors duration-200 ${trendBtnCls(v, a[field])}`}>
                      {TREND_ICON[v]} {pick(TREND_LABEL[v], en)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* FVG group */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 border-b border-[#1c1c1e] pb-1.5">
              {pick(STR.fvgGroup, en)}
            </span>
            {([['bullFVG', 'bullishFVG'], ['bearFVG', 'bearishFVG']] as const).map(([lk, field]) => (
              <div key={field} className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-white/55 shrink-0">{pick(STR[lk], en)}</span>
                <div className="flex gap-1">
                  {(['RESPECTED', 'VIOLATED'] as FVG[]).map(v => (
                    <button key={v} onClick={() => onChange(i, { [field]: v })}
                      className={`px-3 py-[7px] rounded-sm border font-mono text-[11px] font-bold transition-colors duration-200 ${fvgBtnCls(v, a[field])}`}>
                      {pick(FVG_LABEL[v], en)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Col 2 — Confluence Checklist */}
        <div className="border-l max-[880px]:border-l-0 max-[880px]:border-t border-[#1c1c1e] p-6 flex flex-col" dir="rtl">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#d4af37] mb-4">
            {pick(STR.colConfluence, en)}
          </span>
          <div className="flex flex-col flex-1">
            {path.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-3 py-3 border-b border-[#1c1c1e] last:border-0">
                <div className={`shrink-0 flex items-center justify-center rounded-sm border font-mono text-[12px] font-bold ${
                  cond.ok
                    ? 'bg-bullish/16 border-bullish/50 text-[#6fa580]'
                    : 'bg-bearish/16 border-bearish/50 text-[#c98080]'
                }`} style={{ width: 24, height: 24 }}>
                  {cond.ok ? '✓' : '✕'}
                </div>
                <span className="flex-1 font-mono text-[11px] text-white/78 leading-snug">
                  {pick(cond.label, en)}
                </span>
                <span className={`font-mono text-[10px] font-bold shrink-0 ${cond.ok ? 'text-[#6fa580]' : 'text-[#c98080]'}`}>
                  {cond.val}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Col 3 — Bias Verdict */}
        <div className="border-l max-[880px]:border-l-0 max-[880px]:border-t border-[#1c1c1e] p-6 flex flex-col items-center justify-center gap-5" dir="rtl">
          <div className="text-center">
            <div className={`font-serif font-black ${c.text} ${c.glow}`}
              style={{ fontSize: 'clamp(28px,2.4vw,46px)', whiteSpace: 'nowrap' }}>
              [{bias}]
            </div>
            <div className={`font-mono text-[13px] font-bold tracking-[0.22em] mt-2 ${c.text}`}>
              {pick(BIAS_WORD[bias], en)}
            </div>
          </div>
          {/* Confluence meter */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map(idx => (
                <div key={idx} className={`rounded ${idx < count ? c.bar : 'bg-[#2a2a2d]'}`}
                  style={{ width: 34, height: 6 }} />
              ))}
            </div>
            <span className="font-mono text-[10px] text-white/40 text-center">
              {count} {pick(STR.condMet, en)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsView() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const { isMarketOpen } = useMarketStatus();

  const [assets, setAssets] = useState<AssetState[]>(loadAssets);
  const [override, setOverride] = useState(false);
  const [nowMin, setNowMin] = useState<number>(() => israelMinutes());

  useEffect(() => {
    saveAssets(assets);
    const payload: Record<string, Pick<AssetState, 'h4' | 'h1' | 'bullishFVG' | 'bearishFVG'>> = {};
    assets.forEach(a => { payload[a.short] = { h4: a.h4, h1: a.h1, bullishFVG: a.bullishFVG, bearishFVG: a.bearishFVG }; });
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis_state: payload }),
    }).catch(() => {});
  }, [assets]);
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then((data: { prefs: { analysis_state?: Record<string, unknown> } | null } | null) => {
        const saved = data?.prefs?.analysis_state;
        if (!saved || typeof saved !== 'object') return;
        setAssets(prev => prev.map(a => {
          const s = (saved as Record<string, Partial<AssetState>>)[a.short] ?? {};
          return {
            ...a,
            h4:         isTrend(s.h4)       ? s.h4         : a.h4,
            h1:         isTrend(s.h1)       ? s.h1         : a.h1,
            bullishFVG: isFVG(s.bullishFVG) ? s.bullishFVG : a.bullishFVG,
            bearishFVG: isFVG(s.bearishFVG) ? s.bearishFVG : a.bearishFVG,
          };
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowMin(israelMinutes()), 20_000);
    return () => clearInterval(id);
  }, []);

  const session = activeSession(nowMin);
  const visible = override || (isMarketOpen && session !== null);
  const sessionLabel = !isMarketOpen
    ? pick(STR.marketClosed, en)
    : session
      ? pick(STR.activePfx, en) + pick(session, en)
      : pick(STR.noSession, en);

  const updateAsset = (i: number, patch: Partial<AssetState>) =>
    setAssets(prev => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const hasNeutral = assets.some(a => computeBias(a) === 'NEUTRAL');

  return (
    <div className="flex-1 min-h-0 bg-[#000000] text-white overflow-y-auto">

      {/* Sticky status bar */}
      <div className="sticky top-0 max-[880px]:top-[54px] z-50 flex items-center justify-between px-10 max-[880px]:px-4 h-[58px] max-[880px]:h-[45px] bg-[rgba(8,8,9,.86)] backdrop-blur-md border-b border-[#1c1c1e]">
        <div className="flex items-center gap-3" dir="rtl">
          <span className="px-3 py-1 rounded-sm border border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37] font-mono text-[11px] font-bold tracking-[0.2em] uppercase [box-shadow:0_0_20px_rgba(212,175,55,0.25)] max-[880px]:hidden">PRO</span>
          <span className="font-serif text-[18px] font-bold text-white">{pick(STR.headerTitle, en)}</span>
        </div>
        <div className="flex items-center gap-2 max-[880px]:hidden">
          <span className={`h-2 w-2 rounded-full shrink-0 ${visible ? 'bg-[#d4af37] animate-pulse' : 'bg-white/40'}`} />
          <span className={`font-mono text-xs font-bold tracking-[0.14em] ${visible ? 'text-[#d4af37]' : 'text-white/50'}`}>
            {sessionLabel}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-10 max-[880px]:px-4 pb-20">

        {/* 01 · Session Timeline */}
        <div className="py-11 border-b border-[#1c1c1e]">
          <SectionHeader num="01" title={pick(STR.sec01title, en)} subtitle={pick(STR.sec01sub, en)} dir={en ? 'ltr' : 'rtl'} />
          <SessionTimeline nowMin={nowMin} session={session} override={override}
            onToggleOverride={() => setOverride(o => !o)} en={en} />
        </div>

        {/* 02 · Analysis Console */}
        <div className="py-11 border-b border-[#1c1c1e]">
          <SectionHeader num="02" title={pick(STR.sec02title, en)} subtitle={pick(STR.sec02sub, en)} dir={en ? 'ltr' : 'rtl'} />
          {visible ? (
            <div className="flex flex-col gap-[18px]">
              {assets.map((a, i) => (
                <AssetConsole key={a.short} a={a} i={i} onChange={updateAsset} en={en} />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-16">
              <div className="max-w-xl text-center rounded-xl border border-[#1c1c1e] bg-[#0d0d0f] p-10" dir={en ? 'ltr' : 'rtl'}>
                <span className="text-[#d4af37] text-4xl">◈</span>
                <p className="mt-5 text-xl font-bold text-white leading-relaxed tracking-wide">
                  {pick(STR.locked, en)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 03 · System Guidance */}
        <div className="py-11">
          <SectionHeader num="03" title={pick(STR.sec03title, en)} subtitle={pick(STR.sec03sub, en)} dir={en ? 'ltr' : 'rtl'} />
          {hasNeutral && (
            <div className="bg-[#0d0d0f] border border-[#d4af37]/30 rounded-[6px] p-[26px] mb-6 [box-shadow:0_0_50px_-18px_rgba(212,175,55,0.4)]"
              dir={en ? 'ltr' : 'rtl'}>
              <div className="flex items-start gap-3">
                <span className="text-[#d4af37] text-2xl shrink-0">◈</span>
                <p className="font-mono text-sm text-white/80 leading-relaxed">{pick(STR.neutral, en)}</p>
              </div>
            </div>
          )}
          <p className="font-mono text-[11px] text-[#52525b] leading-relaxed" dir="rtl">
            {pick(STR.footnote, en)}
          </p>
        </div>

      </div>
    </div>
  );
}
