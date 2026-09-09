'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The first thing a new account sees.
//
// WHY IT EXISTS
//
// The settings that shape every number on every screen were reachable only by
// a trader who went looking for them, and the one that matters most has a
// default that is silently wrong for most people: the account balance ships at
// $25,000 and anchors the equity curve and the drawdown. A trader funded at
// $50,000 reads a dashboard drawn against half their capital and has no reason
// to suspect a settings page they have never opened.
//
// So it is asked once, up front, before the numbers mean anything.
//
// WHAT IT IS NOT
//
// It is not a wall. Every step can be passed with the default; the whole thing
// can be skipped. What it must never do is appear twice, or appear for someone
// who has been using the app — see `onboardedAt` and the trade check in the
// gate below.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { saveDoc } from '../lib/sync/collections';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_KIND, type UserSettings, type TradingStyle,
} from '../lib/settings/types';
import { INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { DEFAULT_TIMEZONE } from '../lib/time/zone';

const GOLD = '#d4af37';

const STYLE_LABEL: Record<TradingStyle, string> = {
  scalper:  'סקאלפר · שניות עד דקות',
  day:      'דיי־טרייד · סוגר באותו יום',
  swing:    'סווינג · ימים עד שבועות',
  position: 'פוזיציה · שבועות ומעלה',
};

// The clock was a third step. It is gone: the app runs on Israel time, one
// clock for every screen and every import, and a picker on a setup screen was
// asking a new trader to make a decision the app had already made.
const STEPS = ['מי אתה', 'החשבון'] as const;

/** `suggestedName` comes from the caller rather than from a Clerk hook in
 *  here: this component is then pure UI over a settings draft, which is what
 *  lets it be rendered and driven in a browser test without an auth session. */
export default function FirstRunSetup({
  onDone, suggestedName,
}: { onDone: () => void; suggestedName?: string | null }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<UserSettings>(DEFAULT_SETTINGS);
  const dialog = useRef<HTMLDivElement | null>(null);

  // Seed the nickname from Clerk so the first field is answered rather than
  // empty — one less thing between a new trader and their journal.
  useEffect(() => {
    const first = suggestedName?.trim();
    if (first) setDraft(d => (d.nickname ? d : { ...d, nickname: first }));
  }, [suggestedName]);

  useEffect(() => { dialog.current?.focus(); }, [step]);

  const patch = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  async function finish(skipped: boolean) {
    if (busy) return;
    setBusy(true);
    // Skipping still writes, and writes the DEFAULTS rather than a half-filled
    // draft: a trader who skipped from step two did not choose the balance
    // they happened to be looking at.
    const doc: UserSettings = {
      ...(skipped ? DEFAULT_SETTINGS : draft),
      // Not a setting any more. Written explicitly rather than left to the
      // default, so a doc carried over from an older version is corrected on
      // the way through instead of keeping a zone nothing can change.
      timezone: DEFAULT_TIMEZONE,
      onboardedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDoc(SETTINGS_KIND, SETTINGS_KEY, doc).catch(() => {});
    setBusy(false);
    onDone();
  }

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="הגדרה ראשונית"
      className="fixed inset-0 z-[300] flex items-center justify-center p-5 overflow-y-auto"
      style={{ background: 'rgba(3,3,4,0.86)', backdropFilter: 'blur(10px)' }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="w-full max-w-[620px] rounded-[18px] border p-8 max-[640px]:p-5 outline-none my-auto"
        style={{
          borderColor: 'rgba(212,175,55,0.22)',
          background: 'linear-gradient(180deg, #0c0c0e 0%, #060607 100%)',
          boxShadow: '0 50px 120px -50px rgba(0,0,0,0.95), 0 0 70px -40px rgba(212,175,55,0.3)',
        }}
      >
        {/* Where you are, out of how many. */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <span
                className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase whitespace-nowrap"
                style={{ color: i === step ? GOLD : i < step ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)' }}
              >
                {i < step ? '✓' : `0${i + 1}`} {label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="flex-1 h-px" style={{ background: i < step ? 'rgba(212,175,55,0.4)' : '#1c1c1e' }} />
              )}
            </div>
          ))}
        </div>

        {step === 0 && (
          <Step
            title={`ברוך הבא${draft.nickname ? `, ${draft.nickname}` : ''}`}
            lede="שלוש שאלות קצרות, ואז היומן שלך. אפשר לשנות הכל אחר כך בהגדרות."
          >
            <Field label="איך לפנות אליך">
              <input
                className="onb-in"
                value={draft.nickname}
                maxLength={40}
                placeholder={suggestedName ?? 'הכינוי שלך'}
                onChange={e => patch('nickname', e.target.value)}
              />
            </Field>
            <Field label="איך אתה סוחר" hint="עוזר למאמן לחשוב במונחי דקות או ימים.">
              <div className="flex flex-col gap-1.5">
                {(Object.keys(STYLE_LABEL) as TradingStyle[]).map(k => (
                  <Choice key={k} on={draft.tradingStyle === k} onClick={() => patch('tradingStyle', k)}>
                    {STYLE_LABEL[k]}
                  </Choice>
                ))}
              </div>
            </Field>
          </Step>
        )}

        {step === 1 && (
          <Step
            title="גודל החשבון"
            lede="המספר הזה הוא העוגן של עקומת ההון ושל חישוב הדרואודאון. אם הוא לא נכון, כל אחוז בדשבורד לא נכון — לכן הוא נשאל כאן ולא מחכה שתמצא אותו בהגדרות."
          >
            <Field label="יתרת פתיחה ($)">
              {/* The grid of common sizes that used to sit here is gone. One
                  tap on the wrong chip is how an account ends up anchored to a
                  size it never had — and every drawdown percentage on every
                  screen is then measured against it. Typed, once. */}
              <input
                className="onb-in"
                type="number"
                min={100}
                step={500}
                dir="ltr"
                placeholder="50000"
                value={draft.accountStartUsd || ''}
                onChange={e => patch('accountStartUsd', Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="המכשיר שאתה סוחר בעיקר" hint="טופס עסקה חדשה ייפתח איתו מסומן.">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(INSTRUMENTS) as InstrumentKey[]).map(k => (
                  <Choice key={k} compact on={draft.defaultSymbol === k} onClick={() => patch('defaultSymbol', k)}>
                    {k}
                  </Choice>
                ))}
              </div>
            </Field>
          </Step>
        )}

        <div className="flex items-center gap-2 mt-8 pt-5 border-t border-[#1c1c1e] flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : void finish(false))}
            className="rounded-[8px] px-6 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] transition-all disabled:opacity-50"
            style={{ background: GOLD, color: '#000', boxShadow: '0 0 26px rgba(212,175,55,0.35)' }}
          >
            {busy ? 'שומר…' : step < STEPS.length - 1 ? 'הבא' : 'סיימתי'}
          </button>

          {step > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(step - 1)}
              className="rounded-[8px] px-4 py-2.5 border border-[#1c1c1e] font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-white/45 hover:text-white/80 transition-colors"
            >
              חזרה
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void finish(true)}
            className="mr-auto text-[12.5px] text-white/35 hover:text-white/65 transition-colors"
          >
            דלג — אשלים אחר כך בהגדרות
          </button>
        </div>
      </div>

      <style>{`
        .onb-in {
          width: 100%; background: #0a0a0b; border: 1px solid #1c1c1e; border-radius: 8px;
          padding: 11px 13px; color: #fff; font-size: 15px; outline: none;
          transition: border-color .18s ease, background .18s ease;
        }
        .onb-in:focus { border-color: rgba(212,175,55,0.5); background: rgba(212,175,55,0.04); }
      `}</style>
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function Step({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[30px] max-[640px]:text-[24px] font-bold text-white leading-tight">
          {title}
        </h2>
        <p className="mt-2.5 mb-0 text-[14.5px] leading-relaxed text-white/55" style={{ maxWidth: '52ch' }}>{lede}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/45">{label}</span>
      {hint && <span className="text-[12.5px] text-white/35 -mt-1">{hint}</span>}
      {children}
    </div>
  );
}

function Choice({
  on, onClick, children, compact = false, centred = false,
}: { on: boolean; onClick: () => void; children: React.ReactNode; compact?: boolean; centred?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-[8px] border transition-all duration-150 ${centred ? 'text-center' : 'text-right'} ${compact ? 'px-3.5 py-2 text-[13px]' : 'px-4 py-2.5 text-[14px]'}`}
      style={{
        borderColor: on ? 'rgba(212,175,55,0.55)' : '#1c1c1e',
        background: on ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.015)',
        color: on ? '#f0dc9a' : 'rgba(255,255,255,0.6)',
        fontWeight: on ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

