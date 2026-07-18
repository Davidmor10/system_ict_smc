'use client';

import './fd.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { loadTrades, hydrateTradesFromCloud, computeStats } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { hydrateList, commitList } from '../lib/sync/collections';
import { SESS, getSessionStatus, type SessionStatus } from '../lib/sessions';
import { translateMacroTitle } from '../lib/ai/macroTitles';
import PositionCalculator from './PositionCalculator';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/** Mirrors app/lib/ai/macroCalendar.ts's MacroEvent — kept local (not imported)
    so this client component never pulls in that module's server-only fetch/
    Supabase-caching code, same convention DashboardView.tsx already follows. */
type MacroImpact = 'High' | 'Medium' | 'Low' | 'Holiday';
interface MacroEventLite {
  title: string;
  currency: string;
  impact: MacroImpact;
  dateIsrael: string;
  timeIsrael: string;
}

interface Task { id: string; text: string; done: boolean; updatedAt?: number; deleted?: boolean; }

const TASKS_KEY = 'onyx_free_tasks_v1';

const IMPACT_META: Record<MacroImpact, { he: string; color: string }> = {
  High:    { he: 'גבוהה',   color: '#dc2626' },
  Medium:  { he: 'בינונית', color: '#d4af37' },
  Low:     { he: 'נמוכה',   color: '#c0c0c0' },
  Holiday: { he: 'חג',      color: '#7a8fa8' },
};

const WEEKDAY_HE = ['יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי'];
const M_HE_PREFIXED = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];
const D_HE_FULL = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

/* ── Date helpers — pure, Israel calendar day arithmetic without a Date-object
   timezone round-trip (only israelTodayISO() talks to Intl; everything after
   that is plain YYYY-MM-DD math via UTC-noon Date objects, so it never drifts
   a day from a browser's local timezone). ── */
function israelTodayISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function weekdayIdxOfISO(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun..6=Sat
}
function mondayOfWeekISO(iso: string): string {
  const dow = weekdayIdxOfISO(iso);
  return addDaysISO(iso, dow === 0 ? -6 : 1 - dow);
}
function fullHebrewDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = D_HE_FULL[weekdayIdxOfISO(iso)];
  return `${weekday}, ${d} ${M_HE_PREFIXED[m - 1]} ${y}`;
}

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  if (hour >= 17 && hour < 21) return 'ערב טוב';
  return 'לילה טוב';
}

function fmtHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** Day-over-day % change; null when there's no honest prior value to compare
    (mirrors the same "null when nothing to compare" rule the rest of the
    dashboard already uses for week/month deltas). */
function pctDelta(cur: number, prev: number): number | null {
  return (prev === 0 || !Number.isFinite(prev)) ? null : ((cur - prev) / Math.abs(prev)) * 100;
}

/** Longest current run of the same result (WIN or LOSS) counting back from the
    most recently logged decided trade. Null `kind` when there's no decided
    trade yet. */
function computeStreak(trades: TradeEntry[]): { count: number; kind: 'WIN' | 'LOSS' | null } {
  const closed = [...trades]
    .filter(t => t.result === 'WIN' || t.result === 'LOSS')
    .sort((a, b) => (b.dateISO + b.time).localeCompare(a.dateISO + a.time));
  if (closed.length === 0) return { count: 0, kind: null };
  const kind = closed[0].result as 'WIN' | 'LOSS';
  let count = 0;
  for (const t of closed) {
    if (t.result === kind) count++; else break;
  }
  return { count, kind };
}

function SectionHead({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="fd-sec-head">
      <div className="fd-sec-titlewrap">
        <h2 className="fd-sec-title">{title}</h2>
        {sub && <p className="fd-sec-sub">{sub}</p>}
      </div>
      <span className="fd-sec-num">{String(n).padStart(2, '0')}</span>
    </div>
  );
}

export default function FreeDashboardView() {
  const [clock, setClock] = useState('00:00:00');
  const [status, setStatus] = useState<SessionStatus>(() => ({ kind: 'next', idx: 0, secondsLeft: 0 }));
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [macroWeek, setMacroWeek] = useState<MacroEventLite[] | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskInput, setTaskInput] = useState('');

  const todayISOStr = israelTodayISO();

  /* ── Ticking clock + live session status (Israel time) ────────────── */
  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false }));
      setStatus(getSessionStatus());
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  /* ── Close the session dropdown on an outside click ────────────────── */
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  /* ── Trades (local cache, then reconciled with the cloud) ──────────── */
  useEffect(() => {
    setTrades(loadTrades());
    hydrateTradesFromCloud().then(setTrades).catch(() => {});
  }, []);

  /* ── This week's macro calendar (never invented — [] on failure) ───── */
  useEffect(() => {
    fetch('/api/macro?scope=week')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMacroWeek(Array.isArray(d?.events) ? d.events : []))
      .catch(() => setMacroWeek([]));
  }, []);

  /* ── Tasks — synced like rules/setups (cache-first, cloud reconciled) ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      if (raw) setTasks((JSON.parse(raw) as Task[]).filter(t => !t.deleted));
    } catch {}
    hydrateList<Task>('free_tasks', TASKS_KEY).then(setTasks).catch(() => {});
  }, []);

  function persistTasks(next: Task[]) {
    setTasks(next);
    void commitList<Task>('free_tasks', TASKS_KEY, next);
  }
  function addTask(e: React.FormEvent) {
    e.preventDefault();
    const text = taskInput.trim();
    if (!text) return;
    persistTasks([{ id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, done: false }, ...tasks]);
    setTaskInput('');
  }
  function toggleTask(id: string) { persistTasks(tasks.map(t => (t.id === id ? { ...t, done: !t.done } : t))); }
  function removeTask(id: string) { persistTasks(tasks.filter(t => t.id !== id)); }

  /* ── Performance — today vs yesterday, real trades only ─────────────── */
  const yesterdayISOStr = addDaysISO(todayISOStr, -1);
  const todayTrades = useMemo(() => trades.filter(t => t.dateISO === todayISOStr), [trades, todayISOStr]);
  const yesterdayTrades = useMemo(() => trades.filter(t => t.dateISO === yesterdayISOStr), [trades, yesterdayISOStr]);
  const todayStats = useMemo(() => computeStats(todayTrades), [todayTrades]);
  const yesterdayStats = useMemo(() => computeStats(yesterdayTrades), [yesterdayTrades]);
  const dailyDelta = pctDelta(todayStats.totalPnL, yesterdayStats.totalPnL);
  const streak = useMemo(() => computeStreak(trades), [trades]);

  /* ── Macro — grouped by weekday (Mon-Fri of the current Israel week) ── */
  const macroByDate = useMemo(() => {
    const map = new Map<string, MacroEventLite[]>();
    for (const e of macroWeek ?? []) {
      const arr = map.get(e.dateIsrael);
      if (arr) arr.push(e); else map.set(e.dateIsrael, [e]);
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.timeIsrael || '').localeCompare(b.timeIsrael || ''));
    return map;
  }, [macroWeek]);
  const mondayISOStr = mondayOfWeekISO(todayISOStr);
  const weekDates = useMemo(() => Array.from({ length: 5 }, (_, i) => addDaysISO(mondayISOStr, i)), [mondayISOStr]);

  const focusedIdx = pinnedIdx ?? status.idx;
  const now = new Date();
  const hourNow = now.getHours(); // browser-local is fine here — greeting granularity only

  return (
    <div className="fd-root flex-1 overflow-y-auto" dir="rtl">
      {/* ── Sticky header ── */}
      <header className="fd-header">
        <div className="fd-brand">
          <span className="fd-brand-name">Onyx</span>
          <span className="fd-brand-kicker">מסחר</span>
        </div>

        <div className="fd-header-center">
          <span className="fd-greeting">{greetingFor(hourNow)}</span>
          <span className="fd-today">{fullHebrewDate(todayISOStr)}</span>
        </div>

        <div className="fd-header-right">
          <nav className="fd-nav">
            <Link href="/dashboard" className="fd-nav-link active">מרכז השליטה</Link>
            <Link href="/dashboard/ai-analytics" className="fd-nav-link">אנליטיקס שוק</Link>
            <Link href="/dashboard/journal" className="fd-nav-link">יומן מסחר</Link>
          </nav>

          <div className="fd-session-wrap" ref={menuRef}>
            <button className="fd-session-btn" onClick={() => setMenuOpen(v => !v)}>
              <span className={`fd-session-dot${status.kind === 'live' ? ' live' : ''}`} />
              <span className="fd-session-label">{SESS[focusedIdx].he}</span>
              <span className="fd-session-chev">▾</span>
            </button>
            {menuOpen && (
              <div className="fd-session-menu">
                <button
                  className={`fd-session-item${pinnedIdx === null ? ' active' : ''}`}
                  onClick={() => { setPinnedIdx(null); setMenuOpen(false); }}
                >
                  <span>אוטומטי</span>
                  <span className="fd-session-item-hint">{status.kind === 'live' ? 'פעיל כעת' : 'הבא'}</span>
                </button>
                {SESS.map((s, i) => (
                  <button
                    key={s.key}
                    className={`fd-session-item${pinnedIdx === i ? ' active' : ''}`}
                    onClick={() => { setPinnedIdx(i); setMenuOpen(false); }}
                  >
                    <span>{s.he}</span>
                    <span className="fd-session-item-hint" dir="ltr">{s.start}:00–{s.end}:00</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="fd-plan-chip">חינמי</span>

          {CLERK_ENABLED && (
            <div className="fd-avatar">
              <UserButton />
            </div>
          )}
        </div>
      </header>

      <div className="fd-shell">

        {/* ══════════ 01 · מרכז השליטה ══════════ */}
        <section>
          <SectionHead n={1} title="מרכז השליטה" sub="שעת המסחר, בזמן אמת" />
          <div className="fd-panel fd-panel-gold">
            <div className="fd-hero-top">
              <div>
                <span className="fd-clock" dir="ltr">{clock}</span>
                <span className="fd-clock-cap">שעון ישראל</span>
              </div>
              <div className="fd-signal">
                <span className="fd-signal-badge">
                  <span className={`fd-session-dot${status.kind === 'live' ? ' live' : ''}`} />
                  <span className="fd-signal-text">
                    {status.kind === 'live' ? `${SESS[status.idx].he} · פעיל כעת` : `הסשן הבא: ${SESS[status.idx].he}`}
                  </span>
                </span>
                <span className="fd-countdown">
                  {status.kind === 'live' ? 'מסתיים בעוד ' : 'מתחיל בעוד '}
                  <b dir="ltr">{fmtHMS(status.secondsLeft)}</b>
                </span>
              </div>
            </div>
            <div className="fd-timeline">
              {SESS.map((s, i) => (
                <div key={s.key} className={`fd-timeline-cell${i === focusedIdx ? ' focus' : ''}`}>
                  <span className="fd-timeline-name">{s.he}</span>
                  <span className="fd-timeline-hours" dir="ltr">{s.start}:00–{s.end}:00</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════ 02 + 03 · ביצועים + אירועי מאקרו ══════════ */}
        <div className="fd-row-02-03">
          <section>
            <SectionHead n={2} title="ביצועים" />
            <div className="fd-panel">
              <div className="fd-perf-head">
                <span className="fd-perf-head-title">סיכום המסחר היומי</span>
                <span className="fd-perf-head-date">{fullHebrewDate(todayISOStr)}</span>
              </div>
              <div className="fd-metric-grid">
                <div className="fd-metric-cell">
                  <span className="fd-metric-label">אחוז הצלחה</span>
                  <span className="fd-metric-value">{todayTrades.length ? `${todayStats.winRate.toFixed(0)}%` : '—'}</span>
                </div>
                <div className="fd-metric-cell">
                  <span className="fd-metric-label">רווח/הפסד יומי</span>
                  <span className="fd-metric-value" style={{ color: todayStats.totalPnL >= 0 ? 'var(--fd-bull)' : 'var(--fd-bear)' }}>
                    {todayTrades.length ? money(todayStats.totalPnL) : '—'}
                  </span>
                  {dailyDelta != null && (
                    <span className="fd-metric-sub">({dailyDelta >= 0 ? '+' : ''}{dailyDelta.toFixed(0)}% מול אתמול)</span>
                  )}
                </div>
                <div className="fd-metric-cell">
                  <span className="fd-metric-label">עסקאות היום</span>
                  <span className="fd-metric-value">{todayTrades.length}</span>
                </div>
                <div className="fd-metric-cell">
                  <span className="fd-metric-label">מקדם רווח</span>
                  <span className="fd-metric-value">{todayTrades.length ? (Number.isFinite(todayStats.profitFactor) ? todayStats.profitFactor.toFixed(2) : '∞') : '—'}</span>
                </div>
                <div className="fd-metric-cell full">
                  <span className="fd-metric-label" style={{ marginBottom: 0 }}>רצף נוכחי</span>
                  <span
                    className="fd-metric-value"
                    style={{ fontSize: 15, color: streak.kind === 'WIN' ? 'var(--fd-bull)' : streak.kind === 'LOSS' ? 'var(--fd-bear)' : undefined }}
                  >
                    {streak.kind == null ? '—' : `${streak.count} ${streak.kind === 'WIN' ? 'ניצחונות' : 'הפסדים'} ברצף`}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionHead n={3} title="אירועי מאקרו" sub="השבוע" />
            <div className="fd-macro-week">
              {weekDates.map((iso, i) => {
                const events = macroByDate.get(iso) ?? [];
                const isToday = iso === todayISOStr;
                return (
                  <div key={iso} className={`fd-macro-day${isToday ? ' today' : ''}`}>
                    <div className="fd-macro-day-head">
                      <span className="fd-macro-day-name">{WEEKDAY_HE[i]}</span>
                      <span className="fd-macro-day-date" dir="ltr">{iso.slice(8, 10)}/{iso.slice(5, 7)}</span>
                    </div>
                    {macroWeek == null ? (
                      <span className="fd-macro-empty">…</span>
                    ) : events.length === 0 ? (
                      <span className="fd-macro-empty">אין אירועים ביום זה</span>
                    ) : (
                      events.map((e, j) => {
                        const impact = IMPACT_META[e.impact];
                        const tr = translateMacroTitle(e.title);
                        return (
                          <div key={`${iso}-${j}`} className="fd-macro-row">
                            <span className="fd-macro-chip" style={{ color: impact.color, borderColor: impact.color + '66', background: impact.color + '22' }}>
                              {impact.he}
                            </span>
                            <span className="fd-macro-time" dir="ltr">{e.timeIsrael || '—'}</span>
                            <span className="fd-macro-title">
                              {tr.he}
                              {tr.hasTranslation && <span className="fd-macro-title-en"> ({e.title})</span>}
                            </span>
                            <span className="fd-macro-cur">{e.currency}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* ══════════ 04 · כלים ══════════ */}
        <section>
          <SectionHead n={4} title="כלים" />
          <div className="fd-tools-grid">
            <div className="fd-panel">
              <PositionCalculator />
            </div>
            <div className="fd-panel">
              <div className="fd-quick-list">
                <Link href="/dashboard/journal" className="fd-quick-link">
                  <span>תיעוד עסקה חדשה</span><span className="fd-quick-arrow">←</span>
                </Link>
                <Link href="/dashboard/ai-analytics" className="fd-quick-link">
                  <span>אנליטיקס שוק</span><span className="fd-quick-arrow">←</span>
                </Link>
                <Link href="/dashboard/journal" className="fd-quick-link">
                  <span>יומן מסחר מלא</span><span className="fd-quick-arrow">←</span>
                </Link>
                <span className="fd-quick-link disabled">
                  <span>הגדרת התראת מחיר (בקרוב)</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ 05 · משימות פתוחות ══════════ */}
        <section>
          <SectionHead n={5} title="משימות פתוחות" />
          <div className="fd-panel">
            <div className="fd-task-add-row">
              <form className="fd-task-form" onSubmit={addTask}>
                <input
                  className="fd-task-input"
                  value={taskInput}
                  onChange={e => setTaskInput(e.target.value)}
                  placeholder="הוסף משימה חדשה..."
                />
                <button type="submit" className="fd-task-add-btn">הוסף</button>
              </form>
              <span className="fd-task-count">{tasks.filter(t => !t.done).length} / {tasks.length} פתוחות</span>
            </div>

            {tasks.length === 0 ? (
              <div className="fd-task-empty">אין משימות פתוחות. הוסיפו את המשימה הראשונה שלכם להיום.</div>
            ) : (
              <div className="fd-task-list">
                {tasks.map(t => (
                  <div key={t.id} className={`fd-task-row${t.done ? ' done' : ''}`} onClick={() => toggleTask(t.id)}>
                    <span className="fd-task-box"><span className="fd-task-check">{t.done ? '✓' : ''}</span></span>
                    <span className="fd-task-text">{t.text}</span>
                    <button className="fd-task-del" onClick={e => { e.stopPropagation(); removeTask(t.id); }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ══════════ 06 · מבט קדימה (AI preview) ══════════ */}
        <div className="fd-ai-banner">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="fd-ai-banner-badge">בקרוב באוניקס</span>
            <h3 className="fd-ai-banner-title">תובנות מבוססות בינה מלאכותית</h3>
            <p className="fd-ai-banner-body">שדרוג ל-PRO או DELUXE פותח שכבת ניתוח AI על היומן שלך — תובנות אישיות, זיהוי דפוסים, דוחות שבועיים וניתוח חוזקות ונקודות לשיפור.</p>
            <div className="fd-ai-bullets">
              <span className="fd-ai-bullet">תובנות אישיות</span>
              <span className="fd-ai-bullet">זיהוי דפוסים</span>
              <span className="fd-ai-bullet">דוחות שבועיים</span>
              <span className="fd-ai-bullet">ניתוח חוזקות ושיפור</span>
            </div>
          </div>
          <div className="fd-ai-banner-side">
            <Link href="/pricing" className="fd-ai-ghost-btn">לצפייה בתוכניות</Link>
            <span className="fd-ai-banner-note">זמין כתצוגה מקדימה בלבד</span>
          </div>
        </div>

        <p className="fd-footer">נתוני הדגמה · לצרכי מחקר ולימוד בלבד. המסחר בחוזים עתידיים כרוך בסיכון משמעותי.</p>
      </div>
    </div>
  );
}
