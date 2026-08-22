'use client';

// Full settings page for the trader. Five sections along the right rail
// (RTL), the active one paints in the main pane. Every field maps to a
// UserSettings key and persists through the same hydrateDoc / saveDoc
// pipeline the rest of the app uses — so a change here also propagates
// to other tabs and to the trader's other devices via user_collections.
//
// Clerk-owned fields (name, email, avatar) render read-only pulled from
// useUser(); a link opens Clerk's own profile modal for changing them so
// we never mirror or intercept identity data.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUser, useClerk, SignOutButton } from '@clerk/nextjs';
import { hydrateDoc, saveDoc } from '../lib/sync/collections';
import { usePlan } from './PlanProvider';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_KIND, withDefaults,
  type UserSettings, type TradingStyle,
} from '../lib/settings/types';
import { INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { ZONES, clockInZone, zoneShortName } from '../lib/time/zone';
import {
  DEFAULT_SESSIONS, hourLabel, overlappingSessions, parseHourLabel, type SessionDef,
} from '../lib/sessions';

type SectionKey = 'profile' | 'trading' | 'account';

const SECTIONS: { key: SectionKey; label: string; hint: string; icon: string }[] = [
  { key: 'profile',       label: 'פרופיל',   hint: 'איך המערכת פונה אליך', icon: '◉' },
  { key: 'trading',       label: 'מסחר',     hint: 'ברירות מחדל, שעון וקנה מידה', icon: '⇅' },
  { key: 'account',       label: 'חשבון',    hint: 'מסלול, יציאה, מחיקה',    icon: '⌘' },
];

const TRADING_STYLE_LABEL: Record<TradingStyle, string> = {
  scalper: 'סקאלפר · שניות עד דקות',
  day:     'סוחר יום · יוצא באותו יום',
  swing:   'סווינג · ימים עד שבועות',
  position:'פוזיציה · שבועות ומעלה',
};

export default function SettingsView() {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  const { role } = usePlan();

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [section, setSection]   = useState<SectionKey>('profile');
  const [saved, setSaved]       = useState(false);
  /** The last saved state. Anything different from this is unsaved work, and
   *  comparing against it — rather than tracking a boolean — means undoing an
   *  edit by hand correctly clears the dirty flag. */
  const [baseline, setBaseline] = useState<UserSettings>(DEFAULT_SETTINGS);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cloud hydrate on mount — same shape as every other synced doc in the app.
  useEffect(() => {
    hydrateDoc<UserSettings>(SETTINGS_KIND, SETTINGS_KEY)
      .then(doc => {
        if (!doc) return;
        const full = withDefaults(doc);
        setSettings(full);
        setBaseline(full);
      })
      .catch(() => { /* keep defaults on failure */ });
  }, []);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // NOTHING SAVES ON ITS OWN.
  //
  // This page used to write 500ms after every keystroke. That is fine for a
  // toggle and wrong for everything else here: a half-typed nickname, a bio
  // abandoned mid-sentence, and a timezone scrolled past on the way to the one
  // below it were all committed and synced to every device. The trader now says
  // when they are done.
  const dirty = useMemo(
    () => JSON.stringify({ ...settings, updatedAt: 0 }) !== JSON.stringify({ ...baseline, updatedAt: 0 }),
    [settings, baseline],
  );

  function save() {
    const stamped = { ...settings, updatedAt: Date.now() };
    void saveDoc(SETTINGS_KIND, SETTINGS_KEY, stamped);
    setSettings(stamped);
    setBaseline(stamped);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  function revert() {
    setSettings(baseline);
    setSaved(false);
  }

  // Leaving with unsaved changes should cost a confirmation, not the changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const displayName = useMemo(() => {
    return settings.nickname || user?.firstName || user?.username || 'סוחר';
  }, [settings.nickname, user]);

  function patch<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  const activeSection = SECTIONS.find(s => s.key === section)!;

  return (
    <div
      dir="rtl"
      className="flex-1 overflow-y-auto"
      style={{
        background: `
          radial-gradient(60% 60% at 0% 10%, rgba(212,175,55,0.05), transparent 70%),
          radial-gradient(60% 60% at 100% 90%, rgba(122,143,168,0.04), transparent 70%),
          #050505
        `,
      }}
    >
      {/* Header */}
      <div className="border-b border-[#1c1c1e]">
        <div className="max-w-[1400px] mx-auto py-11 px-10 max-[880px]:px-5 max-[880px]:py-7">
          <div className="font-mono text-[12px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-3.5">SETTINGS</div>
          <h1 style={{ fontFamily: 'var(--serif)' }} className="text-[46px] max-[880px]:text-[32px] font-bold text-white leading-[1.02] m-0">הגדרות</h1>
          <p className="mt-3 text-[15px] text-white/60 max-w-[540px] leading-relaxed">
            כל מה שצריך כדי שהמערכת תרגיש שלך — מהצורה שהמאמן פונה אליך ועד ברירות המחדל של הטופס.
            {' '}
            <span className="text-white/40">שינויים נשמרים רק כשתלחץ שמירה, ואז מסונכרנים בין המכשירים שלך.</span>
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1400px] mx-auto py-10 px-10 max-[880px]:px-4 max-[880px]:py-6">
        <div className="grid grid-cols-[260px_1fr] max-[880px]:grid-cols-1 gap-8">
          {/* Left rail (in RTL, visually right) */}
          <aside>
            <nav className="flex flex-col gap-1.5 sticky top-6">
              {SECTIONS.map(s => {
                const active = s.key === section;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSection(s.key)}
                    className="text-right py-3 px-4 rounded-[10px] border transition-all duration-200"
                    style={{
                      borderColor: active ? 'rgba(212,175,55,0.35)' : 'rgba(28,28,30,1)',
                      background: active ? 'rgba(212,175,55,0.08)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[15px]" style={{ color: active ? '#d4af37' : 'rgba(255,255,255,0.35)' }}>{s.icon}</span>
                      <div className="flex-1">
                        <div className="text-[14px] font-bold" style={{ color: active ? '#fff' : 'rgba(255,255,255,0.7)' }}>{s.label}</div>
                        <div className="text-[11.5px] text-white/40 mt-0.5">{s.hint}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <main className="min-w-0">
            <div className="rounded-[16px] border border-[#1c1c1e] bg-[#0a0a0b] p-8 max-[880px]:p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.8)]">
              <SectionHeader title={activeSection.label} eyebrow={activeSection.icon + ' · ' + activeSection.hint} saved={saved} dirty={dirty} />

              {section === 'profile' && (
                <div className="flex flex-col gap-6 mt-8">
                  <ProfileCard user={user} loaded={isLoaded} displayName={displayName} onManage={() => clerk.openUserProfile()} />
                  <Field label="כינוי לתצוגה" hint="ככה המאמן והמערכת יפנו אליך. ריק = השם מ-Clerk.">
                    <TextInput value={settings.nickname} onChange={v => patch('nickname', v)} placeholder={user?.firstName ?? 'הכנס כינוי'} maxLength={40} />
                  </Field>
                  <Field
                    label="ביו"
                    hint="מי אתה כסוחר — ניסיון, מה אתה סוחר, באילו שעות, איך אתה עובד ומה אתה מנסה לתקן. זה נשלח למאמן ולתובנה היומית כרקע קבוע עליך, כך שהם לא מנתחים אותך מאפס בכל פעם. עובדות בלבד: מספרים על הביצועים תמיד נלקחים מהיומן, לא מכאן."
                  >
                    <TextArea
                      value={settings.bio}
                      onChange={v => patch('bio', v)}
                      placeholder="סוחר חוזים עתידיים על NQ ו-ES, שנתיים בשוק. סוחר בעיקר NY AM ומדי פעם לונדון, מודלים של ICT — סוויפ נזילות ו-FVG. עובד עם סיכון קבוע לעסקה ומנסה להפסיק לצאת מוקדם מהיעד."
                      maxLength={600}
                    />
                  </Field>
                  <Field label="סגנון מסחר" hint="עוזר למאמן לדעת אם לחשוב במונחי דקות או ימים.">
                    <PillGroup
                      value={settings.tradingStyle}
                      onChange={v => patch('tradingStyle', v)}
                      options={(['scalper','day','swing','position'] as TradingStyle[]).map(k => ({ value: k, label: TRADING_STYLE_LABEL[k] }))}
                    />
                  </Field>
                </div>
              )}

              {section === 'trading' && (
                <div className="flex flex-col gap-6 mt-8">
                  <Field label="מכשיר ברירת מחדל" hint="הטופס של עסקה חדשה יפתח עם המכשיר הזה מסומן.">
                    <PillGroup
                      value={settings.defaultSymbol}
                      onChange={v => patch('defaultSymbol', v as InstrumentKey)}
                      options={Object.keys(INSTRUMENTS).map(k => ({ value: k, label: k }))}
                    />
                  </Field>
                  <Field label="יתרת חשבון התחלתית ($)" hint="עוגן לעקומת ההון בדשבורד ולחישוב ה-drawdown.">
                    <NumericInput value={settings.accountStartUsd} onChange={v => patch('accountStartUsd', v)} min={100} step={500} suffix="USD" />
                  </Field>
                  <Field label="יחידת תצוגה" hint="איך סטטיסטיקות P&L מוצגות בדשבורד ובכרטיסי העסקאות.">
                    <PillGroup
                      value={settings.displayUnit}
                      onChange={v => patch('displayUnit', v as UserSettings['displayUnit'])}
                      options={[
                        { value: 'dollar',  label: '$ Dollar' },
                        { value: 'r',       label: 'R' },
                        { value: 'percent', label: '%' },
                        { value: 'points',  label: 'Points' },
                        { value: 'ticks',   label: 'Ticks' },
                      ]}
                    />
                  </Field>
                  <Field label="אזור זמן" hint="השעון שהמערכת פועלת לפיו: איזה סשן פתוח עכשיו, לאיזה יום עסקה חדשה נרשמת, ובאיזו שעה היא מתועדת.">
                    <ZonePicker value={settings.timezone} onChange={v => patch('timezone', v)} />
                  </Field>
                  <Field
                    label="סשנים"
                    hint="החלונות שלפיהם המערכת מסווגת כל עסקה. אפשר לכבות סשן שאתה לא סוחר, לשנות שעות, ולהוסיף חלון משלך. השעות הן לפי אזור הזמן שלמעלה."
                  >
                    <SessionEditor
                      value={settings.sessions}
                      zone={settings.timezone}
                      onChange={v => patch('sessions', v)}
                    />
                  </Field>
                </div>
              )}

              {section === 'account' && (
                <div className="flex flex-col gap-6 mt-8">
                  <div className="rounded-[12px] border border-[#d4af37]/25 bg-[#d4af37]/[0.04] p-5">
                    <div className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-[#d4af37] mb-2">מסלול נוכחי</div>
                    <div className="text-[22px] font-bold text-white capitalize">{role}</div>
                    <p className="text-[13px] text-white/60 mt-2">
                      {role === 'free' ? 'תובנות AI מתקדמות וכלים לניתוח דפוסים חסומים במסלול חינמי.' :
                       role === 'deluxe' ? 'יש לך גישה מלאה לתובנות AI היומיות ולמאמן.' :
                       'גישה מלאה לכל הפיצ׳רים כולל אנליטיקה מתקדמת.'}
                    </p>
                    {role === 'free' && (
                      <a href="/checkout" className="inline-flex items-center gap-2 mt-4 py-2.5 px-5 rounded-[8px] bg-[#d4af37] text-black font-mono text-[12px] font-bold uppercase tracking-[0.08em] hover:bg-[#e5c84a] transition-colors">
                        שדרוג למסלול Pro →
                      </a>
                    )}
                  </div>

                  <div className="rounded-[12px] border border-[#1c1c1e] bg-white/[0.02] p-5">
                    <div className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/60 mb-2">חשבון</div>
                    <div className="text-[15px] text-white">{user?.primaryEmailAddress?.emailAddress ?? '—'}</div>
                    <p className="text-[13px] text-white/50 mt-2">הזהות שלך מנוהלת דרך Clerk. שינוי אימייל/סיסמה מתבצע בפרופיל של Clerk.</p>
                    <div className="flex gap-2 mt-4 flex-wrap">
                      <button
                        type="button"
                        onClick={() => clerk.openUserProfile()}
                        className="inline-flex items-center gap-2 py-2.5 px-5 rounded-[8px] border border-[#2a2a2d] text-white/80 text-[12px] font-bold hover:text-white hover:border-white/25 transition-colors"
                      >
                        ניהול פרופיל
                      </button>
                      <SignOutButton>
                        <button className="inline-flex items-center gap-2 py-2.5 px-5 rounded-[8px] border border-[#8b3a3a]/45 text-[#f0899e] text-[12px] font-bold hover:bg-[#8b3a3a]/10 transition-colors">
                          התנתקות
                        </button>
                      </SignOutButton>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* The save bar. Present on every section, and it states which of
                the three states the page is in rather than leaving the trader
                to guess whether their edit took. */}
            <div
              className="mt-5 flex items-center gap-3 flex-wrap rounded-[14px] border px-5 py-4 transition-colors duration-200"
              style={{
                borderColor: dirty ? 'rgba(212,175,55,0.35)' : '#1c1c1e',
                background: dirty ? 'rgba(212,175,55,0.05)' : '#0a0a0b',
              }}
            >
              <button
                type="button"
                onClick={save}
                disabled={!dirty}
                className="rounded-sm px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.16em] transition-all duration-200"
                style={{
                  background: dirty ? '#d4af37' : 'transparent',
                  color: dirty ? '#000' : 'rgba(255,255,255,0.3)',
                  border: `1px solid ${dirty ? '#d4af37' : '#1c1c1e'}`,
                  cursor: dirty ? 'pointer' : 'not-allowed',
                  boxShadow: dirty ? '0 0 24px rgba(212,175,55,0.35)' : 'none',
                }}
              >
                שמירת שינויים
              </button>

              {dirty && (
                <button
                  type="button"
                  onClick={revert}
                  className="rounded-sm px-4 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-white/40 hover:text-white/70 border border-[#1c1c1e] transition-colors duration-200"
                >
                  ביטול שינויים
                </button>
              )}

              <span className="text-[12.5px] mr-auto" style={{ color: dirty ? '#d4af37' : 'rgba(255,255,255,0.35)' }}>
                {dirty ? 'יש שינויים שלא נשמרו' : saved ? 'נשמר וסונכרן' : 'הכל שמור'}
              </span>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ── Building blocks ─────────────────────────────────────────────────── */

function SectionHeader({ title, eyebrow, saved, dirty }: { title: string; eyebrow: string; saved: boolean; dirty: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#1c1c1e]">
      <div>
        <div className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-[#d4af37] mb-2">{eyebrow}</div>
        <h2 style={{ fontFamily: 'var(--serif)' }} className="text-[28px] font-bold text-white m-0 leading-none">{title}</h2>
      </div>
      <div className="shrink-0 min-w-[80px] text-left" aria-live="polite">
        {dirty && (
          <span className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-full text-[11px] font-bold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/35">
            <span>●</span> לא נשמר
          </span>
        )}
        {!dirty && saved && (
          <span className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-full text-[11px] font-bold text-[#5fd39e] bg-[#5fd39e]/10 border border-[#5fd39e]/35">
            <span>✓</span> נשמר
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[14px] font-bold text-white mb-1.5">{label}</div>
      {hint && <div className="text-[12.5px] text-white/45 mb-3">{hint}</div>}
      {children}
    </div>
  );
}

function TextInput({
  value, onChange, placeholder, maxLength,
}: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-full bg-white/[0.03] border border-[#2a2a2d] rounded-[8px] py-2.5 px-3.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-[#d4af37]/45 focus:bg-[#d4af37]/[0.04] transition-colors"
      dir="rtl"
    />
  );
}

function TextArea({
  value, onChange, placeholder, maxLength,
}: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  return (
    <div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        className="w-full bg-white/[0.03] border border-[#2a2a2d] rounded-[8px] py-2.5 px-3.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-[#d4af37]/45 focus:bg-[#d4af37]/[0.04] transition-colors resize-none leading-relaxed"
        dir="rtl"
      />
      {maxLength && (
        <div className="text-left mt-1 font-mono text-[11px] text-white/30 tabular-nums">
          {value.length} / {maxLength}
        </div>
      )}
    </div>
  );
}

function NumericInput({
  value, onChange, min, step, suffix,
}: { value: number; onChange: (v: number) => void; min?: number; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value) || 0)}
        min={min}
        step={step}
        className="w-full bg-white/[0.03] border border-[#2a2a2d] rounded-[8px] py-2.5 px-3.5 text-[14px] text-white font-mono tabular-nums focus:outline-none focus:border-[#d4af37]/45 focus:bg-[#d4af37]/[0.04] transition-colors"
        dir="ltr"
        style={{ textAlign: 'right' }}
      />
      {suffix && (
        <span className="absolute inset-y-0 start-3.5 flex items-center font-mono text-[12px] font-bold text-white/40 pointer-events-none">{suffix}</span>
      )}
    </div>
  );
}

function PillGroup<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="py-2 px-3.5 rounded-[8px] border text-[13px] font-bold transition-all duration-200"
            style={{
              borderColor: active ? 'rgba(212,175,55,0.45)' : 'rgba(42,42,45,1)',
              background: active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.02)',
              color: active ? '#d4af37' : 'rgba(255,255,255,0.65)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The timezone control.
 *
 *  A `select` over real IANA identifiers, not a text box. The previous field
 *  accepted any string, stored it, and was read by nothing — so it could say
 *  one thing while the app ran on another. The live clock underneath is the
 *  proof the choice took: it is rendered through the same helper the session
 *  detector uses, so if it shows the wrong hour, the sessions are wrong too. */
// ─────────────────────────────────────────────────────────────────────────────
// The session editor.
//
// Sessions used to be four constants. They are the trader's now: a scalper who
// never touches New York PM switches it off, and a trader whose London starts
// at 08:00 moves it. Everything downstream — which session a trade is filed
// under, every per-session breakdown, "what is open right now" — reads what is
// set here.
//
// Two decisions worth keeping:
//
//   · Switching a session OFF does not delete it. Trades already filed under it
//     keep their name; only new trades stop being matched to it.
//   · An overlap is warned about, never blocked. A trade lands in the first
//     window that matches, so an overlap is legible rather than broken — and a
//     trader mid-edit should not be stopped by a state they are passing through.
// ─────────────────────────────────────────────────────────────────────────────

function SessionEditor({
  value, zone, onChange,
}: { value: SessionDef[]; zone: string; onChange: (v: SessionDef[]) => void }) {
  const rows = value.length > 0 ? value : DEFAULT_SESSIONS;
  const clashes = overlappingSessions(rows);
  const clashing = new Set(clashes.flat());

  const edit = (key: string, patch: Partial<SessionDef>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const remove = (key: string) => onChange(rows.filter(r => r.key !== key));

  const add = () => {
    const key = `custom_${Date.now().toString(36)}`;
    onChange([...rows, { key, he: 'סשן חדש', en: 'CUSTOM', start: 8, end: 10, enabled: true }]);
  };

  const isDefault =
    rows.length === DEFAULT_SESSIONS.length &&
    rows.every((r, i) => {
      const d = DEFAULT_SESSIONS[i];
      return d && r.key === d.key && r.he === d.he && r.start === d.start && r.end === d.end && r.enabled;
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-[12px] border border-[#1c1c1e] overflow-hidden">
        {/* Header — mono labels over the columns the rows fill. */}
        <div
          className="hidden sm:grid items-center gap-3 px-4 py-2.5 bg-[#0a0a0b] border-b border-[#1c1c1e] font-mono text-[9.5px] font-bold tracking-[0.18em] text-white/30"
          style={{ gridTemplateColumns: '38px minmax(0,1fr) 92px 92px 34px' }}
        >
          <span>פעיל</span><span>שם</span><span>משעה</span><span>עד שעה</span><span />
        </div>

        {rows.map(row => (
          <div
            key={row.key}
            className="grid items-center gap-3 px-4 py-3 border-b border-[#1c1c1e] last:border-0 transition-colors"
            style={{ gridTemplateColumns: '38px minmax(0,1fr) 92px 92px 34px' }}
            data-off={!row.enabled}
          >
            <Switch on={row.enabled} onToggle={() => edit(row.key, { enabled: !row.enabled })} label={row.he} />

            <input
              type="text"
              value={row.he}
              onChange={e => edit(row.key, { he: e.target.value })}
              maxLength={28}
              className="min-w-0 bg-transparent border border-transparent hover:border-[#2a2a2d] focus:border-[#d4af37]/45 rounded-[6px] py-1.5 px-2 text-[14px] font-bold text-white focus:outline-none focus:bg-[#d4af37]/[0.04] transition-colors"
              style={{ opacity: row.enabled ? 1 : 0.45 }}
              dir="rtl"
            />

            <HourInput value={row.start} onChange={v => edit(row.key, { start: v })} dim={!row.enabled} />
            <HourInput value={row.end} onChange={v => edit(row.key, { end: v })} dim={!row.enabled} />

            <button
              type="button"
              onClick={() => remove(row.key)}
              disabled={rows.length <= 1}
              title="מחיקת הסשן"
              aria-label={`מחיקת הסשן ${row.he}`}
              className="w-[34px] h-[30px] grid place-items-center rounded-[6px] border border-transparent text-white/25 hover:text-[#8b3a3a] hover:border-[#8b3a3a]/40 disabled:opacity-25 disabled:hover:text-white/25 disabled:hover:border-transparent transition-colors font-mono text-[13px]"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* A wrapped window is legitimate and easy to mistake for a typo, so it
          is named rather than left to be discovered. */}
      {rows.some(r => r.enabled && r.end <= r.start) && (
        <p className="font-mono text-[10px] tracking-[0.1em] text-white/35">
          ◈ חלון שנגמר לפני שהוא מתחיל ממשיך אל תוך היום הבא — למשל 22:00 עד 02:00.
        </p>
      )}

      {clashes.length > 0 && (
        <p className="font-mono text-[10px] tracking-[0.1em] text-[#d4af37]/80">
          ◈ יש חפיפה בין {clashes.map(([a, b]) =>
            `${rows.find(r => r.key === a)?.he ?? a}–${rows.find(r => r.key === b)?.he ?? b}`).join(' · ')}
          {' '}· עסקה תשויך לסשן הראשון שמתאים לה ברשימה.
        </p>
      )}

      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={add}
          className="py-2 px-3.5 rounded-[8px] border border-[#2a2a2d] hover:border-[#d4af37]/45 hover:text-white text-white/60 font-mono text-[11px] font-bold tracking-[0.1em] transition-colors"
        >
          + הוספת סשן
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_SESSIONS.map(d => ({ ...d })))}
            className="py-2 px-3.5 rounded-[8px] border border-transparent hover:border-[#2a2a2d] text-white/35 hover:text-white/70 font-mono text-[11px] font-bold tracking-[0.1em] transition-colors"
          >
            חזרה לברירת המחדל
          </button>
        )}
        <span className="ms-auto font-mono text-[10px] tracking-[0.14em] text-white/25">
          {clockInZone(zone)} · {zoneShortName(zone)}
        </span>
      </div>
    </div>
  );
}

/** A time field that stays a time field. It holds the trader's raw keystrokes
 *  while they type — "0", "08", "08:" are all states on the way to "08:00" —
 *  and only commits when the text parses, so the value never jumps under the
 *  cursor mid-edit. */
function HourInput({ value, onChange, dim }: { value: number; onChange: (v: number) => void; dim?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? hourLabel(value);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={e => {
        const next = e.target.value;
        setDraft(next);
        const parsed = parseHourLabel(next);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
      placeholder="00:00"
      aria-label="שעה"
      className="w-full bg-white/[0.03] border border-[#2a2a2d] rounded-[6px] py-1.5 px-2 text-[13px] font-mono tabular-nums text-white text-center focus:outline-none focus:border-[#d4af37]/45 focus:bg-[#d4af37]/[0.04] transition-colors"
      style={{ opacity: dim ? 0.45 : 1 }}
      dir="ltr"
    />
  );
}

/** The on/off control. A real button with aria-pressed rather than a styled
 *  checkbox, so it reads correctly to a screen reader and takes focus. */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} — ${on ? 'פעיל' : 'כבוי'}`}
      onClick={onToggle}
      className="relative w-[34px] h-[19px] rounded-full transition-colors shrink-0"
      style={{
        background: on ? 'rgba(212,175,55,0.28)' : 'rgba(255,255,255,0.07)',
        border: `1px solid ${on ? 'rgba(212,175,55,0.5)' : '#2a2a2d'}`,
      }}
    >
      <span
        className="absolute top-1/2 w-[13px] h-[13px] rounded-full transition-all duration-200"
        style={{
          background: on ? '#d4af37' : 'rgba(255,255,255,0.3)',
          boxShadow: on ? '0 0 10px rgba(212,175,55,0.6)' : 'none',
          insetInlineStart: on ? '17px' : '2px',
          transform: 'translateY(-50%)',
        }}
      />
    </button>
  );
}

function ZonePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [now, setNow] = useState(() => clockInZone(value));

  useEffect(() => {
    const tick = () => setNow(clockInZone(value));
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [value]);

  const groups = useMemo(() => {
    const out = new Map<string, typeof ZONES[number][]>();
    for (const z of ZONES) {
      const list = out.get(z.group) ?? [];
      list.push(z);
      out.set(z.group, list);
    }
    return [...out.entries()];
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        dir="rtl"
        className="w-full rounded-sm bg-[#111] border border-[#222] px-3 py-2.5 text-[14px] text-white outline-none focus:border-[#d4af37]/60 transition-colors duration-200"
      >
        {groups.map(([group, zones]) => (
          <optgroup key={group} label={group}>
            {zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
          </optgroup>
        ))}
      </select>
      <div className="flex items-center gap-2 text-[12.5px] text-white/40">
        <span className="text-[#d4af37]">◈</span>
        <span>השעה כרגע באזור שנבחר:</span>
        <span
          className="font-mono font-bold text-white/80"
          style={{ direction: 'ltr', unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums' }}
        >
          {now}
        </span>
        <span className="font-mono" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
          {zoneShortName(value)}
        </span>
      </div>
    </div>
  );
}

function ProfileCard({
  user, loaded, displayName, onManage,
}: {
  user: ReturnType<typeof useUser>['user'];
  loaded: boolean;
  displayName: string;
  onManage: () => void;
}) {
  return (
    <div className="flex items-center gap-4 p-5 rounded-[12px] border border-[#1c1c1e] bg-gradient-to-br from-[#d4af37]/[0.05] to-transparent">
      <div className="w-14 h-14 rounded-full overflow-hidden bg-[#1c1c1e] flex items-center justify-center text-[22px] font-bold text-[#d4af37] shrink-0" style={{ fontFamily: 'var(--serif)' }}>
        {user?.imageUrl
          ? <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
          : (displayName[0] ?? '?').toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[18px] font-bold text-white leading-tight">{loaded ? displayName : '...'}</div>
        <div className="text-[13px] text-white/50 truncate">{user?.primaryEmailAddress?.emailAddress ?? ''}</div>
      </div>
      <button
        type="button"
        onClick={onManage}
        className="shrink-0 py-2 px-3.5 rounded-[8px] border border-[#2a2a2d] text-white/70 text-[12px] font-bold hover:text-white hover:border-white/25 transition-colors"
      >
        ניהול פרופיל
      </button>
    </div>
  );
}
