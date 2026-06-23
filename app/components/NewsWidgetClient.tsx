'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { addIsoDays } from '../lib/dateUtils';
import type { MacroEvent, Imp, EventType } from '../lib/news';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_CURRENCIES = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD','CNY'] as const;
const ALL_IMPACTS: Imp[] = ['high','med','low','holiday'];
const ALL_TYPES: EventType[] = [
  'growth','inflation','employment','central','bonds',
  'housing','consumer','business','speeches','misc',
];

interface FilterState {
  currencies: string[];
  impacts:    Imp[];
  types:      EventType[];
}

const DEFAULTS: FilterState = {
  currencies: ['USD'],
  impacts:    ['high','med'],
  types:      [...ALL_TYPES],
};

// ─── Labels ───────────────────────────────────────────────────────────────────

const IMP_DOT: Record<Imp, string> = {
  high:    '#dc2626',
  med:     '#d4af37',
  low:     '#6b7280',
  holiday: '#5b7a99',
};
const IMP_GLOW: Record<Imp, string> = {
  high:    '0 0 5px rgba(220,38,38,.5)',
  med:     '0 0 5px rgba(212,175,55,.4)',
  low:     'none',
  holiday: 'none',
};
const IMP_LABEL: Record<Imp, string>      = { high:'גבוהה', med:'בינונית', low:'נמוכה', holiday:'לא כלכלי' };
const TYPE_LABEL: Record<EventType,string> = {
  growth:'Growth', inflation:'Inflation', employment:'Employment',
  central:'Central Bank', bonds:'Bonds', housing:'Housing',
  consumer:'Consumer Surveys', business:'Business Surveys',
  speeches:'Speeches', misc:'Misc',
};
const DAY_LABELS = ['MON','TUE','WED','THU','FRI'] as const;

// ─── Persistence helpers ──────────────────────────────────────────────────────

function lsKey(uid?: string) { return `onyx.newsFilters.${uid ?? 'guest'}`; }

function loadFilter(key: string): FilterState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULTS, types: [...ALL_TYPES] };
    const p = JSON.parse(raw) as Partial<FilterState>;
    return {
      currencies: Array.isArray(p.currencies) ? p.currencies as string[]    : DEFAULTS.currencies,
      impacts:    Array.isArray(p.impacts)    ? p.impacts    as Imp[]        : DEFAULTS.impacts,
      types:      Array.isArray(p.types)      ? p.types      as EventType[]  : [...ALL_TYPES],
    };
  } catch { return { ...DEFAULTS, types: [...ALL_TYPES] }; }
}

function saveLocal(key: string, f: FilterState) {
  try { localStorage.setItem(key, JSON.stringify(f)); } catch {}
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const arrEq = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((v,i) => [...b].sort()[i] === v);

function isCustom(f: FilterState): boolean {
  return !arrEq(f.currencies, DEFAULTS.currencies) ||
         !arrEq(f.impacts,    DEFAULTS.impacts)    ||
         !arrEq(f.types,      ALL_TYPES);
}

function buildSubtitle(f: FilterState, weekLabel: string): string {
  let cur: string;
  if (!f.currencies.length)      cur = 'No Currency';
  else if (f.currencies.length === 1) cur = f.currencies[0];
  else if (f.currencies.length === 2) cur = f.currencies.join(' / ');
  else                            cur = `${f.currencies.length} Currencies`;

  let imp: string;
  if (f.impacts.length === ALL_IMPACTS.length) imp = 'All Impact';
  else imp = f.impacts.map(i => ({ high:'High', med:'Medium', low:'Low', holiday:'Holiday' }[i])).join(', ');

  // "JUN 15 – JUN 19" → "Jun 15 – Jun 19"
  const wl = weekLabel.replace(/\b([A-Z]{3,})\b/g, m => m[0] + m.slice(1).toLowerCase());
  return `${cur} · ${imp} · ${wl}`;
}

function applyFilter(events: MacroEvent[], f: FilterState): MacroEvent[] {
  return events.filter(e =>
    f.currencies.includes(e.cur) &&
    f.impacts.includes(e.imp)    &&
    f.types.includes(e.type),
  );
}

function sortByTime(a: MacroEvent, b: MacroEvent): number {
  const clock = /^\d{2}:\d{2}$/;
  if (clock.test(a.t) && clock.test(b.t)) return a.t.localeCompare(b.t);
  if (clock.test(a.t)) return -1;
  if (clock.test(b.t)) return  1;
  return 0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Chip({ on, onClick, dot, children }: {
  on: boolean; onClick: () => void; dot?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-[6px] px-3 py-1.5 rounded-[4px] border font-mono
                  text-[11px] font-semibold transition-all duration-150
                  ${on
                    ? 'text-[#d4af37] bg-[rgba(212,175,55,.1)] border-[rgba(212,175,55,.5)] [box-shadow:inset_0_0_0_1px_rgba(212,175,55,.3)]'
                    : 'text-white/55 bg-[#101013] border-[#2a2a2d] hover:bg-[#1a1a1d] hover:text-white/80'}`}
    >
      {dot && (
        <span className="h-[7px] w-[7px] rounded-full shrink-0" style={{ background: dot }} />
      )}
      {children}
    </button>
  );
}

function FilterGroup({ title, allSel, onToggleAll, children }: {
  title: string; allSel: boolean; onToggleAll: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">
          {title}
        </span>
        <button
          onClick={onToggleAll}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40
                     hover:text-[#d4af37] transition-colors duration-150"
        >
          {allSel ? 'נקה' : 'הכל'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  events:    MacroEvent[];
  weekLabel: string;   // "JUN 15 – JUN 19"
  startISO:  string;   // Monday ISO date
  status:    'ok' | 'unavailable';
}

export default function NewsWidgetClient({ events, weekLabel, startISO, status }: Props) {
  const { user } = useUser();
  const key = lsKey(user?.id);

  const [filter,    setFilter]    = useState<FilterState>({ ...DEFAULTS, types: [...ALL_TYPES] });
  const [modalOpen, setModalOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load: localStorage first, then server ─────────────────────────────────

  useEffect(() => {
    setFilter(loadFilter(key));
  }, [key]);

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then((data: { prefs?: { news_filters?: FilterState } | null } | null) => {
        const saved = data?.prefs?.news_filters;
        if (!saved || typeof saved !== 'object') return;
        const f: FilterState = {
          currencies: Array.isArray(saved.currencies) ? saved.currencies as string[]   : DEFAULTS.currencies,
          impacts:    Array.isArray(saved.impacts)    ? saved.impacts    as Imp[]       : DEFAULTS.impacts,
          types:      Array.isArray(saved.types)      ? saved.types      as EventType[] : [...ALL_TYPES],
        };
        setFilter(f);
        saveLocal(key, f);
      })
      .catch(() => {});
  }, [key]);

  // ── Persist ───────────────────────────────────────────────────────────────

  const persist = useCallback((f: FilterState) => {
    saveLocal(key, f);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ news_filters: f }),
      }).catch(() => {});
    }, 600);
  }, [key]);

  const update = useCallback((f: FilterState) => {
    setFilter(f);
    persist(f);
  }, [persist]);

  // ── Modal ─────────────────────────────────────────────────────────────────

  const openModal = () => {
    setModalOpen(true);
    document.body.style.overflow = 'hidden';
  };
  const closeModal = () => {
    setModalOpen(false);
    document.body.style.overflow = '';
  };

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  // ── Toggle helpers ────────────────────────────────────────────────────────

  function toggle<T extends string>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const filtered = applyFilter(events, filter);

  const byDay = new Map<number, MacroEvent[]>();
  for (let i = 0; i < 5; i++) byDay.set(i, []);
  for (const ev of filtered) byDay.get(ev.d)?.push(ev);
  byDay.forEach(arr => arr.sort(sortByTime));

  const today   = new Date().toISOString().slice(0, 10);
  const custom  = isCustom(filter);
  const subtitle = buildSubtitle(filter, weekLabel);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Section header ──────────────────────────────────────────────── */}
      <div className="flex items-end justify-between mb-[30px] pb-5 border-b border-[#1c1c1e]">

        {/* Left: index + filter btn */}
        <div className="flex items-center gap-4">
          <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">03</span>
          <button
            onClick={openModal}
            className={`flex items-center gap-1.5 px-3 py-[6px] rounded-[4px] border
                        font-mono text-[11px] uppercase tracking-[0.14em]
                        transition-all duration-200
                        ${custom
                          ? 'border-[#d4af37]/50 text-[#d4af37] bg-[rgba(212,175,55,.08)] [box-shadow:0_0_14px_rgba(212,175,55,.15)]'
                          : 'border-[#2a2a2d] text-white/55 bg-[#101013] hover:bg-[#1a1a1d] hover:text-white/80'}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 5 21 5 14 13 14 19 10 21 10 13" />
            </svg>
            סינון
            {custom && (
              <span className="flex items-center justify-center w-[17px] h-[17px] rounded-full
                               bg-[#d4af37] text-black text-[9px] font-black leading-none">
                {filter.currencies.length}
              </span>
            )}
          </button>
        </div>

        {/* Right: title + live subtitle */}
        <div className="text-right" dir="rtl">
          <h2 className="font-serif text-[26px] font-bold text-white leading-none">יומן מאקרו</h2>
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/45 mt-2">
            {subtitle}
          </p>
        </div>
      </div>

      {/* ── Feed unavailable notice ─────────────────────────────────────── */}
      {status === 'unavailable' && (
        <div className="flex items-center gap-2.5 mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80 [box-shadow:0_0_5px_rgba(245,158,11,.5)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            Feed unavailable — showing cached data
          </span>
        </div>
      )}

      {/* ── Calendar grid ───────────────────────────────────────────────── */}
      <div className="max-[880px]:overflow-x-auto">
        <div className="grid grid-cols-5 gap-[14px] items-start max-[880px]:min-w-[580px]">
          {([0,1,2,3,4] as const).map(d => {
            const dayISO  = addIsoDays(startISO, d);
            const isToday = dayISO === today;
            const dayEvs  = byDay.get(d) ?? [];
            const dt      = new Date(`${dayISO}T12:00:00Z`);
            const mon     = dt.toLocaleString('en-US', { month:'short', timeZone:'UTC' }).toUpperCase();
            const shortDate = `${mon} ${dt.getUTCDate()}`;

            return (
              <div key={d}
                className={`rounded-[5px] overflow-hidden border bg-[#0d0d0f]
                            ${isToday ? 'border-[#d4af37]/50' : 'border-[#1c1c1e]'}`}
              >
                {/* Day header */}
                <div className={`px-3 py-2.5 border-b border-[#1c1c1e]
                                 ${isToday ? 'bg-[rgba(212,175,55,.06)]' : ''}`}>
                  <div className={`font-mono text-[11px] font-bold tracking-[0.22em]
                                   ${isToday ? 'text-[#d4af37]' : 'text-white/55'}`}>
                    {DAY_LABELS[d]}
                  </div>
                  <div className={`font-mono text-[10px] mt-0.5
                                   ${isToday ? 'text-[#d4af37]/60' : 'text-white/25'}`}>
                    {shortDate}
                  </div>
                </div>

                {/* Events */}
                <div className="flex flex-col">
                  {dayEvs.length === 0 ? (
                    <div className="flex items-center justify-center py-7">
                      <span className="font-mono text-[14px] text-white/15">—</span>
                    </div>
                  ) : dayEvs.map((ev, i) => (
                    <div key={i} className="px-3 py-2.5 border-b border-[#1c1c1e] last:border-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background: IMP_DOT[ev.imp], boxShadow: IMP_GLOW[ev.imp] }} />
                        <span className="font-mono text-[10px] font-bold text-white/65 tabular-nums">
                          {ev.t}
                        </span>
                        <span className="ms-auto font-mono text-[9px] text-white/25">{ev.cur}</span>
                      </div>
                      <span className="block font-mono text-[10px] font-bold uppercase
                                       tracking-[0.07em] text-white/80 leading-snug">
                        {ev.title}
                      </span>
                      {(ev.f || ev.p) && (
                        <div className="flex gap-3 mt-1">
                          {ev.f && (
                            <span className="font-mono text-[9px] text-white/35">
                              F <span className="text-white/60">{ev.f}</span>
                            </span>
                          )}
                          {ev.p && (
                            <span className="font-mono text-[9px] text-white/25">
                              P <span className="text-white/45">{ev.p}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Filter modal ────────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center max-[880px]:items-end"
          style={{ background: 'rgba(0,0,0,.72)', backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            className="relative w-full max-w-[580px] mx-auto max-h-[86vh] flex flex-col
                       bg-[#0d0d0f] border border-[#2a2a2d] rounded-[7px]
                       max-[880px]:rounded-[16px_16px_0_0] overflow-hidden"
            style={{ animation: 'news-modal-in 220ms cubic-bezier(0.16,1,0.3,1) both' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1c1c1e] shrink-0">
              <div>
                <div className="font-serif text-[18px] font-bold text-white">סינון חדשות</div>
                <div className="font-mono text-[10px] text-white/40 tracking-[0.18em] uppercase mt-0.5">
                  Economic Calendar Filters
                </div>
              </div>
              <button
                onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center text-white/40
                           hover:text-white transition-colors duration-150 rounded"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">

              {/* Group 1 — Impact */}
              <FilterGroup
                title="רמת השפעה"
                allSel={ALL_IMPACTS.every(v => filter.impacts.includes(v))}
                onToggleAll={() => {
                  const allSel = ALL_IMPACTS.every(v => filter.impacts.includes(v));
                  update({ ...filter, impacts: allSel ? [] : [...ALL_IMPACTS] });
                }}
              >
                {ALL_IMPACTS.map(imp => (
                  <Chip key={imp} on={filter.impacts.includes(imp)} dot={IMP_DOT[imp]}
                    onClick={() => update({ ...filter, impacts: toggle(filter.impacts, imp) })}>
                    {IMP_LABEL[imp]}
                  </Chip>
                ))}
              </FilterGroup>

              {/* Group 2 — Currencies */}
              <FilterGroup
                title="מטבעות"
                allSel={ALL_CURRENCIES.every(v => filter.currencies.includes(v))}
                onToggleAll={() => {
                  const allSel = ALL_CURRENCIES.every(v => filter.currencies.includes(v as string));
                  update({ ...filter, currencies: allSel ? [] : [...ALL_CURRENCIES] });
                }}
              >
                {ALL_CURRENCIES.map(cur => (
                  <Chip key={cur} on={filter.currencies.includes(cur)}
                    onClick={() => update({ ...filter, currencies: toggle(filter.currencies, cur) })}>
                    {cur}
                  </Chip>
                ))}
              </FilterGroup>

              {/* Group 3 — Event type */}
              <FilterGroup
                title="סוג אירוע"
                allSel={ALL_TYPES.every(v => filter.types.includes(v))}
                onToggleAll={() => {
                  const allSel = ALL_TYPES.every(v => filter.types.includes(v));
                  update({ ...filter, types: allSel ? [] : [...ALL_TYPES] });
                }}
              >
                {ALL_TYPES.map(type => (
                  <Chip key={type} on={filter.types.includes(type)}
                    onClick={() => update({ ...filter, types: toggle(filter.types, type) })}>
                    {TYPE_LABEL[type]}
                  </Chip>
                ))}
              </FilterGroup>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-6 py-4 border-t border-[#1c1c1e] shrink-0"
              style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
            >
              <span className="font-mono text-[11px] text-white/45">
                מציג {filtered.length} אירועים
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => update({ ...DEFAULTS, types: [...ALL_TYPES] })}
                  className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em]
                             text-white/55 hover:text-white/85 transition-colors duration-150"
                >
                  איפוס
                </button>
                <button
                  onClick={closeModal}
                  className="px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em]
                             bg-[#d4af37] text-black rounded-[4px]
                             [box-shadow:0_0_18px_rgba(212,175,55,.35)]
                             hover:[box-shadow:0_0_28px_rgba(212,175,55,.55)]
                             transition-shadow duration-200"
                >
                  סיום
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes news-modal-in {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @media (max-width:880px) {
          @keyframes news-modal-in {
            from { opacity:0; transform:translateY(100%); }
            to   { opacity:1; transform:translateY(0); }
          }
        }
      `}</style>
    </>
  );
}
