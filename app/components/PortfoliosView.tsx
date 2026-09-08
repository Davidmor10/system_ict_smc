'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Managing portfolios: create, rename, delete.
//
// The file upload lives in the next step; this screen is the account itself —
// its name, the capital behind it, and the clock its timestamps are read in.
//
// TWO THINGS IT REFUSES TO DO
//
//  · It never proposes a name. "תיק 1" tells a trader nothing at the moment
//    they have to pick one out of a list, and a name they did not choose is a
//    name they will not recognise.
//  · It never deletes on one click. A portfolio is the container for a
//    journal; the confirmation names what goes with it and asks for the name
//    to be typed back.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { usePortfolios } from './PortfolioProvider';
import ImportWizard from './ImportWizard';
import { loadTrades, saveTrades } from '../lib/journal';
import { backfillAccountId } from '../lib/portfolio/scope';
import { usePlan } from './PlanProvider';
import { ZONES, zoneShortName, clockInZone } from '../lib/time/zone';
import {
  canAddPortfolio, newPortfolio, validatePortfolio, MAX_NAME_LENGTH,
  type NameProblem, type Portfolio,
} from '../lib/portfolio/types';

const GOLD = '#d4af37';
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const COMMON = [10_000, 25_000, 50_000, 100_000, 150_000, 250_000];

export default function PortfoliosView() {
  const { portfolios, selected, ready, select, save } = usePortfolios();
  const { role } = usePlan();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Portfolio | null>(null);
  const [confirming, setConfirming] = useState<Portfolio | null>(null);
  const [importing, setImporting] = useState<Portfolio | null>(null);

  const verdict = useMemo(() => canAddPortfolio(portfolios.length, role), [portfolios.length, role]);

  async function upsert(p: Portfolio) {
    const first = portfolios.length === 0;
    const rest = portfolios.filter(x => x.id !== p.id);
    await save([...rest, { ...p, updatedAt: Date.now() }]);

    // The FIRST portfolio adopts everything already in the journal. Until this
    // moment those trades were one undivided record, so all of them are its —
    // and the alternative is a journal whose trades belong to no account and
    // whose numbers depend on a rule nobody can see. Runs once, and only when
    // there is something to adopt.
    if (first) {
      const existing = loadTrades();
      const { changed, trades } = backfillAccountId(existing, p.id);
      if (changed) saveTrades(trades);
    }

    select(p.id);
    setCreating(false);
    setEditing(null);
  }

  async function remove(p: Portfolio) {
    await save(portfolios.filter(x => x.id !== p.id));
    setConfirming(null);
  }

  return (
    <div dir="rtl" className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[900px] px-6 py-10 max-[880px]:px-4 max-[880px]:py-6">
        <header className="pb-6 border-b border-[#1c1c1e]">
          <div className="font-mono text-[11px] font-bold tracking-[0.22em] uppercase mb-2.5" style={{ color: GOLD }}>
            ◈ תיקים
          </div>
          <h1 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[32px] max-[880px]:text-[25px] font-bold text-white leading-tight">
            התיקים שלך
          </h1>
          <p className="mt-2.5 mb-0 text-[14.5px] leading-relaxed text-white/55" style={{ maxWidth: '58ch' }}>
            כל תיק הוא רשומה נפרדת. הסטטיסטיקות, הדפוסים והתובנות של תיק אחד לא מתערבבים באחר.
          </p>
        </header>

        {!ready ? (
          <p className="mt-8 font-mono text-[12px] text-white/35">טוען…</p>
        ) : (
          <>
            <div className="mt-7 flex flex-col gap-3">
              {portfolios.length === 0 && !creating && (
                <div className="rounded-[14px] border border-[#1c1c1e] bg-white/[0.015] p-8 text-center">
                  <p className="m-0 text-[15px] text-white/60">עוד לא חיברת תיק.</p>
                </div>
              )}

              {portfolios.map(p => (
                <article
                  key={p.id}
                  className="rounded-[14px] border p-5 flex items-start justify-between gap-4 flex-wrap"
                  style={{
                    borderColor: p.id === selected?.id ? 'rgba(212,175,55,0.32)' : '#1c1c1e',
                    background: p.id === selected?.id ? 'rgba(212,175,55,0.035)' : 'rgba(255,255,255,0.012)',
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="m-0 text-[17px] font-bold text-white">{p.name || 'תיק ללא שם'}</h2>
                      {p.id === selected?.id && (
                        <span className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase py-0.5 px-2 rounded-full"
                          style={{ color: GOLD, background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)' }}>
                          נבחר
                        </span>
                      )}
                    </div>
                    <div className="mt-2 font-mono text-[12px] text-white/45 tabular-nums flex gap-3 flex-wrap">
                      <span dir="ltr">{usd(p.startingBalanceUsd)}</span>
                      <span>·</span>
                      <span>{ZONES.find(z => z.id === p.timezone)?.label ?? p.timezone}</span>
                      <span>·</span>
                      <span>{p.lastImportAt ? `יובא ${new Date(p.lastImportAt).toLocaleDateString('he-IL')}` : 'טרם יובאו עסקאות'}</span>
                    </div>
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    {p.id !== selected?.id && (
                      <button type="button" onClick={() => select(p.id)} className="pf-btn">בחירה</button>
                    )}
                    <button type="button" onClick={() => setImporting(p)} className="pf-btn is-primary">
                      {p.lastImportAt ? 'עדכון מקובץ' : 'העלאת קובץ'}
                    </button>
                    <button type="button" onClick={() => setEditing(p)} className="pf-btn">עריכה</button>
                    <button type="button" onClick={() => setConfirming(p)} className="pf-btn is-danger">מחיקה</button>
                  </div>
                </article>
              ))}
            </div>

            {creating || editing ? (
              <PortfolioForm
                initial={editing}
                existing={portfolios}
                onCancel={() => { setCreating(false); setEditing(null); }}
                onSave={upsert}
              />
            ) : (
              <div className="mt-5">
                <button
                  type="button"
                  disabled={!verdict.ok}
                  onClick={() => setCreating(true)}
                  className="rounded-[9px] px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed"
                  style={{
                    background: verdict.ok ? GOLD : 'transparent',
                    color: verdict.ok ? '#000' : 'rgba(255,255,255,0.3)',
                    border: `1px solid ${verdict.ok ? GOLD : '#1c1c1e'}`,
                    boxShadow: verdict.ok ? '0 0 22px rgba(212,175,55,0.3)' : 'none',
                  }}
                >
                  + חיבור תיק
                </button>
                {!verdict.ok && (
                  <p className="mt-2.5 mb-0 text-[13px] text-white/45" style={{ maxWidth: '52ch' }}>
                    {verdict.message}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {importing && (
        <ImportWizard
          portfolio={importing}
          onClose={() => setImporting(null)}
          onImported={async () => {
            // Stamps when this portfolio last saw a file, so the card can say
            // how long it has been. Written after the trades, never before.
            const now = Date.now();
            await save(portfolios.map(x => (x.id === importing.id ? { ...x, lastImportAt: now, updatedAt: now } : x)));
          }}
        />
      )}

      {confirming && (
        <DeleteConfirm portfolio={confirming} onCancel={() => setConfirming(null)} onConfirm={() => remove(confirming)} />
      )}

      <style>{`
        .pf-btn {
          border: 1px solid #1c1c1e; border-radius: 8px; padding: 7px 13px;
          font-size: 12px; font-weight: 700; color: rgba(255,255,255,.6);
          background: transparent; transition: color .16s ease, border-color .16s ease;
        }
        .pf-btn:hover { color: #fff; border-color: rgba(255,255,255,.25); }
        .pf-btn.is-danger:hover { color: #f0899e; border-color: rgba(139,58,58,.55); }
        .pf-btn.is-primary { color: #f0dc9a; border-color: rgba(212,175,55,.4); background: rgba(212,175,55,.06); }
        .pf-btn.is-primary:hover { color: #fff; border-color: rgba(212,175,55,.7); }
        .pf-in {
          width: 100%; background: #0a0a0b; border: 1px solid #1c1c1e; border-radius: 8px;
          padding: 10px 12px; color: #fff; font-size: 14.5px; outline: none;
          transition: border-color .18s ease, background .18s ease;
        }
        .pf-in:focus { border-color: rgba(212,175,55,.5); background: rgba(212,175,55,.04); }
        .pf-in[aria-invalid='true'] { border-color: rgba(139,58,58,.7); }
      `}</style>
    </div>
  );
}

/* ── The form ─────────────────────────────────────────────────────────── */

function PortfolioForm({
  initial, existing, onCancel, onSave,
}: {
  initial: Portfolio | null;
  existing: Portfolio[];
  onCancel: () => void;
  onSave: (p: Portfolio) => void | Promise<void>;
}) {
  // Empty on a new portfolio, and deliberately so — see the header.
  const [name, setName] = useState(initial?.name ?? '');
  const [balance, setBalance] = useState<number>(initial?.startingBalanceUsd ?? 0);
  const [zone, setZone] = useState(initial?.timezone ?? 'Asia/Jerusalem');
  const [problems, setProblems] = useState<NameProblem[]>([]);

  const problem = (f: NameProblem['field']) => problems.find(p => p.field === f)?.message;

  function submit() {
    const found = validatePortfolio(name, balance, existing, initial?.id);
    setProblems(found);
    if (found.length > 0) return;
    void onSave(
      initial
        ? { ...initial, name: name.trim().slice(0, MAX_NAME_LENGTH), startingBalanceUsd: balance, timezone: zone }
        : newPortfolio(name, balance, zone),
    );
  }

  return (
    <section className="mt-5 rounded-[14px] border p-6 flex flex-col gap-5"
      style={{ borderColor: 'rgba(212,175,55,0.24)', background: 'linear-gradient(180deg,#0b0b0d,#070708)' }}>
      <h2 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[21px] font-bold text-white">
        {initial ? 'עריכת תיק' : 'חיבור תיק חדש'}
      </h2>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">שם התיק</span>
        <input
          className="pf-in"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          aria-invalid={!!problem('name')}
          onChange={e => setName(e.target.value)}
        />
        {problem('name') && <span className="text-[12.5px] text-[#f0899e]">{problem('name')}</span>}
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">יתרת פתיחה ($)</span>
        <div className="grid grid-cols-3 gap-1.5">
          {COMMON.map(v => (
            <button
              key={v} type="button" onClick={() => setBalance(v)} aria-pressed={balance === v}
              className="rounded-[8px] border px-3 py-2 text-[13px] text-center transition-all"
              style={{
                borderColor: balance === v ? 'rgba(212,175,55,0.55)' : '#1c1c1e',
                background: balance === v ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.015)',
                color: balance === v ? '#f0dc9a' : 'rgba(255,255,255,0.6)',
                fontWeight: balance === v ? 700 : 500,
              }}
            >
              <span dir="ltr">{usd(v)}</span>
            </button>
          ))}
        </div>
        <input
          className="pf-in" type="number" min={100} step={500} dir="ltr"
          value={balance || ''}
          aria-invalid={!!problem('balance')}
          onChange={e => setBalance(Number(e.target.value) || 0)}
        />
        {problem('balance') && <span className="text-[12.5px] text-[#f0899e]">{problem('balance')}</span>}
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">אזור זמן</span>
        <span className="text-[12.5px] text-white/35 -mt-1">
          השעון שהשעות של התיק הזה נקראות לפיו.
        </span>
        <select className="pf-in" value={zone} onChange={e => setZone(e.target.value)}>
          {ZONES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
        </select>
        <span className="font-mono text-[11.5px] text-white/40 tabular-nums">
          ◈ השעה כרגע: <span dir="ltr">{clockInZone(zone)} · {zoneShortName(zone)}</span>
        </span>
      </label>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={submit}
          className="rounded-[9px] px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em]"
          style={{ background: GOLD, color: '#000' }}>
          שמירה
        </button>
        <button type="button" onClick={onCancel} className="pf-btn">ביטול</button>
      </div>
    </section>
  );
}

/* ── Deleting ─────────────────────────────────────────────────────────── */

function DeleteConfirm({
  portfolio, onCancel, onConfirm,
}: { portfolio: Portfolio; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === portfolio.name.trim() && portfolio.name.trim() !== '';

  return (
    <div dir="rtl" role="dialog" aria-modal="true"
      className="fixed inset-0 z-[300] flex items-center justify-center p-5"
      style={{ background: 'rgba(3,3,4,0.84)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-[520px] rounded-[16px] border p-7 flex flex-col gap-4"
        style={{ borderColor: 'rgba(139,58,58,0.4)', background: 'linear-gradient(180deg,#0c0c0e,#060607)' }}>
        <h2 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[23px] font-bold text-white">
          מחיקת {portfolio.name || 'התיק'}
        </h2>
        {/* Naming what goes is the point. A confirmation that says only "are
            you sure" asks the trader to guess the consequence. */}
        <p className="m-0 text-[14px] leading-relaxed text-white/65">
          התיק יימחק, ואיתו כל מה ששייך לו: העסקאות שלו, הסטטיסטיקות, הדפוסים, הדוחות והתובנות. פעולה זו אינה הפיכה.
        </p>
        <label className="flex flex-col gap-2 mt-1">
          <span className="text-[13px] text-white/50">
            כדי לאשר, הקלד את שם התיק: <span className="text-white font-bold">{portfolio.name}</span>
          </span>
          <input className="pf-in" value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
        </label>
        <div className="flex gap-2 pt-1">
          <button
            type="button" onClick={onConfirm} disabled={!matches}
            className="rounded-[9px] px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] transition-all disabled:opacity-35 disabled:cursor-not-allowed"
            style={{ background: matches ? '#8b3a3a' : 'transparent', color: matches ? '#fff' : 'rgba(255,255,255,0.3)', border: '1px solid rgba(139,58,58,0.55)' }}
          >
            מחיקה סופית
          </button>
          <button type="button" onClick={onCancel} className="pf-btn">ביטול</button>
        </div>
      </div>
    </div>
  );
}
