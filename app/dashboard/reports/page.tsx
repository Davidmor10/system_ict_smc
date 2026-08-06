'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import type { MacroEvent } from '../../lib/ai/macroCalendar';

// ── Palette (mirrors the rest of /dashboard/*) ───────────────────────────────
const GOLD = '#d4af37';
const GOLD_SOFT = '#e6c665';
const SURFACE = '#0d0d0f';
const RAISED = '#141416';
const BORDER = '#1c1c1e';
const BORDER_STRONG = '#2a2a2d';
const BULL = '#6fa580';
const BEAR = '#c98080';
const WASH_GOLD = 'radial-gradient(60% 60% at 50% 40%, rgba(212,175,55,0.07), transparent 60%)';

// Currency chips — includes JPY/AUD/NZD/CAD/CHF even though the default filter
// is USD-only, so a trader who wants to peek at DXY-related crosses can.
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'] as const;

const M_HE = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const M_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'YYYY-MM-DD' → 'day-of-week, DD Mon'. Built directly from the string parts
    (no Date round-trip) so the label can't drift between server and client. */
function fmtDay(iso: string, en: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return en
    ? `${DOW_EN[dow]}, ${M_EN[m - 1]} ${d}`
    : `${DOW_HE[dow]}, ${d} ב${M_HE[m - 1]}`;
}

function isPastOrToday(day: string, today: string): boolean { return day <= today; }

/** Best-effort numeric parse of the feed's forecast/previous/actual strings.
    Handles trailing '%', 'K', 'M', 'B', and leading signs. Returns null when
    the value clearly isn't a number ("Vote: Hold", "Testimony", etc.). */
function parseNum(v?: string): number | null {
  if (!v) return null;
  const s = v.replace(/,/g, '').trim();
  const m = /^(-?\d+(?:\.\d+)?)([KMB%])?$/.exec(s);
  if (!m) return null;
  let n = Number(m[1]);
  const suf = m[2];
  if (suf === 'K') n *= 1_000;
  else if (suf === 'M') n *= 1_000_000;
  else if (suf === 'B') n *= 1_000_000_000;
  return n;
}

/** Result classification for a released event — vs. its forecast if a forecast
    exists, otherwise vs. the previous print. Returns null when either side is
    non-numeric (which is fine — plenty of Fed events are qualitative). */
function beatType(e: MacroEvent): 'beat' | 'miss' | 'inline' | null {
  const actual = parseNum(e.actual);
  if (actual == null) return null;
  const ref = parseNum(e.forecast) ?? parseNum(e.previous);
  if (ref == null) return null;
  const diff = actual - ref;
  const scale = Math.max(Math.abs(ref), 0.01);
  const pct = Math.abs(diff) / scale;
  if (pct < 0.005) return 'inline';    // <0.5% off — call it in-line
  return diff > 0 ? 'beat' : 'miss';
}

interface Filters {
  currency: string;   // 'ALL' | 'USD' | 'EUR' | …
  impact: 'high' | 'all';
  side: 'all' | 'past' | 'upcoming';
}

export default function ReportsPage() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [events, setEvents] = useState<MacroEvent[] | null>(null);
  const [today, setToday] = useState<string>('');
  const [loadError, setLoadError] = useState(false);
  const [filters, setFilters] = useState<Filters>({ currency: 'USD', impact: 'high', side: 'all' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/macro/journal', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(j => {
        if (cancelled) return;
        setEvents(Array.isArray(j.events) ? j.events : []);
        setToday(typeof j.today === 'string' ? j.today : '');
      })
      .catch(() => { if (!cancelled) { setLoadError(true); setEvents([]); } });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter(e => {
      if (filters.currency !== 'ALL' && e.currency !== filters.currency) return false;
      if (filters.impact === 'high' && e.impact !== 'High') return false;
      if (filters.side === 'past' && !isPastOrToday(e.dateIsrael, today)) return false;
      if (filters.side === 'upcoming' && isPastOrToday(e.dateIsrael, today) && e.dateIsrael !== today) return false;
      return true;
    });
  }, [events, filters, today]);

  // Group by day (Israel time). Days come pre-sorted from the feed.
  const grouped = useMemo(() => {
    const byDay = new Map<string, MacroEvent[]>();
    for (const e of filtered) {
      const list = byDay.get(e.dateIsrael) ?? [];
      list.push(e);
      byDay.set(e.dateIsrael, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Summary strip — released beats vs misses, plus how many upcoming.
  const stats = useMemo(() => {
    let beats = 0, misses = 0, inline = 0, released = 0, upcoming = 0;
    for (const e of filtered) {
      const past = isPastOrToday(e.dateIsrael, today);
      if (past && e.actual) {
        released += 1;
        const b = beatType(e);
        if (b === 'beat') beats += 1;
        else if (b === 'miss') misses += 1;
        else if (b === 'inline') inline += 1;
      } else if (!past || (past && !e.actual)) {
        upcoming += 1;
      }
    }
    return { beats, misses, inline, released, upcoming };
  }, [filtered, today]);

  const s = STR(en);

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      {/* ── Topbar ── */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-5 px-6 sm:px-12 h-16 bg-[rgba(5,5,5,.82)] backdrop-blur-md border-b max-[880px]:hidden" style={{ borderColor: BORDER }}>
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
          {en ? <>Reports <span className="text-white/20 mx-1.5">/</span> Macro calendar</> : <>דוחות <span className="text-white/20 mx-1.5">/</span> יומן מאקרו</>}
        </span>
        <span className="font-mono text-[11px] font-semibold text-white/35" dir="ltr">
          {en ? 'Source: FairEconomy (ForexFactory feed) · Israel time' : 'מקור: FairEconomy (פיד ForexFactory) · שעון ישראל'}
        </span>
      </div>

      <div className="max-w-[1200px] mx-auto px-12 py-14 pb-32 max-[880px]:px-5 max-[880px]:py-7 max-[880px]:pb-24 flex flex-col gap-10 max-[880px]:gap-7">

        {/* ── Hero ── */}
        <div className="relative flex items-end justify-between gap-6 flex-wrap pt-2 pb-1 overflow-hidden">
          <div className="absolute pointer-events-none z-0" style={{ inset: '-60px -40px auto -40px', height: 280, backgroundImage: WASH_GOLD }} />
          <div className="relative z-[1] flex flex-col gap-3.5 max-w-[640px]">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>◈ {s.eyebrow}</span>
            <h1 className="m-0" style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.2rem, 5vw, 3.6rem)', fontWeight: 800, color: '#fff', lineHeight: 1.05, textShadow: '0 0 60px rgba(212,175,55,0.35)' }}>
              {s.title}
            </h1>
            <p className="m-0 max-w-[520px] text-[14.5px] leading-relaxed text-[#c0c0c0]">
              {s.lede}
            </p>
          </div>
        </div>

        {/* ── Overview strip ── */}
        <div className="grid grid-cols-4 max-[880px]:grid-cols-2 gap-px rounded-xl overflow-hidden" style={{ background: BORDER, border: `1px solid ${BORDER}` }}>
          <StatCell k={s.statReleased} v={String(stats.released)} tone="white" />
          <StatCell k={s.statBeats}    v={String(stats.beats)}    tone="bull" />
          <StatCell k={s.statMisses}   v={String(stats.misses)}   tone="bear" />
          <StatCell k={s.statUpcoming} v={String(stats.upcoming)} tone="gold" />
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col gap-3">
          <FilterRow label={s.filterCurrency}>
            <Chip active={filters.currency === 'ALL'} onClick={() => setFilters(f => ({ ...f, currency: 'ALL' }))}>{s.all}</Chip>
            {CURRENCIES.map(c => (
              <Chip key={c} active={filters.currency === c} onClick={() => setFilters(f => ({ ...f, currency: c }))}>{c}</Chip>
            ))}
          </FilterRow>
          <FilterRow label={s.filterImpact}>
            <Chip active={filters.impact === 'high'} onClick={() => setFilters(f => ({ ...f, impact: 'high' }))}>{s.highOnly}</Chip>
            <Chip active={filters.impact === 'all'}  onClick={() => setFilters(f => ({ ...f, impact: 'all' }))}>{s.allImpacts}</Chip>
          </FilterRow>
          <FilterRow label={s.filterWhen}>
            <Chip active={filters.side === 'all'}      onClick={() => setFilters(f => ({ ...f, side: 'all' }))}>{s.allWhen}</Chip>
            <Chip active={filters.side === 'past'}     onClick={() => setFilters(f => ({ ...f, side: 'past' }))}>{s.past}</Chip>
            <Chip active={filters.side === 'upcoming'} onClick={() => setFilters(f => ({ ...f, side: 'upcoming' }))}>{s.upcoming}</Chip>
          </FilterRow>
        </div>

        {/* ── Timeline ── */}
        {events === null ? (
          <SkeletonList />
        ) : loadError ? (
          <EmptyPanel title={s.errorTitle} body={s.errorBody} />
        ) : grouped.length === 0 ? (
          <EmptyPanel title={s.emptyTitle} body={s.emptyBody} />
        ) : (
          <div className="flex flex-col gap-8">
            {grouped.map(([day, list]) => (
              <DayGroup key={day} day={day} today={today} events={list} en={en} />
            ))}
          </div>
        )}

        <p className="m-0 font-mono text-[11px] text-white/30 text-center">
          {en
            ? 'Feed refreshes once per Israel day. Times shown in Israel local time. Actuals appear once the release is published.'
            : 'הפיד מתעדכן פעם ביום ישראלי. השעות מוצגות בשעון ישראל. הערך בפועל מופיע לאחר פרסום הדוח.'}
        </p>
      </div>
    </div>
  );
}

// ── Day group ────────────────────────────────────────────────────────────────
function DayGroup({ day, today, events, en }: { day: string; today: string; events: MacroEvent[]; en: boolean }) {
  const isToday = day === today;
  const past = day < today;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="m-0" style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 700, color: isToday ? GOLD : '#fff', letterSpacing: '-0.005em' }}>
          {fmtDay(day, en)}
        </h2>
        {isToday && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
            {en ? '· Today' : '· היום'}
          </span>
        )}
        {past && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            {en ? '· Released' : '· פורסם'}
          </span>
        )}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        {/* Column header (hidden on narrow screens where each row stacks) */}
        <div className="grid gap-3 px-5 py-2.5 text-white/40 max-[720px]:hidden" style={{ gridTemplateColumns: '76px 56px 1fr 92px 92px 92px 24px', background: '#0a0a0c', borderBottom: `1px solid ${BORDER}` }}>
          <ColH>{en ? 'Time' : 'שעה'}</ColH>
          <ColH>{en ? 'CCY' : 'מטבע'}</ColH>
          <ColH>{en ? 'Event' : 'אירוע'}</ColH>
          <ColH align="end">{en ? 'Actual' : 'בפועל'}</ColH>
          <ColH align="end">{en ? 'Forecast' : 'צפי'}</ColH>
          <ColH align="end">{en ? 'Previous' : 'קודם'}</ColH>
          <span />
        </div>

        <div className="flex flex-col">
          {events.map((e, i) => <EventRow key={`${day}-${i}`} e={e} today={today} en={en} />)}
        </div>
      </div>
    </section>
  );
}

function ColH({ children, align }: { children: React.ReactNode; align?: 'end' }) {
  return <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ textAlign: align === 'end' ? 'end' : 'start' }}>{children}</span>;
}

// ── Event row ────────────────────────────────────────────────────────────────
function EventRow({ e, today, en }: { e: MacroEvent; today: string; en: boolean }) {
  const past = e.dateIsrael <= today;
  const released = past && !!e.actual;
  const impactColor = e.impact === 'High' ? BEAR : e.impact === 'Medium' ? GOLD_SOFT : e.impact === 'Holiday' ? '#7a8fa8' : 'rgba(255,255,255,0.35)';
  const b = released ? beatType(e) : null;
  const actualTone = b === 'beat' ? BULL : b === 'miss' ? BEAR : b === 'inline' ? GOLD_SOFT : 'rgba(255,255,255,0.9)';

  return (
    <div
      className="grid gap-3 items-center px-5 py-3.5 border-t max-[720px]:grid-cols-1 max-[720px]:gap-1.5"
      style={{
        gridTemplateColumns: '76px 56px 1fr 92px 92px 92px 24px',
        borderColor: BORDER,
        background: released ? 'transparent' : e.dateIsrael === today ? 'rgba(212,175,55,0.03)' : 'transparent',
      }}
    >
      {/* Time */}
      <div className="max-[720px]:flex max-[720px]:items-center max-[720px]:gap-2">
        <span className="font-mono text-[12px] font-bold text-white/80" dir="ltr">
          {e.timeIsrael || (en ? 'All day' : 'כל היום')}
        </span>
        <span className="hidden max-[720px]:inline-block w-1.5 h-1.5 rounded-full ms-2" style={{ background: impactColor }} title={e.impact} />
      </div>

      {/* Currency */}
      <div className="flex items-center gap-1.5 max-[720px]:hidden">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: impactColor }} title={e.impact} />
        <span className="font-mono text-[12px] font-bold text-white/70">{e.currency || '—'}</span>
      </div>

      {/* Title */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[14px] text-white leading-snug truncate">{e.title}</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: impactColor }}>
          {e.currency ? `${e.currency} · ` : ''}{impactLabel(e.impact, en)}
        </span>
      </div>

      {/* Actual */}
      <ValCell label={en ? 'Actual' : 'בפועל'} value={e.actual} tone={actualTone} align="end" placeholder={released ? '—' : (en ? '—' : '—')} bold />

      {/* Forecast */}
      <ValCell label={en ? 'Forecast' : 'צפי'} value={e.forecast} align="end" placeholder="—" />

      {/* Previous */}
      <ValCell label={en ? 'Previous' : 'קודם'} value={e.previous} align="end" placeholder="—" />

      {/* Beat/miss badge on desktop */}
      <div className="flex justify-end max-[720px]:hidden">
        {b === 'beat'   && <span title={en ? 'Beat' : 'עקף'} className="w-2 h-2 rounded-full" style={{ background: BULL, boxShadow: `0 0 8px ${BULL}80` }} />}
        {b === 'miss'   && <span title={en ? 'Miss' : 'החמיץ'} className="w-2 h-2 rounded-full" style={{ background: BEAR, boxShadow: `0 0 8px ${BEAR}80` }} />}
        {b === 'inline' && <span title={en ? 'In-line' : 'תואם'} className="w-2 h-2 rounded-full" style={{ background: GOLD_SOFT }} />}
      </div>
    </div>
  );
}

function ValCell({ label, value, tone, align, placeholder = '—', bold = false }: { label: string; value?: string; tone?: string; align?: 'end'; placeholder?: string; bold?: boolean }) {
  const shown = value && value.trim() ? value : placeholder;
  return (
    <div className="flex flex-col gap-0.5 max-[720px]:flex-row max-[720px]:items-baseline max-[720px]:gap-2">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/35 hidden max-[720px]:inline">{label}</span>
      <span
        className="font-mono text-[13px] tabular-nums"
        style={{
          color: tone ?? 'rgba(255,255,255,0.75)',
          fontWeight: bold ? 800 : 600,
          textAlign: align === 'end' ? 'end' : 'start',
          direction: 'ltr',
        }}
      >
        {shown}
      </span>
    </div>
  );
}

// ── Filter primitives ───────────────────────────────────────────────────────
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/40 min-w-[74px]">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3.5 py-1.5 rounded-full border font-mono text-[11px] font-bold tracking-[0.1em] transition-colors"
      style={{
        borderColor: active ? 'rgba(212,175,55,0.45)' : BORDER,
        color: active ? '#fff' : 'rgba(255,255,255,0.55)',
        background: active ? 'rgba(212,175,55,0.08)' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

// ── Summary cell ─────────────────────────────────────────────────────────────
function StatCell({ k, v, tone }: { k: string; v: string; tone: 'white' | 'gold' | 'bull' | 'bear' }) {
  const color = tone === 'gold' ? GOLD : tone === 'bull' ? BULL : tone === 'bear' ? BEAR : '#fff';
  return (
    <div className="flex flex-col gap-1.5 px-6 py-5" style={{ background: SURFACE }}>
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{k}</span>
      <span style={{ color, fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{v}</span>
    </div>
  );
}

// ── Empty / skeleton / helpers ───────────────────────────────────────────────
function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16 px-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <span style={{ fontFamily: 'var(--serif)', fontSize: 30, color: GOLD, textShadow: '0 0 30px rgba(212,175,55,0.35)', lineHeight: 1 }}>◈</span>
      <h3 className="m-0" style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 700, color: '#fff' }}>{title}</h3>
      <p className="m-0 max-w-[420px] text-[13.5px] leading-relaxed text-[#c0c0c0]">{body}</p>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex flex-col gap-3">
          <div className="h-6 w-40 rounded" style={{ background: RAISED }} />
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            {[0, 1, 2].map(j => (
              <div key={j} className="h-14 border-t" style={{ borderColor: BORDER, background: SURFACE }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function impactLabel(impact: MacroEvent['impact'], en: boolean): string {
  if (en) return impact === 'Holiday' ? 'Bank holiday' : `${impact} impact`;
  if (impact === 'High')    return 'השפעה גבוהה';
  if (impact === 'Medium')  return 'השפעה בינונית';
  if (impact === 'Holiday') return 'חג בנקאי';
  return 'השפעה נמוכה';
}

function STR(en: boolean) {
  return en
    ? {
        eyebrow: 'Macro reports',
        title: 'Economic calendar',
        lede: 'Every high-impact release, side by side — what the market expected, what actually printed, and where the two disagreed. Data refreshes once per day and covers the past, current, and upcoming week.',
        statReleased: 'Released',
        statBeats: 'Beat forecast',
        statMisses: 'Missed forecast',
        statUpcoming: 'Upcoming',
        filterCurrency: 'Currency',
        filterImpact: 'Impact',
        filterWhen: 'Window',
        all: 'All',
        highOnly: 'High only',
        allImpacts: 'All impacts',
        allWhen: 'All',
        past: 'Released',
        upcoming: 'Upcoming',
        errorTitle: 'Feed unavailable',
        errorBody: 'The macro feed could not be reached. Try again in a minute — this page never invents data.',
        emptyTitle: 'Nothing matches these filters',
        emptyBody: 'Widen the currency or impact filter above to see more releases in the 3-week window.',
      }
    : {
        eyebrow: 'יומן דוחות מאקרו',
        title: 'לוח הדוחות',
        lede: 'כל דוח בעל השפעה גבוהה — צד לצד: מה השוק ציפה, מה יצא בפועל, ואיפה השניים לא הסכימו. הנתונים מתעדכנים פעם ביום וכוללים את השבוע שעבר, הנוכחי, והבא.',
        statReleased: 'פורסמו',
        statBeats: 'עקפו צפי',
        statMisses: 'החמיצו צפי',
        statUpcoming: 'צפויים',
        filterCurrency: 'מטבע',
        filterImpact: 'השפעה',
        filterWhen: 'טווח',
        all: 'הכל',
        highOnly: 'גבוהה בלבד',
        allImpacts: 'כל ההשפעות',
        allWhen: 'הכל',
        past: 'פורסמו',
        upcoming: 'צפויים',
        errorTitle: 'הפיד לא זמין',
        errorBody: 'לא הצלחנו להגיע לפיד המאקרו. נסה שוב עוד רגע — הדף הזה לא ממציא נתונים.',
        emptyTitle: 'אין תוצאות לסינון הזה',
        emptyBody: 'הרחב את סינון המטבע או ההשפעה למעלה כדי לראות עוד דוחות בטווח של שלושה שבועות.',
      };
}
