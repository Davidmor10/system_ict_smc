'use client';

import { useMemo, useState } from 'react';
import type { TradeEntry } from '../../lib/journal';
import { plannedRR, rMultiple, tradePnL, missingAnswers } from '../../lib/journal';
import { calcWeightedExitPrice } from '../../lib/calc/trade';
import { pointValue } from '../../lib/instruments';
import { sessionLabel } from '../../lib/sessions';
import './tradeDetails.css';

/* ── Palette ───────────────────────────────────────────────────────────────
   Named here rather than pulled from Tailwind: these are the exact signal
   values the design specifies, and a token that drifts by one step turns a
   win green into a different green. */
const GOLD = '#d4af37';
const BULL = '#6fa580';
const BEAR = '#c98080';
const MUTED = 'rgba(255,255,255,.45)';
const MONO = "var(--font-geist-mono), ui-monospace, monospace";
const SERIF = "var(--font-playfair), Georgia, serif";
const SANS = "var(--font-geist-sans), system-ui, sans-serif";

const M_HEB = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const D_HEB = ['יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','יום שבת'];
const BIAS_HE: Record<string, string> = { BULLISH: 'עולה', BEARISH: 'יורד', INDECISIVE: 'ניטרלי' };

/** The grid, in one place. The header and every row read from this constant —
 *  two copies of a column list stay identical exactly until someone edits one. */
const GRID = '58px 152px 100px 100px 66px 78px 104px 1fr';

/** Money, always to two decimals. The second decimal is not detail, it is what
 *  keeps a column of figures on one vertical line. */
const money = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const price = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rTxt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}R`;

function labelDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return `${d} ב${M_HEB[m - 1]} ${y}`;
}
function weekday(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return D_HEB[new Date(y, m - 1, d).getDay()];
}

function tone(result: TradeEntry['result']) {
  if (result === 'WIN')  return { c: BULL, bg: 'rgba(74,124,89,.12)',  br: 'rgba(74,124,89,.45)' };
  if (result === 'LOSS') return { c: BEAR, bg: 'rgba(139,58,58,.12)',  br: 'rgba(139,58,58,.45)' };
  if (result === 'BE')   return { c: GOLD, bg: 'rgba(212,175,55,.1)',  br: 'rgba(212,175,55,.4)' };
  return { c: MUTED, bg: 'rgba(255,255,255,.04)', br: 'rgba(255,255,255,.16)' };
}
const RESULT_HE: Record<string, string> = { WIN: 'WIN', LOSS: 'LOSS', BE: 'BE', OPEN: 'פתוחה' };

/** Where the trade actually closed.
 *
 *  The logged exits first — those were measured. Falling back to the plan is
 *  the same assumption tradePnL already makes for a trade recorded before
 *  exits were collected, so the two never disagree on screen. An open trade
 *  has no exit at all, and says so. */
function exitPrice(t: TradeEntry): number | null {
  const measured = calcWeightedExitPrice(t.exits ?? []);
  if (measured !== null) return measured;
  if (t.result === 'WIN') return t.target;
  if (t.result === 'LOSS') return t.stop;
  if (t.result === 'BE') return t.entry;
  return null;
}

/** Risk and reward in dollars, from the plan and the instrument's point value.
 *  Never read off a typed-in field — the journal has none, and inventing one
 *  would be a number nobody entered. */
function dollarsPerPoint(t: TradeEntry): number {
  return pointValue(t.symbol) * (t.contracts || 1);
}

export interface TradeDetailsTableProps {
  trades: TradeEntry[];
  onEdit: (trade: TradeEntry) => void;
  onDelete: (trade: TradeEntry) => void;
  /** Only called for trades that carry a screenshot; the button is absent
   *  otherwise rather than present and inert. */
  onOpenChart?: (trade: TradeEntry) => void;
}

type Filter = { key: string; label: string };

export default function TradeDetailsTable({ trades, onEdit, onDelete, onOpenChart }: TradeDetailsTableProps) {
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);

  /** Built from the instruments the trader actually has. A fixed MNQ/MES pair
   *  would offer an ES-only trader two filters that return nothing. */
  const filters: Filter[] = useMemo(() => {
    const symbols = [...new Set(trades.map(t => t.symbol))].sort();
    return [
      { key: 'all', label: 'הכל' },
      ...symbols.map(s => ({ key: `sym:${s}`, label: s })),
      { key: 'wins', label: 'ניצחונות' },
      { key: 'losses', label: 'הפסדים' },
    ];
  }, [trades]);

  const shown = useMemo(() => trades.filter(t =>
    filter === 'all'
    || (filter === 'wins' && t.result === 'WIN')
    || (filter === 'losses' && t.result === 'LOSS')
    || filter === `sym:${t.symbol}`), [trades, filter]);

  /** Days descending, and inside a day the latest trade first. */
  const groups = useMemo(() => {
    const byDay = new Map<string, TradeEntry[]>();
    for (const t of shown) {
      const list = byDay.get(t.dateISO) ?? [];
      list.push(t);
      byDay.set(t.dateISO, list);
    }
    return [...byDay.keys()].sort().reverse().map(date => ({
      date,
      rows: byDay.get(date)!.slice().sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : b.id - a.id)),
    }));
  }, [shown]);

  const pick = (key: string) => { setFilter(key); setOpenId(null); };

  const headCell = (text: string, align: 'right' | 'left' = 'right', color = 'rgba(255,255,255,.34)') => (
    <span key={text} style={{
      display: 'block', textAlign: align, fontFamily: MONO, fontSize: 9, fontWeight: 700,
      letterSpacing: '.16em', textTransform: 'uppercase', color,
    }}>{text}</span>
  );

  return (
    <div className="tdt" dir="rtl">
      {/* Filters + count. The page above owns the title and the date filters;
          these cut the same list a different way and belong to the table. */}
      <div className="flex items-center justify-between gap-3.5 flex-wrap mb-[18px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map(f => (
            <button key={f.key} type="button" className="tdt-filter" data-on={filter === f.key} onClick={() => pick(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.16em', color: 'rgba(255,255,255,.26)' }}>
            לחיצה על שורה פותחת פירוט
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)' }}>
            {shown.length} עסקאות
          </span>
        </div>
      </div>

      <div className="tdt-scroll" style={{
        position: 'relative', border: '1px solid #1c1c1e', borderRadius: 2, background: '#0d0d0f',
        overflow: 'hidden', boxShadow: '0 30px 90px -40px rgba(0,0,0,.9)',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1, zIndex: 1,
          background: 'linear-gradient(90deg,rgba(212,175,55,0) 0%,rgba(212,175,55,.45) 50%,rgba(212,175,55,0) 100%)',
        }} />

        <div style={{
          display: 'grid', gridTemplateColumns: GRID, columnGap: 16, alignItems: 'center',
          padding: '11px 20px', background: '#101013', borderBottom: '1px solid #1c1c1e',
        }}>
          {headCell('שעה')}
          {headCell('נכס · כיוון')}
          {headCell('כניסה')}
          {headCell('יציאה')}
          {headCell('R', 'right', GOLD)}
          {headCell('תוצאה')}
          {headCell('P&L')}
          {headCell('סטאפ', 'left')}
        </div>

        {groups.map(g => (
          <div key={g.date}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px',
              background: '#08080a', borderBottom: '1px solid #1c1c1e',
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: GOLD, boxShadow: '0 0 7px rgba(212,175,55,.7)', flexShrink: 0 }} />
              <span style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 700, letterSpacing: '.02em', color: '#fff', whiteSpace: 'nowrap' }}>
                {labelDate(g.date)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.18em', color: 'rgba(255,255,255,.3)', whiteSpace: 'nowrap' }}>
                {weekday(g.date)} · {g.rows.length} עסקאות
              </span>
              <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(28,28,30,0) 0%,#1c1c1e 100%)' }} />
            </div>

            {g.rows.map(t => (
              <TradeRow
                key={t.id}
                trade={t}
                open={openId === t.id}
                onToggle={() => setOpenId(id => (id === t.id ? null : t.id))}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpenChart={onOpenChart}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeRow({ trade: t, open, onToggle, onEdit, onDelete, onOpenChart }: {
  trade: TradeEntry;
  open: boolean;
  onToggle: () => void;
  onEdit: (t: TradeEntry) => void;
  onDelete: (t: TradeEntry) => void;
  onOpenChart?: (t: TradeEntry) => void;
}) {
  const tn = tone(t.result);
  const long = t.direction === 'LONG';
  const exit = exitPrice(t);
  const r = rMultiple(t);
  const pnl = tradePnL(t);
  const rr = plannedRR(t);
  const perPoint = dollarsPerPoint(t);
  const risk = Math.abs(t.entry - t.stop) * perPoint;
  const reward = Math.abs(t.target - t.entry) * perPoint;
  const setup = t.model && t.model !== 'לא צוין' ? t.model : '';
  const chart = t.screenshots?.[0] ?? null;
  // Logged before these answers were required. Marked rather than rewritten:
  // a gap is a fact about the record, and filling it in from here would be
  // inventing an answer the trader never gave.
  const missing = missingAnswers(t);

  // Every position on the bar is measured FROM THE STOP, which is what makes
  // one formula correct for a long and a short alike.
  const span = Math.abs(t.target - t.stop) || 1;
  const pct = (v: number) => `${((Math.abs(v - t.stop) / span) * 100).toFixed(1)}%`;

  const num = (value: string, color: string, weight: 700 | 900 = 700) => (
    <span dir="ltr" style={{
      display: 'block', textAlign: 'right', fontFamily: MONO, fontSize: 12,
      fontWeight: weight, color, fontVariantNumeric: 'tabular-nums',
    }}>{value}</span>
  );

  return (
    <div style={{ borderBottom: '1px solid #141416' }}>
      <div
        className="tdt-row"
        data-open={open}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{
          position: 'relative', display: 'grid', gridTemplateColumns: GRID, columnGap: 16,
          alignItems: 'center', padding: '12px 20px', cursor: 'pointer',
        }}
      >
        <span dir="ltr" style={{ display: 'block', textAlign: 'right', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.42)', fontVariantNumeric: 'tabular-nums' }}>
          {t.time}
        </span>

        <div className="flex items-center gap-[9px]">
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, color: '#fff', letterSpacing: '.05em' }}>{t.symbol}</span>
          {missing.length > 0 && (
            <span
              title={`חסרות תשובות: ${missing.map(m => m.label).join(' · ')}`}
              aria-label="חסרות תשובות"
              style={{ fontSize: 10, color: 'rgba(212,175,55,.55)', lineHeight: 1 }}
            >◇</span>
          )}
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: long ? BULL : BEAR, letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
            {long ? '▲ לונג' : '▼ שורט'}
          </span>
          <span dir="ltr" style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.28)' }}>×{t.contracts || 1}</span>
        </div>

        {num(price(t.entry), 'rgba(255,255,255,.82)')}
        {num(exit !== null ? price(exit) : '—', tn.c)}
        {num(r !== null ? rTxt(r) : '—', r === null ? MUTED : r > 0 ? GOLD : r < 0 ? BEAR : MUTED, 900)}

        <span style={{
          justifySelf: 'start', padding: '3px 9px', borderRadius: 2, border: `1px solid ${tn.br}`,
          background: tn.bg, color: tn.c, fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.14em',
        }}>{RESULT_HE[t.result] ?? t.result}</span>

        {num(pnl !== null ? money(pnl) : '—', pnl === null ? MUTED : pnl > 0 ? BULL : pnl < 0 ? BEAR : MUTED)}

        <div className="flex items-center justify-between gap-3">
          <span style={{
            fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.16em',
            color: setup ? 'rgba(212,175,55,.72)' : 'rgba(255,255,255,.26)', whiteSpace: 'nowrap',
          }}>{setup || 'לא נרשם'}</span>
          <span className="tdt-caret" aria-hidden style={{
            fontFamily: MONO, fontSize: 9, color: open ? GOLD : 'rgba(255,255,255,.24)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>▼</span>
        </div>
      </div>

      {open && (
        <div className="tdt-detail" style={{
          position: 'relative', padding: '20px 22px', borderTop: '1px solid #141416',
          background: 'linear-gradient(180deg,#0a0a0c 0%,#08080a 100%)', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 360, height: 120, pointerEvents: 'none', background: 'radial-gradient(70% 80% at 70% 0%, rgba(212,175,55,.07) 0%, rgba(212,175,55,0) 75%)' }} />
          <div className="tdt-sweep" style={{ position: 'absolute', top: 0, left: 0, width: '32%', height: 1, pointerEvents: 'none', background: 'linear-gradient(90deg,rgba(212,175,55,0),rgba(212,175,55,.6),rgba(212,175,55,0))' }} />

          {/* 1 — the plan, drawn. Stop on the right, target on the left, and
              the entry where it actually sat between them. */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 9 }}>
            <BarLabel text="סטופ" value={price(t.stop)} color="rgba(201,128,128,.75)" />
            <BarLabel text="כניסה" value={price(t.entry)} color={GOLD} />
            <BarLabel text="יעד" value={price(t.target)} color="rgba(111,165,128,.8)" />
          </div>
          <div style={{ position: 'relative', height: 4, background: '#141416', marginBottom: 20 }}>
            <div className="tdt-fill" style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: pct(t.entry), transformOrigin: 'right', background: 'linear-gradient(270deg,rgba(139,58,58,.85),rgba(139,58,58,.35))' }} />
            <div className="tdt-fill" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(Math.abs(t.target - t.entry) / span * 100).toFixed(1)}%`, transformOrigin: 'left', background: 'linear-gradient(90deg,rgba(74,124,89,.85),rgba(74,124,89,.35))' }} />
            <div style={{ position: 'absolute', top: -4, bottom: -4, width: 2, background: GOLD, boxShadow: '0 0 10px rgba(212,175,55,.8)', right: pct(t.entry) }} />
            {exit !== null && (
              <div className="tdt-exit" style={{
                position: 'absolute', top: -4, width: 10, height: 10, borderRadius: '50%',
                border: `2px solid ${tn.c}`, background: '#08080a', right: pct(exit), transform: 'translateX(50%)',
              }} />
            )}
          </div>

          {/* 2 — the three figures the plan implies. */}
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: '#1c1c1e', border: '1px solid #1c1c1e', marginBottom: 16 }}>
            <DataCell k="יחס סיכוי/סיכון" v={rr !== null ? rr.toFixed(2) : '—'} color={GOLD} glow="rgba(212,175,55,.35)" />
            <DataCell k="רווח פוטנציאלי" v={money(reward)} color={BULL} glow="rgba(74,124,89,.32)" />
            {/* Two decimals here as well. The design's own fixture rendered risk
                with a floating precision, which puts $72.5 under +$155.00 and
                breaks the one thing this column is for. */}
            <DataCell k="סיכון" v={`$${risk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color={BEAR} glow="rgba(139,58,58,.3)" />
          </div>

          {/* 3 — the context the trade was taken in. */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Chip text={`סשן · ${sessionLabel(t.session)}`} color={GOLD} />
            <Chip text={`ביאס יומי · ${BIAS_HE[t.bias] ?? t.bias}`} color={t.bias === 'BULLISH' ? BULL : t.bias === 'BEARISH' ? BEAR : 'rgba(255,255,255,.5)'} />
            <Chip text={`סטאפ · ${setup || 'לא נרשם'}`} color={setup ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.3)'} />
            <Chip text={`×${t.contracts || 1} חוזים`} color="rgba(255,255,255,.6)" />
          </div>

          {/* The answers this trade never got. Named, with the way to give
              them — a mark with no route to fixing it is just a scold. */}
          {missing.length > 0 && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                marginBottom: 14, padding: '9px 12px', background: 'rgba(212,175,55,.05)',
                border: '1px solid rgba(212,175,55,.18)',
              }}
            >
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'rgba(255,255,255,.55)', lineHeight: 1.6 }}>
                העסקה הזאת נשמרה לפני שהשאלות האלה היו חובה, ולכן היא לא נספרת במדידה שלהן:{' '}
                <b style={{ color: 'rgba(212,175,55,.9)' }}>{missing.map(m => m.label).join(' · ')}</b>
              </span>
              <button type="button" className="tdt-act tdt-act-edit" onClick={() => onEdit(t)}>השלם</button>
            </div>
          )}

          {/* 4 — the trader's own words, verbatim, and the actions. */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 22, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,.32)' }}>
                פרטים נוספים · הוזן על ידך
              </span>
              <div style={{ padding: '12px 14px', background: '#0d0d0f', border: '1px solid #1c1c1e', borderRight: '2px solid rgba(212,175,55,.45)' }}>
                <p style={{ margin: 0, fontFamily: SANS, fontSize: 12, lineHeight: 1.75, color: t.notes ? 'rgba(255,255,255,.62)' : 'rgba(255,255,255,.3)', textWrap: 'pretty' }}>
                  {t.notes || 'לא נרשם'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
              {chart && onOpenChart && (
                <button type="button" className="tdt-act tdt-act-chart" onClick={() => onOpenChart(t)}>גרף</button>
              )}
              <button type="button" className="tdt-act tdt-act-edit" onClick={() => onEdit(t)}>ערוך</button>
              <button type="button" className="tdt-act tdt-act-del" aria-label="מחק עסקה" onClick={() => onDelete(t)}>✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A price label above the bar. The number is isolated so bidi cannot pull it
 *  through the Hebrew word beside it. */
function BarLabel({ text, value, color }: { text: string; value: string; color: string }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color }}>
      {text} · <span dir="ltr" style={{ unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

function DataCell({ k, v, color, glow }: { k: string; v: string; color: string; glow: string }) {
  return (
    <div className="tdt-cell" style={{ background: '#0d0d0f', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,.36)' }}>{k}</span>
      <span dir="ltr" style={{ fontFamily: MONO, fontSize: 16, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1, textShadow: `0 0 18px ${glow}`, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span className="tdt-chip" style={{
      padding: '5px 11px', border: '1px solid #1c1c1e', background: '#101013',
      fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color,
    }}>{text}</span>
  );
}
