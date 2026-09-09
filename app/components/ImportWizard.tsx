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
// ONE CLOCK, AND IT IS ISRAEL.
//
// The export's timestamps carry no zone. This used to be a question, with a
// picker on two screens — and it was the wrong question to put to a trader who
// has no way of knowing what TradingView wrote. The app files and shows every
// trade on Israel time, and reads the file's own timestamps as already being
// on it. The first trade's mapped time is shown back plainly in the review, so
// a file that is genuinely on another clock is visible rather than silent.
//
// THE ACCOUNT SIZE COMES FROM THE NAME, NOT FROM A ROW OF CHIPS.
//
// The file does not carry it — see balanceFromName. A trader who names an
// account "DAVID 50000 DEMO" has already said it, and reading it there beats a
// grid of common sizes where one wrong tap gave an account a $2,100 balance
// and every drawdown figure on every screen was then measured against it.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hydrateTradesFromCloud, saveTrades, loadTrades, type TradeEntry } from '../lib/journal';
import { parseTradingViewOrders, UnrecognisedExport, type ParsedTrade } from '../lib/import/tradingview';
import { toTradeEntries, splitAgainstExisting, type Skipped } from '../lib/import/toTrades';
import { DEFAULT_TIMEZONE } from '../lib/time/zone';
import { sessionLabel } from '../lib/sessions';
import {
  newPortfolio, validatePortfolio, balanceFromName, MAX_NAME_LENGTH,
  type NameProblem, type Portfolio,
} from '../lib/portfolio/types';

const GOLD = '#d4af37';
const BULL = '#6fa580';
const BEAR = '#c98080';

const money = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Stage = 'account' | 'file' | 'review' | 'done';

export default function ImportWizard({
  portfolio, onClose, onImported, onCreate, taken = [],
}: {
  /** The account being imported into, or null to create one here.
   *
   *  Creating the account and giving it its trades were two screens, and a
   *  trader who had just created one had no reason to know a second step
   *  existed — they had said what the account was and it sat there empty.
   *  One flow now: the details and the file are asked for together. */
  portfolio: Portfolio | null;
  onClose: () => void;
  onImported: (count: number) => void;
  /** Persist a newly created account. Called before its trades are written. */
  onCreate?: (p: Portfolio) => Promise<void>;
  /** The accounts that already exist, so a duplicate name is caught here
   *  rather than after the file has been read. */
  taken?: readonly Portfolio[];
}) {
  const creating = portfolio === null;
  const [stage, setStage] = useState<Stage>(creating ? 'account' : 'file');
  // Held here rather than inside the step so a trip back from the review does
  // not lose what was typed.
  const [draftName, setDraftName] = useState('');
  /** Only ever consulted when the NAME holds no size. Kept as a string so an
   *  empty field stays empty instead of showing a 0 the trader has to clear. */
  const [typedBalance, setTypedBalance] = useState('');
  const [problems, setProblems] = useState<NameProblem[]>([]);
  const readBalance = balanceFromName(draftName);
  const draftBalance = readBalance ?? (Number(typedBalance) || 0);
  /** The id the new account will have, fixed up front so the trades mapped in
   *  the preview carry the same one the account is finally saved with. */
  const [newId] = useState(() => newPortfolio('', 0, DEFAULT_TIMEZONE).id);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedTrade[] | null>(null);
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
      // When an account is being created the details still have to be filled
      // in, so the file arriving does not skip past them.
      if (!creating) setStage('review');
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
    // Both zones are Israel, so the reinterpretation is a no-op and the times
    // in the journal are the times in the file. That is the assumption, said
    // out loud rather than hidden behind a picker nobody could answer.
    const { trades, skipped } = toTradeEntries(parsed, {
      fileZone: DEFAULT_TIMEZONE, appZone: DEFAULT_TIMEZONE, accountId: portfolio?.id ?? newId,
    });
    const { fresh, duplicates } = splitAgainstExisting(trades, existing);
    return { fresh, duplicates, skipped };
  }, [parsed, existing, portfolio, newId]);

  async function commit() {
    if (!mapped || busy) return;
    setBusy(true);
    // The account is written BEFORE its trades. The other order would leave
    // trades pointing at a portfolio that does not exist if the second write
    // failed — invisible on every screen, since nothing would scope to it.
    if (creating && onCreate) {
      await onCreate(newPortfolio(draftName, draftBalance, DEFAULT_TIMEZONE, newId));
    }
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
              ◈ {portfolio?.name || draftName || 'חשבון חדש'}
            </div>
            <h2 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[26px] font-bold text-white leading-tight">
              {stage === 'done' ? 'החשבון מוכן'
                : creating ? 'הוספת חשבון מסחר'
                : 'ייבוא עסקאות מ-TradingView'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגירה"
            className="text-white/35 hover:text-white text-[20px] leading-none shrink-0">✕</button>
        </header>

        <div className="p-7">
          {stage === 'account' && (
            <AccountStep
              name={draftName} onName={setDraftName}
              readBalance={readBalance}
              typedBalance={typedBalance} onTypedBalance={setTypedBalance}
              problems={problems}
              error={error}
              fileName={fileName}
              onPick={() => input.current?.click()}
              onDrop={f => void readFile(f)}
              onSubmit={() => {
                const found = validatePortfolio(draftName, draftBalance, taken);
                setProblems(found);
                if (found.length === 0 && parsed) setStage('review');
              }}
              ready={!!parsed}
            />
          )}

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
              onBack={() => { setStage(creating ? 'account' : 'file'); setParsed(null); }}
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
  parsed, mapped, onBack, onCommit, busy,
}: {
  parsed: ParsedTrade[];
  mapped: { fresh: TradeEntry[]; duplicates: TradeEntry[]; skipped: Skipped[] };
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
      {/* Not a question any more — a statement, shown against the trader's own
          first trade so a file on another clock is visible rather than silent. */}
      <section className="rounded-[12px] p-4"
        style={{ border: '1px solid rgba(212,175,55,0.3)', background: 'rgba(212,175,55,0.04)' }}>
        <div className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: GOLD }}>
          שעון ישראל
        </div>
        <p className="m-0 text-[14px] leading-relaxed text-white/80">
          העסקה הראשונה בקובץ רשומה ב־<span className="font-mono text-white" dir="ltr">{firstRaw}</span>.
          {firstMapped && (
            <> ביומן היא תיכנס ל־<span className="font-mono text-white" dir="ltr">{firstMapped.dateISO} {firstMapped.time}</span>
              {firstMapped.session ? <> · {sessionLabel(firstMapped.session)}</> : <> · מחוץ לסשנים שהגדרת</>}.</>
          )}
        </p>
        <p className="m-0 mt-2 text-[13px] text-white/50">
          כל השעות במערכת הן שעון ישראל, והשעות בקובץ נקראות כפי שהן.
        </p>
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


/* ── Step 0 — the account, and its file, in one place ─────────────────── */

/** The export lives four menus deep in TradingView and the path is not
 *  guessable. Written out rather than linked: a trader who cannot find the
 *  file does not come back to look for a help page. */
const EXPORT_STEPS = [
  'התחבר לחשבון TradingView שלך.',
  'פתח גרף כלשהו.',
  'בתחתית המסך, לחץ על Paper Trading או על Live Trading.',
  'עבור ללשונית היסטוריית הפקודות (History).',
  'לחץ על שלוש הנקודות בצד, ובחר Export data.',
  'שמור את הקובץ ב-CSV והעלה אותו כאן.',
];

function AccountStep({
  name, onName, readBalance, typedBalance, onTypedBalance,
  problems, error, fileName, onPick, onDrop, onSubmit, ready,
}: {
  name: string; onName: (v: string) => void;
  /** The size read out of the name, or null when the name holds none. */
  readBalance: number | null;
  typedBalance: string; onTypedBalance: (v: string) => void;
  problems: NameProblem[];
  error: string | null;
  fileName: string;
  onPick: () => void;
  onDrop: (f: File) => void;
  onSubmit: () => void;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const problem = (f: NameProblem['field']) => problems.find(p => p.field === f)?.message;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">פלטפורמה</span>
        {/* One option, and a control rather than a label: the day a second
            broker is supported this is where it goes, and a trader can see
            now which one the file has to come from. */}
        <div className="iw-in flex items-center gap-2.5 opacity-80">
          <span className="font-mono text-[11px] font-bold" style={{ color: GOLD }}>TV</span>
          <span>TradingView</span>
        </div>
      </div>

      <div className="rounded-[10px] border border-[#1c1c1e] bg-white/[0.015] overflow-hidden">
        <button
          type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="w-full flex items-center justify-between gap-3 p-4 text-start"
        >
          <span className="text-[13.5px] font-bold text-white/80">איך מייצאים עסקאות מ-TradingView?</span>
          <span className="text-white/35 text-[12px]" aria-hidden>{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <ol className="m-0 px-4 pb-4 ps-8 flex flex-col gap-1.5">
            {EXPORT_STEPS.map((t, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-white/60">{t}</li>
            ))}
          </ol>
        )}
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">שם החשבון</span>
        <input
          className="iw-in" value={name} maxLength={MAX_NAME_LENGTH}
          placeholder="לדוגמה: DAVID 50000 DEMO"
          aria-invalid={!!problem('name')}
          onChange={e => onName(e.target.value)}
        />
        <span className="text-[12.5px] text-white/40 leading-relaxed">
          אם תכתוב את גודל החשבון בשם, המערכת תיקח אותו משם.
        </span>
        {problem('name') && <span className="text-[12.5px] text-[#f0899e]">{problem('name')}</span>}
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">גודל החשבון</span>
        {readBalance !== null ? (
          <div
            className="rounded-[8px] px-3 py-2.5 flex items-baseline gap-2.5"
            style={{ border: '1px solid rgba(212,175,55,0.4)', background: 'rgba(212,175,55,0.06)' }}
          >
            <span dir="ltr" className="font-mono text-[16px] font-bold" style={{ color: '#f0dc9a' }}>
              ${readBalance.toLocaleString('en-US')}
            </span>
            <span className="text-[12.5px] text-white/45">נקרא מתוך שם החשבון</span>
          </div>
        ) : (
          <>
            <input
              className="iw-in" type="number" min={100} step={500} dir="ltr"
              placeholder="50000"
              value={typedBalance} aria-invalid={!!problem('balance')}
              onChange={e => onTypedBalance(e.target.value)}
            />
            {/* Said plainly, because a trader who has just uploaded a file of
                their own trades reasonably expects it to hold this too. */}
            <span className="text-[12.5px] text-white/40 leading-relaxed">
              הקובץ של TradingView לא מכיל את גודל החשבון — יש בו רק את הפקודות. כתוב אותו כאן פעם אחת, או רשום אותו בשם החשבון.
            </span>
          </>
        )}
        {problem('balance') && <span className="text-[12.5px] text-[#f0899e]">{problem('balance')}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">קובץ העסקאות</span>
        <div
          className="iw-drop" data-over={over} onClick={onPick}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onDrop(f); }}
          style={{ padding: '28px 20px' }}
        >
          <div className="text-[22px] mb-1.5" aria-hidden>{ready ? '✓' : '↑'}</div>
          <div className="text-[14px] font-bold" style={{ color: ready ? '#7fae8c' : '#fff' }}>
            {ready ? 'הקובץ נקרא' : 'גרור לכאן את הקובץ, או לחץ לבחירה'}
          </div>
          {fileName && <div className="mt-2 font-mono text-[11px] text-white/50" dir="ltr">{fileName}</div>}
        </div>
      </div>

      {error && (
        <p className="m-0 text-[13.5px] leading-relaxed rounded-[10px] p-3.5"
          style={{ color: '#f0899e', background: 'rgba(139,58,58,0.08)', border: '1px solid rgba(139,58,58,0.35)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button" onClick={onSubmit} disabled={!ready}
          className="rounded-[9px] px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: GOLD, color: '#000' }}
        >
          {ready ? 'המשך' : 'ממתין לקובץ'}
        </button>
      </div>
    </div>
  );
}
