'use client';

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
//  Daily Bias — deterministic framework (H4/H1 trend + H4/H1 FVG respect).
//  The trader inputs current market structure via the analysis panel; the bias
//  recomputes in real-time and the inputs persist to localStorage per session.
//
//  BULLISH  : H4 UP  AND H1 UP  AND respects Bullish FVG AND violates Bearish FVG
//  BEARISH  : H4 DOWN AND H1 DOWN AND respects Bearish FVG AND violates Bullish FVG
//  NEUTRAL  : consolidation on H4/H1, or any mismatch / uncertainty
//
//  Bias is shown ONLY inside the active Israel-time (IDT) session windows.
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

// ─── localStorage persistence ───────────────────────────────────────────────
const STORAGE_KEY = 'onyx_analysis_inputs';

const isTrend = (v: unknown): v is Trend => v === 'UP' || v === 'DOWN' || v === 'SIDEWAYS';
const isFVG   = (v: unknown): v is FVG => v === 'RESPECTED' || v === 'VIOLATED';

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
        h4:         isTrend(s.h4) ? s.h4 : a.h4,
        h1:         isTrend(s.h1) ? s.h1 : a.h1,
        bullishFVG: isFVG(s.bullishFVG) ? s.bullishFVG : a.bullishFVG,
        bearishFVG: isFVG(s.bearishFVG) ? s.bearishFVG : a.bearishFVG,
      };
    });
  } catch {
    return INITIAL_ASSETS;
  }
}

function saveAssets(assets: AssetState[]) {
  if (typeof window === 'undefined') return;
  const payload: Record<string, Pick<AssetState, 'h4' | 'h1' | 'bullishFVG' | 'bearishFVG'>> = {};
  assets.forEach(a => { payload[a.short] = { h4: a.h4, h1: a.h1, bullishFVG: a.bullishFVG, bearishFVG: a.bearishFVG }; });
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* storage unavailable */ }
}

// ─── Copy ────────────────────────────────────────────────────────────────────
const NEUTRAL_DIRECTIVE =
  'הביאס ניטרלי. נחכה לפתיחת השוק ואז נראה אם אפשר להשיג יותר מידע לגבי הכיוון היום בעזרת עוד אינפורמציה מהגרף. אם עדיין לא הצלחנו למצוא מידע שתורם ועוזר, לא נקח עסקה להיום.';

const FOOTNOTE =
  'הדיילי ביאס הוא רק עוד נקודת מבט של המערכת וכדאי ומומלץ להפעיל שיקול דעת משלך ומעצמך.';

const LOCKED =
  'אין סשן מסחר פעיל כרגע - הביאס יתעדכן עם תחילת הסשן הבא.';

const TREND_HE: Record<Trend, { label: string; icon: string; hint: string; cls: string }> = {
  UP:       { label: 'עולה',  icon: '▲', hint: 'שיאים ושפלים עולים',     cls: 'text-bullish' },
  DOWN:     { label: 'יורד',  icon: '▼', hint: 'שיאים ושפלים יורדים',    cls: 'text-bearish' },
  SIDEWAYS: { label: 'דשדוש', icon: '◈', hint: 'קונסולידציה / ללא כיוון', cls: 'text-[#d4af37]' },
};

const FVG_HE: Record<FVG, { label: string; cls: string }> = {
  RESPECTED: { label: 'מכובדים', cls: 'text-bullish' },
  VIOLATED:  { label: 'נשברים',  cls: 'text-bearish' },
};

const BIAS_HE: Record<Bias, string> = { BULLISH: 'שורי', BEARISH: 'דובי', NEUTRAL: 'ניטרלי' };

const BIAS_CLS: Record<Bias, { text: string; border: string; bg: string; glow: string }> = {
  BULLISH: { text: 'text-bullish',   border: 'border-bullish/40',   bg: 'bg-bullish/8',   glow: '[text-shadow:0_0_42px_rgba(74,124,89,0.55)]'  },
  BEARISH: { text: 'text-bearish',   border: 'border-bearish/40',   bg: 'bg-bearish/8',   glow: '[text-shadow:0_0_42px_rgba(139,58,58,0.55)]'  },
  NEUTRAL: { text: 'text-[#d4af37]', border: 'border-[#d4af37]/40', bg: 'bg-[#d4af37]/8', glow: '[text-shadow:0_0_42px_rgba(212,175,55,0.55)]' },
};

const TREND_OPTS: { v: Trend; label: string }[] = [
  { v: 'UP', label: 'עולה' },
  { v: 'DOWN', label: 'יורד' },
  { v: 'SIDEWAYS', label: 'דשדוש' },
];
const FVG_OPTS: { v: FVG; label: string }[] = [
  { v: 'RESPECTED', label: 'מכובדים' },
  { v: 'VIOLATED', label: 'נשברים' },
];

// ─── Israel-time (IDT) session windows ──────────────────────────────────────
interface Session { id: string; label: string; start: number; end: number }
const SESSIONS: Session[] = [
  { id: 'ASIA',   label: 'סשן פעיל: אסיה',        start: 2 * 60,        end: 7 * 60  },
  { id: 'LONDON', label: 'סשן פעיל: לונדון',       start: 9 * 60,        end: 12 * 60 },
  { id: 'NY_AM',  label: 'סשן פעיל: ניו יורק AM',  start: 16 * 60,       end: 18 * 60 + 30 },
  { id: 'NY_PM',  label: 'סשן פעיל: ניו יורק PM',  start: 20 * 60 + 30,  end: 23 * 60 },
];

function israelMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  let h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  if (h === 24) h = 0; // some runtimes emit 24 at midnight
  return h * 60 + m;
}

function activeSession(min: number): Session | null {
  return SESSIONS.find(s => min >= s.start && min < s.end) ?? null;
}

// ─── Metric row + bias card ─────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#1c1c1e] last:border-0">
      <span className="text-base font-bold font-mono text-white/70 uppercase tracking-wider">{label}</span>
      <div className="flex flex-col items-start">{children}</div>
    </div>
  );
}

function BiasCard({ state }: { state: AssetState }) {
  const bias = computeBias(state);
  const c = BIAS_CLS[bias];
  const h4 = TREND_HE[state.h4];
  const h1 = TREND_HE[state.h1];
  const bull = FVG_HE[state.bullishFVG];
  const bear = FVG_HE[state.bearishFVG];

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-8 flex flex-col items-center text-center`} dir="rtl">
      <span className="text-sm font-bold font-mono text-white/70 uppercase tracking-[0.25em]">{state.symbol}</span>

      <div className="mt-6 mb-2">
        <span className={`font-serif font-black leading-none ${c.text} ${c.glow}`} style={{ fontSize: 'clamp(2.6rem,7vw,4.5rem)' }}>
          [{bias}]
        </span>
      </div>
      <span className={`text-lg font-bold font-mono ${c.text} tracking-[0.2em]`}>{BIAS_HE[bias]}</span>

      <div className="w-full mt-8 flex flex-col gap-7">
        <div>
          <span className="block text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em] mb-2 border-b border-[#1c1c1e] pb-2">מגמת שוק</span>
          {([['H4', h4], ['H1', h1]] as const).map(([tf, tr]) => (
            <Row key={tf} label={tf}>
              <span className={`text-lg font-bold font-mono ${tr.cls}`}>{tr.label} {tr.icon}</span>
              <span className="text-xs font-bold font-mono text-white/40 mt-0.5">{tr.hint}</span>
            </Row>
          ))}
        </div>

        <div>
          <span className="block text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em] mb-2 border-b border-[#1c1c1e] pb-2">סטטוס גאפים</span>
          <Row label="גאפים שוריים"><span className={`text-lg font-bold font-mono ${bull.cls}`}>{bull.label}</span></Row>
          <Row label="גאפים דוביים"><span className={`text-lg font-bold font-mono ${bear.cls}`}>{bear.label}</span></Row>
        </div>
      </div>

      {bias === 'NEUTRAL' && (
        <div className="w-full mt-7 rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/5 p-5 [box-shadow:0_0_40px_-12px_rgba(212,175,55,0.4)]">
          <p className="text-base font-bold text-[#c0c0c0] leading-relaxed tracking-wide">{NEUTRAL_DIRECTIVE}</p>
        </div>
      )}
    </div>
  );
}

// ─── Segmented input control ────────────────────────────────────────────────
function Field<T extends string>({ label, options, value, onSelect }: {
  label: string; options: { v: T; label: string }[]; value: T; onSelect: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-bold font-mono text-white/70 shrink-0">{label}</span>
      <div className="flex gap-1">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onSelect(o.v)}
            className={`px-3 py-1.5 rounded-sm text-sm font-bold font-mono transition-colors duration-300 border ${
              value === o.v
                ? 'bg-[#d4af37] text-black border-[#d4af37]'
                : 'bg-[#1c1c1e] text-white/60 border-[#2a2a2d] hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Market Analysis Input Panel ────────────────────────────────────────────
function AnalysisPanel({
  assets, onChange, override, onToggleOverride,
}: {
  assets: AssetState[];
  onChange: (i: number, patch: Partial<AssetState>) => void;
  override: boolean;
  onToggleOverride: () => void;
}) {
  return (
    <div className="border-b border-[#1c1c1e] bg-[#0d0d0f] px-6 py-5" dir="rtl">
      <div className="max-w-5xl mx-auto flex flex-col gap-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em]">
            לוח בקרה לניתוח סשן — הזן נתוני גרף
          </span>
          <button
            onClick={onToggleOverride}
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-sm border text-sm font-bold font-mono transition-colors duration-300 ${
              override ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] text-white/60 hover:text-white'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${override ? 'bg-[#d4af37]' : 'bg-white/30'}`} />
            עקוף שעון סשנים (למטרת בדיקה מחוץ לשעות המסחר)
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {assets.map((a, i) => (
            <div key={a.short} className="rounded-lg border border-[#1c1c1e] bg-[#000000] p-5 flex flex-col gap-3.5">
              <span className="text-base font-bold font-serif text-white border-b border-[#1c1c1e] pb-2.5">{a.symbol}</span>
              <Field label="מגמת H4" options={TREND_OPTS} value={a.h4} onSelect={v => onChange(i, { h4: v })} />
              <Field label="מגמת H1" options={TREND_OPTS} value={a.h1} onSelect={v => onChange(i, { h1: v })} />
              <Field label="גאפים שוריים" options={FVG_OPTS} value={a.bullishFVG} onSelect={v => onChange(i, { bullishFVG: v })} />
              <Field label="גאפים דוביים" options={FVG_OPTS} value={a.bearishFVG} onSelect={v => onChange(i, { bearishFVG: v })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsView() {
  const [assets, setAssets] = useState<AssetState[]>(loadAssets);
  const [override, setOverride] = useState(false);
  const [nowMin, setNowMin] = useState<number>(() => israelMinutes());

  // Persist the trader's manual analysis instantly.
  useEffect(() => { saveAssets(assets); }, [assets]);

  // Keep the IDT session current (no randomness).
  useEffect(() => {
    const id = setInterval(() => setNowMin(israelMinutes()), 20_000);
    return () => clearInterval(id);
  }, []);

  const session = activeSession(nowMin);
  const visible = override || session !== null;

  const updateAsset = (i: number, patch: Partial<AssetState>) =>
    setAssets(prev => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col h-full bg-[#000000] text-white overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0" dir="rtl">
        <span className="font-serif text-xl font-bold tracking-[0.1em] text-white">ניתוח שוק · דיילי ביאס</span>
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${session ? 'bg-[#d4af37]' : 'bg-white/40'}`} />
          <span className={`text-base font-bold font-mono tracking-[0.18em] ${session ? 'text-[#d4af37]' : 'text-white/55'}`}>
            {session ? session.label : 'אין סשן פעיל'}
          </span>
        </div>
      </header>

      {/* Market Analysis Input Panel — permanent trader control board */}
      <AnalysisPanel
        assets={assets}
        onChange={updateAsset}
        override={override}
        onToggleOverride={() => setOverride(o => !o)}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-12">
        {visible ? (
          <div className="max-w-5xl mx-auto">
            <div className="mb-8 text-center" dir="rtl">
              <span className="inline-block px-5 py-2 rounded-sm border border-[#d4af37]/40 bg-[#d4af37]/8 text-base font-bold font-mono text-[#d4af37] tracking-[0.18em]">
                {session ? session.label : 'הצגה ידנית · מחוץ לשעות הסשן'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {assets.map(s => <BiasCard key={s.short} state={s} />)}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-xl text-center rounded-xl border border-[#1c1c1e] bg-[#0d0d0f] p-10" dir="rtl">
              <span className="text-[#d4af37] text-4xl">◈</span>
              <p className="mt-5 text-xl font-bold text-white leading-relaxed tracking-wide">{LOCKED}</p>
            </div>
          </div>
        )}

        {/* Fixed advisory footnote */}
        <div className="max-w-5xl mx-auto mt-10" dir="rtl">
          <p className="text-sm text-zinc-500 text-right leading-relaxed tracking-wide">{FOOTNOTE}</p>
        </div>
      </div>
    </div>
  );
}
