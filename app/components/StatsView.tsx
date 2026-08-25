'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import './stats.css';
import { loadTrades, hydrateTradesFromCloud } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { computeStatistics } from '../lib/analytics/statistics';
import type { PerformanceStats, GroupStat, EdgeComponent, DayPoint } from '../lib/analytics/statistics';
import { hydrateDoc } from '../lib/sync/collections';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_KIND, withDefaults } from '../lib/settings/types';
import type { UserSettings } from '../lib/settings/types';

// ─────────────────────────────────────────────────────────────────────────────
// StatsView — the performance screen.
//
// Built from the Onyx design handoff. Two panels the handoff specifies are
// absent here, and on purpose: Holding Time and Position Sizing both need
// fields the journal does not collect — an exit timestamp and whether the size
// matched the calculator. Rather than render an empty shell or invent the
// numbers, Holding Time's slot is taken by Plan vs Execution, which answers a
// question of the same shape (what happens between the plan and the exit) out
// of data that actually exists.
//
// Everything numeric comes from computeStatistics(). This file formats and
// draws; it does not decide anything, which is why the arithmetic is testable
// without a DOM.
// ─────────────────────────────────────────────────────────────────────────────

// ── formatting ──────────────────────────────────────────────────────────────

const nf = (n: number, d = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Signed dollars — the sign is always shown, because on this screen a number
 *  without one is ambiguous between "no change" and "not measured". */
const money = (n: number, d = 2) => `${n < 0 ? '−' : '+'}$${nf(Math.abs(n), d)}`;
const plain = (n: number, d = 0) => `$${nf(n, d)}`;
const pct = (n: number, d = 2) => `${n >= 0 ? '+' : '−'}${nf(Math.abs(n), d)}%`;

const pnlColor = (n: number) => (n > 0 ? '#6ea87f' : n < 0 ? '#c05d5d' : 'rgba(255,255,255,0.42)');

const MONTH_HE = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const fmtDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_HE[Number(m) - 1]}`;
};
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const BIAS_HE: Record<string, string> = { BULLISH: 'עולה', BEARISH: 'יורד', INDECISIVE: 'מעורב' };
const BAND_HE: Record<string, string> = { strong: 'חזק', solid: 'מבוסס', developing: 'בהתפתחות' };

/** The one number a reader must never mistake for zero. `null` is "we did not
 *  measure this", and it renders as an em dash everywhere, never as 0. */
const orDash = (v: number | null | undefined, render: (n: number) => string) =>
  v == null ? '—' : render(v);

// ── mount animation ─────────────────────────────────────────────────────────

/** 0 → 1 over 1100ms with an ease-out cubic, once, on mount.
 *
 *  Every headline figure is multiplied by this so the screen counts up. A
 *  1800ms safety timer forces completion: a dropped frame must never leave a
 *  trader looking at a number that is quietly 4% short of the truth. */
function useMountProgress(): number {
  // Starts finished. The server renders the real numbers, and the count-up
  // only ever begins from inside a frame callback — so a hydration mismatch is
  // impossible and no state is set synchronously during the effect.
  const [p, setP] = useState(1);
  const raf = useRef(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let t0: number | null = null;
    const step = (t: number) => {
      if (t0 === null) t0 = t;
      const k = Math.min(1, (t - t0) / 1100);
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    const safety = setTimeout(() => setP(1), 1800);
    return () => { cancelAnimationFrame(raf.current); clearTimeout(safety); };
  }, []);

  return p;
}

// ── sparkline ───────────────────────────────────────────────────────────────

const TONE = {
  gold: { stroke: 'rgba(212,175,55,0.8)', fill: 'rgba(212,175,55,0.10)' },
  bull: { stroke: '#4a7c59', fill: 'rgba(74,124,89,0.12)' },
  bear: { stroke: '#8b3a3a', fill: 'rgba(139,58,58,0.12)' },
} as const;

function Sparkline({ values, tone }: { values: number[]; tone: keyof typeof TONE }) {
  // Under two points there is no line to draw. A placeholder box says "not yet"
  // where a flat line would have said "steady".
  if (values.length < 2) return <div className="st-kpi-nospark" aria-hidden />;

  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 120).toFixed(1)} ${(5 + (1 - (v - min) / span) * 30).toFixed(1)}`)
    .join(' ');
  const c = TONE[tone];

  return (
    <svg viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden>
      <path d={`${d} L120 40 L0 40 Z`} fill={c.fill} style={{ animation: 'st-fade 800ms 420ms both' }} />
      <path
        d={d} pathLength={1} fill="none" stroke={c.stroke} strokeWidth={1.4} vectorEffect="non-scaling-stroke"
        style={{ strokeDasharray: 1, animation: 'st-draw 1100ms 300ms cubic-bezier(0.16,1,0.3,1) both' }}
      />
    </svg>
  );
}

// ── equity curve ────────────────────────────────────────────────────────────

/** A round axis step for the value range — 1 / 2.5 / 5 / 10 × a power of ten,
 *  so the gridline labels are balances a person recognises. */
function niceStep(range: number): number {
  const raw = (range || 1) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return Math.max(50, mag * (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2.5 : 1));
}

function EquityChart({ days, start }: { days: DayPoint[]; start: number }) {
  const equity = [start, ...days.map(d => d.equity)];
  const peaks = [start, ...days.map(d => d.peak)];
  const n = equity.length;

  const step = niceStep(Math.max(...peaks) - Math.min(...equity));
  const lo = Math.floor(Math.min(...equity) / step) * step;
  const hi = Math.ceil(Math.max(...peaks) / step) * step;
  const span = hi - lo || 1;

  const H = 288, PAD = 16;
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const x = (i: number) => (i / (n - 1)) * 900;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  const eqLine = path(equity);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-6; v += step) ticks.push(v);

  const peakIdx = equity.indexOf(Math.max(...equity));
  const markers = [
    { i: 0, v: start, label: 'פתיחה', gold: false, above: false },
    { i: peakIdx, v: equity[peakIdx], label: 'שיא', gold: true, above: true },
    { i: n - 1, v: equity[n - 1], label: 'סגירה', gold: true, above: false },
  ];

  // One tick per month the account actually traded in.
  const months: { i: number; label: string }[] = [];
  days.forEach((d, i) => {
    const m = Number(d.dateISO.slice(5, 7));
    if (!months.length || months[months.length - 1].label !== MONTH_HE[m - 1]) {
      months.push({ i: i + 1, label: MONTH_HE[m - 1] });
    }
  });

  return (
    <div className="st-chart">
      <div className="st-axis" aria-hidden>
        {ticks.map(v => (
          <div key={v} className="st-n" style={{ top: `${((y(v) / H) * 100).toFixed(2)}%` }}>{plain(v)}</div>
        ))}
      </div>
      <div className="st-plot">
        <svg viewBox="0 0 900 288" preserveAspectRatio="none" role="img" aria-label="עקומת ההון">
          <defs>
            <linearGradient id="stEqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(212,175,55,0.24)" />
              <stop offset="100%" stopColor="rgba(212,175,55,0)" />
            </linearGradient>
          </defs>
          {ticks.map(v => (
            <line key={v} x1={0} x2={900} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          ))}
          {/* The gap between the running peak and the curve — every hour the
              account spent under water, as an area rather than a statistic. */}
          <path
            d={`${path(peaks)} ${equity.slice().reverse().map((v, j) => `L${x(n - 1 - j).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} Z`}
            fill="rgba(139,58,58,0.24)" style={{ animation: 'st-fade 900ms 800ms both' }}
          />
          <path d={`${eqLine} L900 288 L0 288 Z`} fill="url(#stEqFill)" style={{ animation: 'st-fade 1000ms 500ms both' }} />
          <line x1={0} x2={900} y1={y(start)} y2={y(start)} stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="1 5" />
          <path d={path(peaks)} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" style={{ animation: 'st-fade 900ms 700ms both' }} />
          <path
            d={eqLine} pathLength={1} fill="none" stroke="#d4af37" strokeWidth={2} vectorEffect="non-scaling-stroke"
            style={{ strokeDasharray: 1, animation: 'st-draw 1600ms 260ms cubic-bezier(0.16,1,0.3,1) both' }}
          />
        </svg>

        {markers.map(m => {
          const frac = n > 1 ? m.i / (n - 1) : 0;
          const flip = frac > 0.75;
          return (
            <div
              key={m.label}
              className="st-marker"
              style={{ left: `calc(24px + ${(frac * 100).toFixed(2)}% - ${(48 * frac).toFixed(1)}px)`, top: `${(18 + y(m.v)).toFixed(1)}px` }}
            >
              <span
                className="st-marker-dot"
                style={{
                  background: m.gold ? '#d4af37' : 'rgba(255,255,255,0.6)',
                  boxShadow: `0 0 10px ${m.gold ? 'rgba(212,175,55,0.7)' : 'rgba(255,255,255,0.3)'}`,
                }}
              />
              <span
                className="st-marker-chip"
                style={{
                  left: flip ? 'auto' : '12px',
                  right: flip ? '12px' : 'auto',
                  top: m.above ? '-30px' : '12px',
                  border: `1px solid ${m.gold ? 'rgba(212,175,55,0.34)' : 'rgba(255,255,255,0.14)'}`,
                  color: m.gold ? '#d4af37' : 'rgba(255,255,255,0.55)',
                }}
              >
                <span dir="rtl">{m.label}</span>
                <span className="st-n" style={{ color: 'rgba(255,255,255,0.6)' }}>{plain(m.v)}</span>
              </span>
            </div>
          );
        })}

        <div className="st-ticks" aria-hidden>
          {months.map(m => (
            <div key={`${m.label}-${m.i}`} style={{ left: `calc(${((m.i / (n - 1)) * 100).toFixed(2)}% - 1px)` }}>
              <i /><span>{m.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── daily bars ──────────────────────────────────────────────────────────────

function DailyBars({ days }: { days: DayPoint[] }) {
  const [hot, setHot] = useState<number | null>(null);

  const maxAbs = Math.max(...days.map(d => Math.abs(d.pnl)), 1);
  const bw = 900 / days.length;
  const frac = ((hot ?? 0) + 0.5) / days.length;
  const rec = hot == null ? null : days[hot];

  return (
    <div className="st-bars" onMouseLeave={() => setHot(null)}>
      <span className="st-bars-max st-n">{money(maxAbs, 0)}</span>
      <span className="st-bars-min st-n">{money(-maxAbs, 0)}</span>

      <div
        className="st-tip"
        style={{ left: `calc(22px + ${(frac * 100).toFixed(2)}% - ${(44 * frac).toFixed(1)}px)`, opacity: rec ? 1 : 0 }}
        aria-hidden={!rec}
      >
        <div className="st-tip-d">{rec ? fmtDay(rec.dateISO) : '—'}</div>
        <div className="st-tip-v st-n" style={{ color: rec ? pnlColor(rec.pnl) : 'rgba(255,255,255,0.3)' }}>
          {rec ? money(rec.pnl) : '—'}
        </div>
        <div className="st-tip-e" dir="rtl">
          {rec ? <>מאזן סגירה <span className="st-n">{plain(rec.equity)}</span></> : ''}
        </div>
      </div>

      <svg viewBox="0 0 900 210" preserveAspectRatio="none" role="img" aria-label="רווח והפסד יומי">
        <defs>
          <linearGradient id="stBarPos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(110,168,127,0.95)" /><stop offset="100%" stopColor="rgba(74,124,89,0.35)" />
          </linearGradient>
          <linearGradient id="stBarNeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(139,58,58,0.4)" /><stop offset="100%" stopColor="rgba(192,93,93,0.95)" />
          </linearGradient>
          <linearGradient id="stZero" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(212,175,55,0.05)" />
            <stop offset="50%" stopColor="rgba(212,175,55,0.34)" />
            <stop offset="100%" stopColor="rgba(212,175,55,0.05)" />
          </linearGradient>
        </defs>
        <line x1={0} x2={900} y1={9} y2={9} stroke="rgba(255,255,255,0.05)" strokeWidth={1} strokeDasharray="2 8" />
        <line x1={0} x2={900} y1={201} y2={201} stroke="rgba(255,255,255,0.05)" strokeWidth={1} strokeDasharray="2 8" />
        {hot != null && (
          <rect x={hot * bw - 1} y={0} width={bw + 2} height={210} fill="rgba(255,255,255,0.05)" />
        )}
        <line x1={0} x2={900} y1={105} y2={105} stroke="url(#stZero)" strokeWidth={1} />
        <g style={{ transformOrigin: '0 105px', animation: 'st-sweep 900ms 200ms cubic-bezier(0.16,1,0.3,1) both' }}>
          {days.map((d, i) => {
            const h = Math.max(2, (Math.abs(d.pnl) / maxAbs) * 96);
            const up = d.pnl >= 0;
            return (
              <rect
                key={d.dateISO}
                data-bar
                x={i * bw + 1.2} width={Math.max(1, bw - 2.4)}
                y={up ? 105 - h : 105} height={h} rx={1}
                fill={up ? 'url(#stBarPos)' : 'url(#stBarNeg)'}
                opacity={hot == null ? 0.92 : hot === i ? 1 : 0.34}
                onMouseEnter={() => setHot(i)}
              >
                <title>{`${fmtDay(d.dateISO)} · ${money(d.pnl)}`}</title>
              </rect>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ── radar ───────────────────────────────────────────────────────────────────

function Radar({ components }: { components: EdgeComponent[] }) {
  const cx = 100, cy = 96, R = 66, N = components.length;
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return { x: +(cx + Math.cos(a) * R * f).toFixed(1), y: +(cy + Math.sin(a) * R * f).toFixed(1) };
  };
  const ring = (f: number) => components.map((_, i) => { const q = pt(i, f); return `${q.x},${q.y}`; }).join(' ');
  // An unmeasured axis collapses to the centre rather than sitting at full
  // reach — the shape must not imply a score that was never computed.
  const poly = components.map((c, i) => { const q = pt(i, (c.score ?? 0) / 100); return `${q.x},${q.y}`; }).join(' ');

  return (
    <div className="st-radar">
      {components.map((c, i) => {
        const q = pt(i, 1.34);
        const dx = q.x - cx, dy = q.y - cy;
        const mid = Math.abs(dx) < 6;
        return (
          <div
            key={c.key}
            className="st-radar-l"
            style={{
              left: `${(46 + q.x).toFixed(1)}px`,
              top: `${(22 + q.y).toFixed(1)}px`,
              transform: `translate(${mid ? '-50%' : dx > 0 ? '4px' : 'calc(-100% - 4px)'}, ${dy < -10 ? '-100%' : dy > 10 ? '0' : '-50%'})`,
              textAlign: mid ? 'center' : dx > 0 ? 'left' : 'right',
            }}
          >
            <b>{c.short}</b>
            <span className="st-n">{c.score ?? '—'}</span>
          </div>
        );
      })}
      <svg viewBox="0 0 200 196" aria-hidden>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
        ))}
        {components.map((c, i) => {
          const q = pt(i, 1);
          return <line key={c.key} x1={cx} y1={cy} x2={q.x} y2={q.y} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />;
        })}
        <polygon points={poly} fill="rgba(212,175,55,0.16)" stroke="#d4af37" strokeWidth={1.5} />
        {components.map((c, i) => {
          const q = pt(i, (c.score ?? 0) / 100);
          return <circle key={c.key} cx={q.x} cy={q.y} r={2.6} fill={c.score == null ? 'rgba(255,255,255,0.2)' : '#d4af37'} />;
        })}
      </svg>
    </div>
  );
}

// ── group list (session / weekday) ──────────────────────────────────────────

function GroupList({ groups, best }: { groups: GroupStat[]; best: GroupStat | null }) {
  const max = Math.max(...groups.map(g => Math.abs(g.pnl)), 1);
  return (
    <div className="st-rows">
      {groups.map(g => {
        const isBest = best?.key === g.key;
        return (
          <div className="st-group" key={g.key}>
            <div className="st-group-h">
              <span className="st-group-n" style={{ color: isBest ? '#d4af37' : 'rgba(255,255,255,0.88)' }}>{g.label}</span>
              <span className="st-group-m">
                <span className="st-n">{g.n}</span> עסקאות
                {g.winRate != null && <> · <span className="st-n">{nf(g.winRate * 100, 1)}%</span> הצלחה</>}
              </span>
              <span className="st-group-p st-n" style={{ color: g.n ? pnlColor(g.pnl) : 'rgba(255,255,255,0.24)' }}>
                {g.n ? money(g.pnl, 0) : '—'}
              </span>
            </div>
            <div className="st-bar-track">
              <div
                className="st-bar-fill"
                style={{
                  width: `${((Math.abs(g.pnl) / max) * 100).toFixed(0)}%`,
                  background: isBest ? 'rgba(212,175,55,0.75)' : g.pnl >= 0 ? 'rgba(74,124,89,0.85)' : 'rgba(139,58,58,0.85)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── the screen ──────────────────────────────────────────────────────────────

function SectionHead({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="st-band-h">
      <i>◈</i><b>{title}</b><hr />{caption && <span>{caption}</span>}
    </div>
  );
}

export default function StatsView() {
  const [trades, setTrades] = useState<TradeEntry[] | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const p = useMountProgress();

  useEffect(() => {
    setTrades(loadTrades());
    hydrateTradesFromCloud().then(setTrades).catch(() => { /* keep the local copy */ });
    hydrateDoc<UserSettings>(SETTINGS_KIND, SETTINGS_KEY)
      .then(doc => { if (doc) setSettings(withDefaults(doc)); })
      .catch(() => { /* defaults are fine */ });
  }, []);

  const accountStart = settings.accountStartUsd;
  const s: PerformanceStats = useMemo(
    () => computeStatistics(trades ?? [], accountStart),
    [trades, accountStart],
  );

  // Loading renders the shell, not a spinner — the hero is real either way and
  // a flash of nothing on every visit reads worse than a beat of empty numbers.
  const ready = trades !== null;

  return (
    <div className="st">
      <section className="st-hero st-sec" data-i="0">
        <div className="st-eyebrow"><span>◈</span><span>ביצועי ONYX</span></div>
        <h1 className="st-h1">סטטיסטיקות ביצועים</h1>
        <p className="st-lede">
          כל פוזיציה סגורה, נמדדת מול התוכנית שלפיה נלקחה. איכות ביצוע קודם, רווח אחר כך.
        </p>
        <div className="st-spec">
          <div><div className="st-spec-k">עסקאות סגורות</div><div className="st-spec-v st-n">{s.n}</div></div>
          <div><div className="st-spec-k">ימי מסחר</div><div className="st-spec-v st-n">{s.equity.days.length}</div></div>
          <div><div className="st-spec-k">מאזן פתיחה</div><div className="st-spec-v st-n">{plain(accountStart)}</div></div>
          {s.open > 0 && (
            <div><div className="st-spec-k">פתוחות כרגע</div><div className="st-spec-v st-n">{s.open}</div></div>
          )}
        </div>
      </section>

      {ready && s.n === 0 ? (
        <section className="st-band">
          <div className="st-empty">
            <b>אין עדיין עסקאות סגורות</b>
            העמוד הזה נבנה מהעסקאות שסגרת. תעד עסקה אחת וסגור אותה — הכל כאן יתחיל להתמלא.
            <div style={{ marginTop: 14 }}>
              <Link href="/dashboard/journal" style={{ color: '#d4af37', fontWeight: 700 }}>לפתיחת היומן →</Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* ── headline numbers ─────────────────────────────────── */}
          <section className="st-kpis">
            {s.headline.map((k, i) => (
              <div className="st-kpi" key={k.key} style={{ animationDelay: `${60 * (i + 1)}ms` }}>
                <div style={{ minWidth: 0 }}>
                  <div className="st-kpi-k">{k.label}</div>
                  <div
                    className="st-kpi-v st-n"
                    style={{ color: k.key === 'avgRR' ? '#d4af37' : k.key === 'maxDrawdown' ? '#c05d5d' : '#fff' }}
                  >
                    {orDash(k.value, v =>
                      k.unit === 'percent' ? `${nf(v * p, 2)}%`
                        : k.unit === 'usd' ? `${v < 0 ? '−' : ''}$${nf(Math.abs(v * p), 2)}`
                          : nf(v * p, 2))}
                  </div>
                </div>
                <Sparkline values={k.spark} tone={k.tone} />
              </div>
            ))}
          </section>

          {/* ── performance ──────────────────────────────────────── */}
          <section className="st-band st-sec" data-i="1">
            <SectionHead title="ביצועים" caption={`${s.equity.days.length} ימי מסחר`} />
            <div className="st-panel" data-feature>
              <div className="st-net">
                <div>
                  <div className="st-net-k">
                    <b>רווח נקי</b>
                    <em className="st-n">{pct(s.returnPct * p)}</em>
                  </div>
                  <div className="st-net-v st-n">{money(s.net * p)}</div>
                  <div className="st-net-sub">
                    על מאזן פתיחה של <span className="st-n">{plain(accountStart)}</span>
                    {' · '}מאזן נוכחי <span className="st-n">{plain(s.equity.end)}</span>
                  </div>
                </div>
                {s.bestSession && (
                  <div className="st-net-note">
                    <span>◈</span>
                    <span>סשן {s.bestSession.label} תרם <span className="st-n">{money(s.bestSession.pnl, 0)}</span></span>
                  </div>
                )}
              </div>

              {s.equity.days.length > 0 && (
                <>
                  <div className="st-legend">
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.24em', color: '#fff' }}>עקומת הון</span>
                    <div className="st-legend-set">
                      <span><i className="st-swatch" data-k="equity" />הון</span>
                      <span><i className="st-swatch" data-k="peak" />שיא רץ</span>
                      <span><i className="st-swatch" data-k="drawdown" />מתחת לשיא</span>
                      <span><i className="st-swatch" data-k="start" />פתיחה</span>
                    </div>
                  </div>
                  <EquityChart days={s.equity.days} start={accountStart} />
                </>
              )}

              <div className="st-strip">
                <div><div className="st-strip-k">מאזן פתיחה</div><div className="st-strip-v st-n" style={{ color: 'rgba(255,255,255,0.62)' }}>{plain(accountStart)}</div></div>
                <div><div className="st-strip-k">מאזן סגירה</div><div className="st-strip-v st-n" style={{ color: '#fff' }}>{plain(s.equity.end)}</div></div>
                <div><div className="st-strip-k">שיא הון</div><div className="st-strip-v st-n" style={{ color: '#d4af37' }}>{plain(s.equity.peak)}</div></div>
                <div><div className="st-strip-k">תשואה על החשבון</div><div className="st-strip-v st-n" style={{ color: pnlColor(s.returnPct) }}>{pct(s.returnPct)}</div></div>
              </div>
            </div>
          </section>

          {/* ── execution ────────────────────────────────────────── */}
          <section className="st-band st-sec" data-i="2">
            <SectionHead title="ביצוע" caption="תוצאה יומית · רצפים · תוכנית מול ביצוע" />
            <div className="st-grid st-grid-wide">
              <div className="st-panel">
                <div className="st-panel-h">
                  <b>רווח והפסד יומי</b>
                  <div className="st-counts">
                    <span style={{ color: '#6ea87f' }}>▲ <span className="st-n">{s.equity.green}</span> ירוקים</span>
                    <span style={{ color: '#c05d5d' }}>▼ <span className="st-n">{s.equity.red}</span> אדומים</span>
                  </div>
                </div>
                {s.equity.days.length > 0 && <DailyBars days={s.equity.days} />}
                <div className="st-strip">
                  <div><div className="st-strip-k">היום הטוב</div><div className="st-strip-v st-n" style={{ color: '#6ea87f' }}>{money(s.equity.best, 0)}</div></div>
                  <div><div className="st-strip-k">היום הגרוע</div><div className="st-strip-v st-n" style={{ color: '#c05d5d' }}>{money(s.equity.worst, 0)}</div></div>
                  <div><div className="st-strip-k">ממוצע יומי</div><div className="st-strip-v st-n" style={{ color: '#d4af37' }}>{money(s.equity.avgDay)}</div></div>
                  <div><div className="st-strip-k">ירידה מקסימלית</div><div className="st-strip-v st-n" style={{ color: '#c05d5d' }}>{plain(s.equity.maxDrawdown)}</div></div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="st-panel">
                  <div className="st-panel-h"><b>רצפים</b></div>
                  <div className="st-rows">
                    <div className="st-row"><span className="st-row-k">רצף ניצחונות ארוך</span><span className="st-row-v st-n" style={{ color: '#6ea87f' }}>{s.streaks.maxWin}</span></div>
                    <div className="st-row"><span className="st-row-k">רצף הפסדים ארוך</span><span className="st-row-v st-n" style={{ color: '#c05d5d' }}>{s.streaks.maxLoss}</span></div>
                    <div className="st-row">
                      <span className="st-row-k">רצף נוכחי</span>
                      <span className="st-row-v st-n" style={{ color: s.streaks.current > 0 ? '#d4af37' : s.streaks.current < 0 ? '#c05d5d' : 'rgba(255,255,255,0.42)' }}>
                        {s.streaks.current === 0 ? '—' : `${Math.abs(s.streaks.current)}${s.streaks.current > 0 ? 'W' : 'L'}`}
                      </span>
                    </div>
                    <div className="st-row"><span className="st-row-k">רווח ממוצע</span><span className="st-row-v st-n" style={{ color: '#6ea87f' }}>{orDash(s.avgWin, v => plain(v, 2))}</span></div>
                    <div className="st-row"><span className="st-row-k">הפסד ממוצע</span><span className="st-row-v st-n" style={{ color: '#c05d5d' }}>{orDash(s.avgLoss, v => `−${plain(v, 2)}`)}</span></div>
                    <div className="st-row"><span className="st-row-k">הרווח הגדול ביותר</span><span className="st-row-v st-n" style={{ color: '#fff' }}>{orDash(s.largestWin, v => plain(v, 2))}</span></div>
                  </div>
                </div>

                {/* Stands where the handoff put Holding Time. Same question —
                    what happens between the plan and the exit — asked of data
                    the journal actually keeps. */}
                <div className="st-panel" style={{ flex: 1 }}>
                  <div className="st-panel-h"><b>תוכנית מול ביצוע</b></div>
                  <div className="st-rows">
                    <div className="st-row"><span className="st-row-k">יעד ממוצע שתכננת</span><span className="st-row-v st-n">{nf(s.planVsReal.avgPlannedRR, 2)}R</span></div>
                    <div className="st-row"><span className="st-row-k">R ממוצע שלקחת בפועל</span><span className="st-row-v st-n" style={{ color: '#d4af37' }}>{s.planVsReal.measured ? `${nf(s.planVsReal.avgRealizedR, 2)}R` : '—'}</span></div>
                    <div className="st-row">
                      <span className="st-row-k">מימוש היעד במנצחות</span>
                      <span className="st-row-v st-n" style={{ color: '#6ea87f' }}>{orDash(s.planVsReal.captureRate, v => `${nf(v * 100, 0)}%`)}</span>
                    </div>
                    <div className="st-row"><span className="st-row-k">עם יציאה מתועדת</span><span className="st-row-v st-n">{s.planVsReal.measured} / {s.n}</span></div>
                    {s.planVsReal.assumed > 0 && (
                      <p className="st-note">
                        ב־<span className="st-n">{s.planVsReal.assumed}</span> עסקאות לא תועד מחיר יציאה, אז ה־R שלהן מוסק מהתוצאה ולא נמדד.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── edge & risk ──────────────────────────────────────── */}
          <section className="st-band st-sec" data-i="3">
            <SectionHead title="יתרון וסיכון" caption="מודל איכות משוקלל · משמעת" />
            <div className="st-grid st-grid-edge">
              <div className="st-edge">
                <div className="st-panel-h" style={{ borderBottom: '1px solid var(--st-rule)' }}>
                  <b style={{ color: '#d4af37' }}>ציון יתרון</b>
                  <em>{s.edge.measured} מתוך {s.edge.total} רכיבים נמדדו</em>
                </div>
                <div className="st-edge-body">
                  <div>
                    <div className="st-edge-v">
                      <b className="st-n">{orDash(s.edge.score, v => nf(v * p, 1))}</b>
                      <span>/ 100</span>
                    </div>
                    {s.edge.band && <span className="st-badge" data-band={s.edge.band}>◈ {BAND_HE[s.edge.band]}</span>}

                    <div className="st-weights">
                      {s.edge.components.map(c => (
                        <div className="st-weight" key={c.key} data-missing={c.score == null}>
                          <span className="st-weight-k">{c.label}</span>
                          <span className="st-weight-w st-n">{nf(c.weight * 100, 0)}%</span>
                          <span className="st-weight-s st-n">{c.score ?? '—'}</span>
                          <span className="st-weight-c st-n">{c.score == null ? '—' : nf(c.effectiveWeight * c.score, 2)}</span>
                          {c.score == null && <span className="st-weight-why">{c.missing}</span>}
                        </div>
                      ))}
                      <div className="st-weight-total">
                        <span>סך משוקלל</span>
                        <span className="st-n">{orDash(s.edge.score, v => nf(v, 1))}</span>
                      </div>
                    </div>
                  </div>
                  <Radar components={s.edge.components} />
                </div>

                {!s.evidence.enoughForConfirmed && (
                  <p className="st-caveat">
                    {!s.evidence.enoughForClaim ? (
                      <>הציון מחושב על <span className="st-n">{s.evidence.decided}</span> עסקאות שנסגרו. מתחת ל־<span className="st-n">{s.evidence.forClaim}</span> המערכת לא מתייחסת לזה כטענה על המסחר שלך — זה תיאור של מה שקרה עד עכשיו, לא של היתרון שלך.</>
                    ) : (
                      <>הציון מחושב על <span className="st-n">{s.evidence.decided}</span> עסקאות שנסגרו. מ־<span className="st-n">{s.evidence.forConfirmed}</span> ומעלה הוא נחשב מבוסס; עד אז הוא עדיין זז הרבה מעסקה לעסקה.</>
                    )}
                  </p>
                )}

                <p className="st-edge-note">
                  ציון אחד שווה בדיוק כמו המשקולות שמאחוריו. כל רכיב מוצג עם המשקל שלו והציון הגולמי, כדי שאפשר יהיה לבדוק אותו — ולחלוק עליו. רכיב שאי אפשר למדוד יורד מהחישוב והמשקל שלו מתחלק בין השאר, במקום להיספר כאפס.
                </p>
              </div>

              <div className="st-panel">
                <div className="st-panel-h"><b>משמעת ובקרת סיכון</b></div>
                <div className="st-rows">
                  <Discipline
                    label="עמידה בכללים"
                    value={orDash(s.adherence.rate, v => `${nf(v * 100, 1)}%`)}
                    width={s.adherence.rate ?? 0}
                    color="#d4af37"
                    note={s.adherence.answered
                      ? `${s.adherence.followed} מתוך ${s.adherence.answered} עסקאות שנשאלו עמדו בכללים.${s.adherence.unanswered ? ` ${s.adherence.unanswered} לא נשאלו — הן לא נספרות לכאן.` : ''}`
                      : 'אף עסקה עדיין לא נשאלה על הכללים, אז אין מה למדוד.'}
                  />
                  <Discipline
                    label="עקביות"
                    value={orDash(s.edge.components[2].score, v => `${v} / 100`)}
                    width={(s.edge.components[2].score ?? 0) / 100}
                    color="#7a8fa8"
                    note={s.bestShare != null
                      ? `היום הטוב ביותר תורם ${nf(s.bestShare * 100, 1)}% מהרווח הנקי.`
                      : 'נמדד רק כשהרווח הכולל חיובי.'}
                  />
                  <Discipline
                    label="בקרת סיכון"
                    value={orDash(s.edge.components[4].score, v => `${v} / 100`)}
                    width={(s.edge.components[4].score ?? 0) / 100}
                    color="#4a7c59"
                    note={s.avgLossR != null
                      ? `הפסד ממוצע ${nf(s.avgLossR, 2)}R מול תכנון של 1.00R.`
                      : 'עוד אין עסקה מפסידה למדוד עליה.'}
                  />
                  <Discipline
                    label="שלמות היומן"
                    value={`${nf(s.completeness.overall * 100, 0)}%`}
                    width={s.completeness.overall}
                    color="rgba(212,175,55,0.5)"
                    note={`מחיר יציאה ב־${nf(s.completeness.exitPrice * 100, 0)}% מהעסקאות, תשובה על הכללים ב־${nf(s.completeness.rulesAnswer * 100, 0)}%. מה שלא תועד — אי אפשר לנתח.`}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── time & session ───────────────────────────────────── */}
          <section className="st-band st-sec" data-i="4">
            <SectionHead title="זמן וסשן" caption="מאיפה מגיע היתרון" />
            <div className="st-grid st-grid-2">
              <div className="st-panel">
                <div className="st-panel-h">
                  <b>לפי סשן</b>
                  {s.bestSession && <em>הטוב ביותר · {s.bestSession.label}</em>}
                </div>
                <GroupList groups={s.sessions} best={s.bestSession} />
              </div>
              <div className="st-panel">
                <div className="st-panel-h">
                  <b>לפי יום בשבוע</b>
                  {s.bestWeekday && <em>הטוב ביותר · {s.bestWeekday.label}</em>}
                </div>
                <GroupList groups={s.weekdays} best={s.bestWeekday} />
              </div>
            </div>
          </section>

          {/* ── execution log ────────────────────────────────────── */}
          <section className="st-band st-sec" data-i="5">
            <SectionHead title="יומן ביצוע" caption={`${s.recent.length} אחרונות מתוך ${s.n}`} />
            <div className="st-panel">
              <div className="st-tablewrap">
                <table className="st-table">
                  <thead>
                    <tr>
                      <th>תאריך</th><th>נכס</th><th>כיוון</th>
                      <th data-num>כניסה</th><th data-num>יציאה</th>
                      <th data-num>R מתוכנן</th><th data-num>R בפועל</th><th data-num>רווח</th>
                      <th>סשן</th><th>הטיה</th><th>כללים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recent.map(t => (
                      <tr key={t.id}>
                        {/* The cell handles alignment, the span handles the
                            number. Neither job may be given to the other: a
                            styled <td> leaves the table layout, and an
                            unwrapped "+$261.00" has its sign flipped to the
                            far side by the RTL paragraph around it. */}
                        <td style={{ color: 'rgba(255,255,255,0.45)' }}><span className="st-n">{fmtDate(t.dateISO)}</span></td>
                        <td style={{ color: '#fff', fontWeight: 900 }}>{t.symbol}</td>
                        <td data-soft style={{ color: t.direction === 'LONG' ? '#6ea87f' : '#c05d5d' }}>
                          {t.direction === 'LONG' ? 'לונג' : 'שורט'}
                        </td>
                        <td data-num style={{ color: 'rgba(255,255,255,0.62)' }}><span className="st-n">{nf(t.entry, 2)}</span></td>
                        <td data-num style={{ color: t.exit == null ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.62)' }}>
                          <span className="st-n">{orDash(t.exit, v => nf(v, 2))}</span>
                        </td>
                        <td data-num style={{ color: 'rgba(255,255,255,0.28)' }}><span className="st-n">{orDash(t.plannedR, v => nf(v, 2))}</span></td>
                        <td data-num style={{ fontWeight: 900, color: pnlColor(t.realizedR ?? 0) }}>
                          <span className="st-n">{orDash(t.realizedR, v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), 2)}R`)}</span>
                        </td>
                        <td data-num style={{ fontWeight: 900, color: pnlColor(t.pnl ?? 0) }}>
                          <span className="st-n">{orDash(t.pnl, v => money(v))}</span>
                        </td>
                        <td data-soft style={{ color: 'rgba(255,255,255,0.45)' }}>{t.session}</td>
                        <td data-soft style={{ color: t.bias === 'BULLISH' ? 'rgba(110,168,127,0.85)' : t.bias === 'BEARISH' ? 'rgba(192,93,93,0.85)' : 'rgba(255,255,255,0.4)' }}>
                          {BIAS_HE[t.bias] ?? t.bias}
                        </td>
                        {/* Three states, three renderings. "לא נשאל" is not a
                            failure and must never be painted like one. */}
                        <td data-soft style={{ color: t.followedRules === true ? 'rgba(212,175,55,0.85)' : t.followedRules === false ? 'rgba(192,93,93,0.75)' : 'rgba(255,255,255,0.28)' }}>
                          {t.followedRules === true ? 'מלא' : t.followedRules === false ? 'חריגה' : 'לא נשאל'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="st-disclaimer">
              המספרים כאן מחושבים מהעסקאות שתיעדת בלבד. מסחר כרוך בסיכון משמעותי, וציון היתרון הוא נקודת מבט אחת מיני כמה — תמיד הפעל שיקול דעת עצמאי.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Discipline({ label, value, width, color, note }: {
  label: string; value: string; width: number; color: string; note: string;
}) {
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--st-rule-in)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="st-row-k" style={{ color: 'rgba(255,255,255,0.55)', letterSpacing: '0.16em' }}>{label}</span>
        <span className="st-n" style={{ fontSize: 16, fontWeight: 900, color }}>{value}</span>
      </div>
      <div className="st-bar-track">
        <div className="st-bar-fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, width)) * 100)}%`, background: color }} />
      </div>
      <div className="st-note">{note}</div>
    </div>
  );
}
