'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Importing a TradingView export into a portfolio.
//
// NOTHING IS WRITTEN UNTIL THE LAST BUTTON.
//
// The file is parsed, mapped and shown in full — every trade, the ones already
// in the journal, and the rows that could not be read — and only then saved.
// An importer that writes first and reports afterwards leaves the trader
// undoing it by hand, and this one is aimed at people with a hundred trades.
//
// THE ZONE QUESTION IS ASKED, NOT ASSUMED.
//
// The export's timestamps carry no zone. Read in the wrong one they do not
// fail — they file every trade under the wrong session, silently. So the first
// trade's own time is shown back to the trader with the question attached, and
// the preview below re-computes the moment they change the answer.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hydrateTradesFromCloud, saveTrades, loadTrades, type TradeEntry } from '../lib/journal';
import { parseTradingViewOrders, UnrecognisedExport, type ParsedTrade } from '../lib/import/tradingview';
import { toTradeEntries, splitAgainstExisting, type Skipped } from '../lib/import/toTrades';
import { ZONES, activeZone, zoneShortName } from '../lib/time/zone';
import { sessionLabel } from '../lib/sessions';
import type { Portfolio } from '../lib/portfolio/types';

const GOLD = '#d4af37';
const BULL = '#6fa580';
const BEAR = '#c98080';

const money = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Stage = 'file' | 'review' | 'done';

export default function ImportWizard({
  portfolio, onClose, onImported,
}: {
  portfolio: Portfolio;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [stage, setStage] = useState<Stage>('file');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedTrade[] | null>(null);
  const [fileZone, setFileZone] = useState(portfolio.timezone);
  const [existing, setExisting] = useState<TradeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  // The journal as it stands, so "already imported" is answered against the
  // cloud rather than against whatever this device happens to hold.
  useEffect(() => {
    setExisting(loadTrades());
    hydrateTradesFromCloud().then(setExisting).catch(() => {});
  }, []);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('לא הצלחתי לקרוא את הקובץ.');
      return;
    }
    try {
      const result = parseTradingViewOrders(text);
      if (result.trades.length === 0) {
        setError('לא נמצאו עסקאות בקובץ. ודא שייצאת את היסטוריית הפקודות (Order History) ולא דוח אחר.');
        return;
      }
      setParsed(result.trades);
      setStage('review');
    } catch (e) {
      // "No trades found" and "this is not the right export" are different
      // answers, and a trader given the first will keep re-uploading.
      setError(
        e instanceof UnrecognisedExport
          ? `הקובץ לא נראה כמו ייצוא של TradingView. חסרות עמודות: ${e.missing.join(', ')}`
          : 'הקובץ לא נקרא.',
      );
    }
  }, []);

  const mapped = useMemo(() => {
    if (!parsed) return null;
    const { trades, skipped } = toTradeEntries(parsed, {
      fileZone, appZone: activeZone(), accountId: portfolio.id,
    });
    const { fresh, duplicates } = splitAgainstExisting(trades, existing);
    return { fresh, duplicates, skipped };
  }, [parsed, fileZone, existing, portfolio.id]);

  async function commit() {
    if (!mapped || busy) return;
    setBusy(true);
    // Append, never replace. Everything already in the journal keeps whatever
    // the trader has filled in on it.
    saveTrades([...existing, ...mapped.fresh]);
    setSaved(mapped.fresh.length);
    setBusy(false);
    setStage('done');
    onImported(mapped.fresh.length);
  }

  return (
    <div
      dir="rtl" role="dialog" aria-modal="true" aria-label="ייבוא עסקאות"
      className="fixed inset-0 z-[300] flex items-start justify-center p-5 overflow-y-auto"
      style={{ background: 'rgba(3,3,4,0.86)', backdropFilter: 'blur(10px)' }}
    >
      <div
        className="w-full max-w-[860px] rounded-[16px] border my-auto"
        style={{ borderColor: 'rgba(212,175,55,0.22)', background: 'linear-gradient(180deg,#0c0c0e,#060607)' }}
      >
        <header className="flex items-start justify-between gap-4 p-7 pb-5 border-b border-[#1c1c1e]">
          <div>
            <div className="font-mono text-[11px] font-bold tracking-[0.2em] uppercase mb-2" style={{ color: GOLD }}>
              ◈ {portfolio.name}
            </div>
            <h2 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[26px] font-bold text-white leading-tight">
              {stage === 'done' ? 'הייבוא הושלם' : 'ייבוא עסקאות מ-TradingView'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגירה"
            className="text-white/35 hover:text-white text-[20px] leading-none shrink-0">✕</button>
        </header>

        <div className="p-7">
          {stage === 'file' && (
            <FileStep
              error={error}
              fileName={fileName}
              onPick={() => input.current?.click()}
              onDrop={f => void readFile(f)}
            />
          )}

          {stage === 'review' && mapped && (
            <ReviewStep
              parsed={parsed!}
              mapped={mapped}
              fileZone={fileZone}
              onZone={setFileZone}
              onBack={() => { setStage('file'); setParsed(null); }}
              onCommit={() => void commit()}
              busy={busy}
            />
          )}

          {stage === 'done' && (
            <div className="flex flex-col gap-4 py-4">
              <p className="m-0 text-[16px] text-white/80">
                {saved === 0
                  ? 'לא נוספו עסקאות — כולן כבר היו ביומן.'
                  : saved === 1 ? 'עסקה אחת נוספה ליומן.' : `${saved} עסקאות נוספו ליומן.`}
              </p>
              <p className="m-0 text-[13.5px] text-white/50" style={{ maxWidth: '58ch' }}>
                המספרים כבר עובדים. הסטאפ, האישורים והמשמעת נשארו ריקים — אפשר להשלים אותם מהיומן, עסקה אחר עסקה.
              </p>
              <div>
                <button type="button" onClick={onClose}
                  className="rounded-[9px] px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em]"
                  style={{ background: GOLD, color: '#000' }}>
                  סגירה
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <input
        ref={input} type="file" accept=".csv,text/csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }}
      />

      <style>{`
        .iw-drop {
          border: 1.5px dashed #2a2a2d; border-radius: 12px; padding: 44px 24px;
          text-align: center; cursor: pointer; transition: border-color .18s ease, background .18s ease;
        }
        .iw-drop:hover, .iw-drop[data-over='true'] { border-color: rgba(212,175,55,.55); background: rgba(212,175,55,.04); }
        .iw-in { background:#0a0a0b; border:1px solid #1c1c1e; border-radius:8px; padding:9px 11px; color:#fff; font-size:14px; outline:none; }
        .iw-in:focus { border-color: rgba(212,175,55,.5); }
        .iw-th { font-family: var(--font-geist-mono, monospace); font-size:9.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.32); }
        .iw-td { font-family: var(--font-geist-mono, monospace); font-size:11.5px; font-variant-numeric: tabular-nums; color:rgba(255,255,255,.75); }
      `}</style>
    </div>
  );
}

/* ── Step 1 ───────────────────────────────────────────────────────────── */

function FileStep({
  error, fileName, onPick, onDrop,
}: { error: string | null; fileName: string; onPick: () => void; onDrop: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <div
        className="iw-drop" data-over={over} onClick={onPick}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onDrop(f); }}
      >
        <div className="text-[26px] mb-2" aria-hidden>↑</div>
        <div className="text-[15px] font-bold text-white">גרור לכאן את הקובץ, או לחץ לבחירה</div>
        <div className="mt-1.5 font-mono text-[11px] text-white/35">CSV מ-TradingView</div>
        {fileName && <div className="mt-3 font-mono text-[11px] text-white/50" dir="ltr">{fileName}</div>}
      </div>

      {error && (
        <p className="m-0 text-[13.5px] leading-relaxed rounded-[10px] p-3.5"
          style={{ color: '#f0899e', background: 'rgba(139,58,58,0.08)', border: '1px solid rgba(139,58,58,0.35)' }}>
          {error}
        </p>
      )}

      <div className="rounded-[10px] border border-[#1c1c1e] bg-white/[0.015] p-4">
        <div className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase text-white/40 mb-2">איפה מוצאים את הקובץ</div>
        <p className="m-0 text-[13px] leading-relaxed text-white/55">
          ב-TradingView, בחלונית המסחר: לשונית היסטוריית הפקודות, ואז ייצוא ל-CSV. הקובץ מכיל פקודות ולא עסקאות — המערכת מרכיבה מהן את העסקאות בעצמה.
        </p>
      </div>
    </div>
  );
}

/* ── Step 2 ───────────────────────────────────────────────────────────── */

function ReviewStep({
  parsed, mapped, fileZone, onZone, onBack, onCommit, busy,
}: {
  parsed: ParsedTrade[];
  mapped: { fresh: TradeEntry[]; duplicates: TradeEntry[]; skipped: Skipped[] };
  fileZone: string;
  onZone: (z: string) => void;
  onBack: () => void;
  onCommit: () => void;
  busy: boolean;
}) {
  const shown = [...mapped.fresh, ...mapped.duplicates]
    .sort((a, b) => `${a.dateISO}${a.time}`.localeCompare(`${b.dateISO}${b.time}`));
  const firstRaw = parsed[0]?.openedAt ?? '';
  const firstMapped = shown[0];

  return (
    <div className="flex flex-col gap-6">
      {/* The zone question, asked against the trader's own first trade. */}
      <section className="rounded-[12px] p-4"
        style={{ border: '1px solid rgba(212,175,55,0.3)', background: 'rgba(212,175,55,0.04)' }}>
        <div className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: GOLD }}>
          שאלה אחת לפני שממשיכים
        </div>
        <p className="m-0 text-[14px] leading-relaxed text-white/80">
          העסקה הראשונה בקובץ רשומה ב־<span className="font-mono text-white" dir="ltr">{firstRaw}</span>.
          {firstMapped && (
            <> ביומן היא תיכנס ל־<span className="font-mono text-white" dir="ltr">{firstMapped.dateISO} {firstMapped.time}</span>
              {firstMapped.session ? <> · {sessionLabel(firstMapped.session)}</> : <> · מחוץ לסשנים שהגדרת</>}.</>
          )}
        </p>
        <p className="m-0 mt-2 text-[13px] text-white/50">
          אם השעה הזאת לא נכונה, השעון של הקובץ שונה משלך — והסשן של כל עסקה יהיה שגוי.
        </p>
        <label className="flex items-center gap-2.5 mt-3 flex-wrap">
          <span className="font-mono text-[11px] font-bold tracking-[0.12em] uppercase text-white/45">השעון של הקובץ</span>
          <select className="iw-in" value={fileZone} onChange={e => onZone(e.target.value)}>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
          <span className="font-mono text-[11px] text-white/35" dir="ltr">{zoneShortName(fileZone)}</span>
        </label>
      </section>

      <div className="flex gap-4 flex-wrap font-mono text-[12px]">
        <Stat n={mapped.fresh.length} label="חדשות" tone={GOLD} />
        <Stat n={mapped.duplicates.length} label="כבר ביומן" tone="rgba(255,255,255,0.4)" />
        {mapped.skipped.length > 0 && <Stat n={mapped.skipped.length} label="נדחו" tone={BEAR} />}
      </div>

      {mapped.skipped.length > 0 && (
        <section className="rounded-[10px] p-3.5"
          style={{ border: '1px solid rgba(139,58,58,0.35)', background: 'rgba(139,58,58,0.06)' }}>
          <div className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: '#f0899e' }}>
            לא נכנסות
          </div>
          <ul className="m-0 ps-4 flex flex-col gap-1">
            {mapped.skipped.slice(0, 8).map(s => (
              <li key={s.externalId} className="text-[13px] text-white/65">{s.detail}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="rounded-[10px] border border-[#1c1c1e] overflow-hidden">
        <div className="max-h-[300px] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0" style={{ background: '#101013' }}>
              <tr>
                {['תאריך', 'שעה', 'נכס', 'כיוון', 'חוזים', 'כניסה', 'יציאה', 'R', 'תוצאה', ''].map((h, i) => (
                  <th key={i} className="iw-th text-start px-3 py-2.5 border-b border-[#1c1c1e]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(t => {
                const dup = mapped.duplicates.includes(t);
                return (
                  <tr key={t.id} style={{ opacity: dup ? 0.4 : 1 }}>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]" dir="ltr">{t.dateISO}</td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]" dir="ltr">{t.time}</td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]">{t.symbol}</td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]"
                      style={{ color: t.direction === 'LONG' ? BULL : BEAR }}>
                      {t.direction === 'LONG' ? 'לונג' : 'שורט'}
                    </td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]">{t.contracts}</td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]" dir="ltr">{t.entry.toFixed(2)}</td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]" dir="ltr">
                      {t.exits?.[0] ? t.exits[0].price.toFixed(2) : '—'}
                    </td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]" dir="ltr">
                      {typeof t.tradeR === 'number' ? `${t.tradeR > 0 ? '+' : ''}${t.tradeR.toFixed(1)}R` : '—'}
                    </td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416]"
                      style={{ color: typeof t.pnlUsd === 'number' ? (t.pnlUsd > 0 ? BULL : t.pnlUsd < 0 ? BEAR : undefined) : undefined }}
                      dir="ltr">
                      {typeof t.pnlUsd === 'number' ? money(t.pnlUsd) : t.result === 'OPEN' ? 'פתוחה' : '—'}
                    </td>
                    <td className="iw-td px-3 py-2 border-b border-[#141416] text-white/30">
                      {dup ? 'קיימת' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="m-0 text-[12.5px] text-white/40" style={{ maxWidth: '62ch' }}>
        עסקאות שכבר ביומן לא ייגעו. אם השלמת עליהן סטאפ, אישורים או משמעת — התשובות שלך נשארות.
      </p>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button" onClick={onCommit} disabled={busy || mapped.fresh.length === 0}
          className="rounded-[9px] px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: GOLD, color: '#000' }}
        >
          {busy ? 'מייבא…' : mapped.fresh.length === 0 ? 'אין מה לייבא' : `ייבוא ${mapped.fresh.length} עסקאות`}
        </button>
        <button type="button" onClick={onBack}
          className="rounded-[9px] px-4 py-2.5 border border-[#1c1c1e] font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-white/45 hover:text-white/80">
          קובץ אחר
        </button>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[19px] font-bold tabular-nums" style={{ color: tone }}>{n}</span>
      <span className="text-[12px] text-white/45">{label}</span>
    </span>
  );
}
