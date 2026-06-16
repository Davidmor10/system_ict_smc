'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';

// ─────────────────────────────────────────────────────────────────────────────
//  Daily Bias — deterministic framework (H4/H1 trend + H4/H1 FVG respect).
//
//  BULLISH  : H4 UP  AND H1 UP  AND respects Bullish FVG AND violates Bearish FVG
//  BEARISH  : H4 DOWN AND H1 DOWN AND respects Bearish FVG AND violates Bullish FVG
//  NEUTRAL  : consolidation on H4/H1, or any mismatch / uncertainty
//
//  Bias is shown ONLY inside the active Israel-time (IDT) session windows.
//  Fully localized (EN/HE) from the language toggle; inputs persist to storage.
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

// ES on the LEFT, NQ on the RIGHT (universal workspace order).
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

// ─── Bilingual labels ────────────────────────────────────────────────────────
type Bi = { he: string; en: string };
const pick = (b: Bi, en: boolean) => (en ? b.en : b.he);

const TREND_LABEL: Record<Trend, Bi> = {
  UP:       { he: 'עולה',  en: 'Bullish'  },
  DOWN:     { he: 'יורד',  en: 'Bearish'  },
  SIDEWAYS: { he: 'דשדוש', en: 'Sideways' },
};
const TREND_HINT: Record<Trend, Bi> = {
  UP:       { he: 'שיאים ושפלים עולים',     en: 'Higher highs & higher lows' },
  DOWN:     { he: 'שיאים ושפלים יורדים',    en: 'Lower highs & lower lows'   },
  SIDEWAYS: { he: 'קונסולידציה / ללא כיוון', en: 'Consolidation / no direction' },
};
const TREND_META: Record<Trend, { icon: string; cls: string }> = {
  UP:       { icon: '▲', cls: 'text-bullish' },
  DOWN:     { icon: '▼', cls: 'text-bearish' },
  SIDEWAYS: { icon: '◈', cls: 'text-[#d4af37]' },
};
const FVG_LABEL: Record<FVG, Bi & { cls: string }> = {
  RESPECTED: { he: 'מכובדים', en: 'Respected', cls: 'text-bullish' },
  VIOLATED:  { he: 'נשברים',  en: 'Violated',  cls: 'text-bearish' },
};
const BIAS_WORD: Record<Bias, Bi> = {
  BULLISH: { he: 'שורי',   en: 'BULLISH' },
  BEARISH: { he: 'דובי',   en: 'BEARISH' },
  NEUTRAL: { he: 'ניטרלי', en: 'NEUTRAL' },
};
const BIAS_CLS: Record<Bias, { text: string; border: string; bg: string; glow: string }> = {
  BULLISH: { text: 'text-bullish',   border: 'border-bullish/40',   bg: 'bg-bullish/8',   glow: '[text-shadow:0_0_42px_rgba(74,124,89,0.55)]'  },
  BEARISH: { text: 'text-bearish',   border: 'border-bearish/40',   bg: 'bg-bearish/8',   glow: '[text-shadow:0_0_42px_rgba(139,58,58,0.55)]'  },
  NEUTRAL: { text: 'text-[#d4af37]', border: 'border-[#d4af37]/40', bg: 'bg-[#d4af37]/8', glow: '[text-shadow:0_0_42px_rgba(212,175,55,0.55)]' },
};

const STR = {
  headerTitle: { he: 'ניתוח שוק · דיילי ביאס', en: 'Market Analytics · Daily Bias' },
  noSession:   { he: 'אין סשן פעיל', en: 'No active session' },
  activePfx:   { he: 'סשן פעיל: ', en: 'Active Session: ' },
  panelTitle:  { he: 'לוח בקרה לניתוח סשן — הזן נתוני גרף', en: 'Session Analysis Control Board — Input Chart Data' },
  override:    { he: 'עקוף שעון סשנים (למטרת בדיקה מחוץ לשעות המסחר)', en: 'Override session clock (for testing outside market hours)' },
  marketTrend: { he: 'מגמת שוק', en: 'Market Trend' },
  fvgStatus:   { he: 'סטטוס גאפים', en: 'FVG Status' },
  h4Trend:     { he: 'מגמת H4', en: 'H4 Trend' },
  h1Trend:     { he: 'מגמת H1', en: 'H1 Trend' },
  bullFVG:     { he: 'גאפים שוריים', en: 'Bullish FVGs' },
  bearFVG:     { he: 'גאפים דוביים', en: 'Bearish FVGs' },
  banner:      { he: 'הצגה ידנית · מחוץ לשעות הסשן', en: 'Manual view · Outside session hours' },
  locked:      { he: 'אין סשן מסחר פעיל כרגע - הביאס יתעדכן עם תחילת הסשן הבא.', en: 'No active trading session right now — the bias will update at the start of the next session.' },
  footnote:    { he: 'הדיילי ביאס הוא רק עוד נקודת מבט של המערכת וכדאי ומומלץ להפעיל שיקול דעת משלך ומעצמך.', en: "The Daily Bias is only one of the system's perspectives — you should always apply your own independent judgment." },
  neutral:     {
    he: 'הביאס ניטרלי. נחכה לפתיחת השוק ואז נראה אם אפשר להשיג יותר מידע לגבי הכיוון היום בעזרת עוד אינפורמציה מהגרף. אם עדיין לא הצלחנו למצוא מידע שתורם ועוזר, לא נקח עסקה להיום.',
    en: "Bias is neutral. We'll wait for the market open and then see whether the chart offers more information about today's direction. If we still can't find anything that genuinely helps, we won't take a trade today.",
  },
} as const;

// ─── Israel-time (IDT) session windows ──────────────────────────────────────
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

// ─── Metric row + bias card ─────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#1c1c1e] last:border-0">
      <span className="text-base font-bold font-mono text-white/70 uppercase tracking-wider">{label}</span>
      <div className="flex flex-col items-start">{children}</div>
    </div>
  );
}

function BiasCard({ state, en }: { state: AssetState; en: boolean }) {
  const bias = computeBias(state);
  const c = BIAS_CLS[bias];

  const TrendValue = ({ tf }: { tf: Trend }) => (
    <>
      <span className={`text-lg font-bold font-mono ${TREND_META[tf].cls}`}>{pick(TREND_LABEL[tf], en)} {TREND_META[tf].icon}</span>
      <span className="text-xs font-bold font-mono text-white/40 mt-0.5">{pick(TREND_HINT[tf], en)}</span>
    </>
  );

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-8 flex flex-col items-center text-center`} dir={en ? 'ltr' : 'rtl'}>
      <span className="text-sm font-bold font-mono text-white/70 uppercase tracking-[0.25em]">{state.symbol}</span>

      <div className="mt-6 mb-2">
        <span className={`font-serif font-black leading-none ${c.text} ${c.glow}`} style={{ fontSize: 'clamp(2.6rem,7vw,4.5rem)' }}>
          [{bias}]
        </span>
      </div>
      <span className={`text-lg font-bold font-mono ${c.text} tracking-[0.2em]`}>{pick(BIAS_WORD[bias], en)}</span>

      <div className="w-full mt-8 flex flex-col gap-7">
        <div>
          <span className="block text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em] mb-2 border-b border-[#1c1c1e] pb-2">{pick(STR.marketTrend, en)}</span>
          <Row label="H4"><TrendValue tf={state.h4} /></Row>
          <Row label="H1"><TrendValue tf={state.h1} /></Row>
        </div>

        <div>
          <span className="block text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.18em] mb-2 border-b border-[#1c1c1e] pb-2">{pick(STR.fvgStatus, en)}</span>
          <Row label={pick(STR.bullFVG, en)}><span className={`text-lg font-bold font-mono ${FVG_LABEL[state.bullishFVG].cls}`}>{pick(FVG_LABEL[state.bullishFVG], en)}</span></Row>
          <Row label={pick(STR.bearFVG, en)}><span className={`text-lg font-bold font-mono ${FVG_LABEL[state.bearishFVG].cls}`}>{pick(FVG_LABEL[state.bearishFVG], en)}</span></Row>
        </div>
      </div>

      {bias === 'NEUTRAL' && (
        <div className="w-full mt-7 rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/5 p-5 [box-shadow:0_0_40px_-12px_rgba(212,175,55,0.4)]">
          <p className="text-base font-bold text-[#c0c0c0] leading-relaxed tracking-wide">{pick(STR.neutral, en)}</p>
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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3">
      <span className="text-xs sm:text-sm font-bold font-mono text-white/70 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onSelect(o.v)}
            className={`px-2.5 py-1.5 rounded-sm text-xs sm:text-sm font-bold font-mono transition-colors duration-300 border ${
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
  assets, onChange, override, onToggleOverride, en,
}: {
  assets: AssetState[];
  onChange: (i: number, patch: Partial<AssetState>) => void;
  override: boolean;
  onToggleOverride: () => void;
  en: boolean;
}) {
  const trendOpts = (['UP', 'DOWN', 'SIDEWAYS'] as Trend[]).map(v => ({ v, label: pick(TREND_LABEL[v], en) }));
  const fvgOpts   = (['RESPECTED', 'VIOLATED'] as FVG[]).map(v => ({ v, label: pick(FVG_LABEL[v], en) }));

  return (
    <div className="border-b border-[#1c1c1e] bg-[#0d0d0f] px-4 md:px-6 py-4 md:py-5" dir={en ? 'ltr' : 'rtl'}>
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs md:text-base font-bold font-mono text-[#d4af37] uppercase tracking-[0.14em] md:tracking-[0.18em]">{pick(STR.panelTitle, en)}</span>
          <button
            onClick={onToggleOverride}
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-sm border text-sm font-bold font-mono transition-colors duration-300 ${
              override ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] text-white/60 hover:text-white'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${override ? 'bg-[#d4af37]' : 'bg-white/30'}`} />
            {pick(STR.override, en)}
          </button>
        </div>

        {/* dir=ltr locks ES (left) · NQ (right) regardless of language */}
        <div className="grid md:grid-cols-2 gap-5" dir="ltr">
          {assets.map((a, i) => (
            <div key={a.short} className="rounded-lg border border-[#1c1c1e] bg-[#000000] p-5 flex flex-col gap-3.5" dir={en ? 'ltr' : 'rtl'}>
              <span className="text-base font-bold font-serif text-white border-b border-[#1c1c1e] pb-2.5">{a.symbol}</span>
              <Field label={pick(STR.h4Trend, en)} options={trendOpts} value={a.h4} onSelect={v => onChange(i, { h4: v })} />
              <Field label={pick(STR.h1Trend, en)} options={trendOpts} value={a.h1} onSelect={v => onChange(i, { h1: v })} />
              <Field label={pick(STR.bullFVG, en)} options={fvgOpts} value={a.bullishFVG} onSelect={v => onChange(i, { bullishFVG: v })} />
              <Field label={pick(STR.bearFVG, en)} options={fvgOpts} value={a.bearishFVG} onSelect={v => onChange(i, { bearishFVG: v })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsView() {
  const { lang } = useLanguage();
  const en = lang === 'en';

  const [assets, setAssets] = useState<AssetState[]>(loadAssets);
  const [override, setOverride] = useState(false);
  const [nowMin, setNowMin] = useState<number>(() => israelMinutes());

  useEffect(() => { saveAssets(assets); }, [assets]);
  useEffect(() => {
    const id = setInterval(() => setNowMin(israelMinutes()), 20_000);
    return () => clearInterval(id);
  }, []);

  const session = activeSession(nowMin);
  const visible = override || session !== null;
  const sessionLabel = session ? pick(STR.activePfx, en) + pick(session, en) : pick(STR.noSession, en);

  const updateAsset = (i: number, patch: Partial<AssetState>) =>
    setAssets(prev => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    /* Single scroll context — header sticks to top, everything else flows down */
    <div className="h-full bg-[#000000] text-white overflow-y-auto">

      {/* Sticky header */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 py-3 border-b border-[#1c1c1e] bg-[#000000]"
        dir={en ? 'ltr' : 'rtl'}
      >
        <span className="font-serif text-base md:text-xl font-bold tracking-[0.06em] md:tracking-[0.1em] text-white">{pick(STR.headerTitle, en)}</span>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${session ? 'bg-[#d4af37]' : 'bg-white/40'}`} />
          <span className={`text-xs md:text-base font-bold font-mono tracking-[0.14em] md:tracking-[0.18em] ${session ? 'text-[#d4af37]' : 'text-white/55'}`}>{sessionLabel}</span>
        </div>
      </header>

      {/* Input panel — scrolls away naturally */}
      <AnalysisPanel assets={assets} onChange={updateAsset} override={override} onToggleOverride={() => setOverride(o => !o)} en={en} />

      {/* Bias cards + footnote — scroll into view */}
      <div className="px-4 md:px-6 py-10">
        {visible ? (
          <div className="max-w-5xl mx-auto">
            <div className="mb-8 text-center">
              <span className="inline-block px-5 py-2 rounded-sm border border-[#d4af37]/40 bg-[#d4af37]/8 text-base font-bold font-mono text-[#d4af37] tracking-[0.18em]">
                {session ? pick(STR.activePfx, en) + pick(session, en) : pick(STR.banner, en)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6" dir="ltr">
              {assets.map(s => <BiasCard key={s.short} state={s} en={en} />)}
            </div>
          </div>
        ) : (
          <div className="min-h-[40vh] flex items-center justify-center">
            <div className="max-w-xl text-center rounded-xl border border-[#1c1c1e] bg-[#0d0d0f] p-10" dir={en ? 'ltr' : 'rtl'}>
              <span className="text-[#d4af37] text-4xl">◈</span>
              <p className="mt-5 text-xl font-bold text-white leading-relaxed tracking-wide">{pick(STR.locked, en)}</p>
            </div>
          </div>
        )}

        <div className="max-w-5xl mx-auto mt-10" dir={en ? 'ltr' : 'rtl'}>
          <p className={`text-sm text-zinc-500 leading-relaxed tracking-wide ${en ? 'text-left' : 'text-right'}`}>{pick(STR.footnote, en)}</p>
        </div>
      </div>
    </div>
  );
}
