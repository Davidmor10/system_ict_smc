'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import SplashIntro from '../../components/SplashIntro';
import { activeSessions, sessionIdxForHour } from '../../lib/sessions';
import { activeZone, clockCaption, clockWithSecondsInZone, hourFloatInZone, todayISOInZone, zoneShortName, DEFAULT_TIMEZONE } from '../../lib/time/zone';
import { loadTrades, hydrateTradesFromCloud, tradePnL, type TradeEntry } from '../../lib/journal';
import { hydrateList } from '../../lib/sync/collections';
import { computeRuleStats } from '../../lib/rules/stats';
import { ruleSeverity, ruleTitle, ruleVerification, type Rule, type RuleCheck } from '../../lib/rules/types';
import {
  countdownTo, humanizeMinutes, IMPACT_HE, isNewYorkOpen, NY_CLOSE_HOUR,
  NY_OPEN_HOUR, nextMacro, ruleOfTheDay,
  type MacroLike,
} from '../../lib/entryGate';
import './member.css';

// ─────────────────────────────────────────────────────────────────────────────
// The entry gate — what "/" shows once you are signed in.
//
// Nothing here sells. A person who already pays does not need the pitch. The
// screen does three things, in this order: confirm who is signed in and open
// the door fast (Enter works from anywhere), show the state of the day before
// they commit to it, and offer the two rituals that belong before the open —
// declaring a direction, and reading one rule back.
//
// Every number on this page comes from the trader's own record: the journal for
// the metrics, the rules collection for the rule of the day and the discipline
// streak, the macro feed for the next event, the session table for the clock.
// Where a record does not exist yet — a brand-new account has no rules and no
// trades — the screen says so plainly instead of printing a zero, because a
// zero reads as a result and "nothing logged yet" is not a result.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';
const NO_PLAN = 'free';
const PLAN_LABEL: Record<string, string> = { starter: 'STARTER', pro: 'PRO', deluxe: 'DELUXE' };

const RULES_KEY = 'onyx_trading_rules';
const CHECKS_KEY = 'onyx_rule_checks';
const VIOLATIONS_KEY = 'onyx_rule_violations';

interface LegacyViolation { id: string; ruleId: string; date: string; deleted?: boolean }

const DESTINATIONS = [
  { href: '/dashboard',          title: 'דשבורד', desc: 'התובנה של היום והלוח החודשי' },
  { href: '/dashboard/journal',  title: 'יומן',    desc: 'לתעד עסקה חדשה' },
  { href: '/dashboard/rules',    title: 'חוקים',   desc: 'הכללים שלך ומה נשמר בפועל' },
  { href: '/dashboard/reports',  title: 'מאקרו',   desc: 'אירועים וחדשות שמזיזים את השוק' },
];

/** The app's own Hebrew labels, lifted from the rules page so the two screens
 *  never disagree about what a category is called. */
const CAT_HE: Record<string, string> = {
  discipline: 'משמעת', entry: 'כניסה', trade_mgmt: 'ניהול עסקה',
  risk: 'ניהול סיכון', time: 'זמן', news: 'חדשות', exit: 'ניהול עסקה',
};
const SEV_HE: Record<string, string> = { recommendation: 'המלצה', important: 'חשוב', critical: 'קריטי' };
const VERIFY_HE: Record<string, string> = { automatic: 'אוטומטית', user_report: 'דיווח משתמש' };

const DUST = [
  { bottom: '6%',  right: '18%', size: 4, blur: 1,   color: '#d4af37', dur: 14, delay: 0 },
  { bottom: '2%',  right: '34%', size: 3, blur: 1,   color: '#e3c768', dur: 18, delay: 2.4 },
  { bottom: '10%', right: '52%', size: 5, blur: 2,   color: '#d4af37', dur: 16, delay: 5.1 },
  { bottom: '0%',  right: '66%', size: 3, blur: 1,   color: '#d4af37', dur: 21, delay: 1.2 },
  { bottom: '8%',  right: '80%', size: 4, blur: 1.5, color: '#e3c768', dur: 19, delay: 7.6 },
  { bottom: '4%',  right: '8%',  size: 3, blur: 1,   color: '#d4af37', dur: 23, delay: 3.8 },
];

const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export default function MemberHome({ role, splashScope }: { role: string; splashScope?: string }) {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);

  const [now, setNow] = useState<Date | null>(null);
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [checks, setChecks] = useState<RuleCheck[]>([]);
  const [violations, setViolations] = useState<LegacyViolation[]>([]);
  const [macro, setMacro] = useState<MacroLike[]>([]);
  const [entering, setEntering] = useState(false);
  const [cu, setCu] = useState(0);

  const member = role !== NO_PLAN;
  const name = user?.firstName || user?.username || '';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();

  // ── The clock, and everything that hangs off it ──────────────────────────
  // Mounted-only: the server has no wall clock the client will agree with, so
  // rendering a time during SSR guarantees a hydration mismatch. Until the
  // first tick the time-dependent cells render their placeholder.
  useEffect(() => {
    setNow(new Date());
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── The trader's own record ──────────────────────────────────────────────
  useEffect(() => {
    if (!member) return;
    setTrades(loadTrades());
    hydrateTradesFromCloud().then(merged => { if (merged) setTrades(merged); }).catch(() => {});
    hydrateList<Rule>('rules', RULES_KEY).then(setRules).catch(() => {});
    hydrateList<RuleCheck>('rule_checks', CHECKS_KEY).then(setChecks).catch(() => {});
    hydrateList<LegacyViolation>('violations', VIOLATIONS_KEY).then(setViolations).catch(() => {});
  }, [member]);

  useEffect(() => {
    if (!member) return;
    let alive = true;
    fetch('/api/macro?scope=week')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && Array.isArray(d?.events)) setMacro(d.events as MacroLike[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, [member]);


  // ── Reveal + count-up ────────────────────────────────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const startCount = () => {
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / 1200);
        setCu(1 - Math.pow(1 - p, 3));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const show = (el: Element) => {
      el.classList.add('is-in');
      if (el.hasAttribute('data-count')) startCount();
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach(show);
      setCu(1);
      return;
    }

    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -12% 0px' });
    nodes.forEach(n => io.observe(n));

    // Nothing may ever stay invisible: elements start at opacity 0 in CSS.
    const fb = window.setTimeout(() => nodes.forEach(show), 4000);
    return () => { io.disconnect(); window.clearTimeout(fb); };
  }, [member]);

  // ── Cursor spotlight ─────────────────────────────────────────────────────
  useEffect(() => {
    const hero = heroRef.current, spot = spotRef.current;
    if (!hero || !spot) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia?.('(hover: none)').matches) return;

    const move = (e: MouseEvent) => {
      const r = hero.getBoundingClientRect();
      spot.style.transform = `translate(${e.clientX - r.left - 280}px,${e.clientY - r.top - 280}px)`;
      spot.style.opacity = '1';
    };
    const leave = () => { spot.style.opacity = '0'; };
    hero.addEventListener('mousemove', move);
    hero.addEventListener('mouseleave', leave);
    return () => { hero.removeEventListener('mousemove', move); hero.removeEventListener('mouseleave', leave); };
  }, []);

  // ── Enter ────────────────────────────────────────────────────────────────
  const enter = useCallback(() => {
    if (entering) return;
    setEntering(true);
    window.setTimeout(() => router.push(member ? '/dashboard' : '/pricing'), 1400);
  }, [entering, member, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Enter inside a field or on a focused control means what it always
      // means; it must not also open the door behind the trader's back.
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName)) return;
      if (t?.isContentEditable) return;
      if (e.key === 'Enter') { e.preventDefault(); enter(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter]);

  // ── Derived: clock, session, countdowns ──────────────────────────────────
  const zone = typeof window === 'undefined' ? DEFAULT_TIMEZONE : activeZone();
  const clock = now ? clockWithSecondsInZone(zone, now) : '--:--:--';
  const hourFloat = now ? hourFloatInZone(zone, now) : 0;
  // Indexed against the trader's own enabled windows, which is what
  // sessionIdxForHour matches on — reading SESS here would name the wrong one
  // the moment a session is switched off.
  const sessions = useMemo(() => activeSessions(), []);
  const sessIdx = now ? sessionIdxForHour(hourFloat, sessions) : -1;
  const sessName = now ? (sessIdx >= 0 ? sessions[sessIdx].he : 'מחוץ לסשן') : '—';
  const nyOpen = isNewYorkOpen(hourFloat);
  const tzLabel = clockCaption(zone);

  const nextEvent = useMemo(() => {
    if (!now) return null;
    return nextMacro(macro, todayISOInZone(zone, now), Math.round(hourFloat * 60));
  }, [macro, now, hourFloat, zone]);
  const macroSoon = !!nextEvent && nextEvent.minutes <= 60;

  // ── Derived: the trader's numbers ────────────────────────────────────────

  const pnl30 = useMemo(() => {
    if (!now) return null;
    const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const recent = trades.filter(t => t.result !== 'OPEN' && t.dateISO >= cutoff);
    if (recent.length === 0) return null;
    return recent.reduce((sum, t) => sum + (t.pnlUsd ?? tradePnL(t) ?? 0), 0);
  }, [trades, now]);

  const activeRules = useMemo(() => rules.filter(r => r.isActive && !r.deleted), [rules]);
  const todayISO = now ? todayISOInZone(zone, now) : '';

  const streak = useMemo(() => {
    if (!todayISO || activeRules.length === 0) return null;
    const legacy = violations.filter(v => !v.deleted).map(v => ({ ruleId: v.ruleId, date: v.date }));
    return computeRuleStats(activeRules, trades, checks, todayISO, legacy).streak;
  }, [activeRules, trades, checks, todayISO, violations]);

  const rule = useMemo(() => (now ? ruleOfTheDay(rules, now) : null), [rules, now]);

  const ruleKept = useMemo(() => {
    if (!rule || !todayISO) return null;
    const legacy = violations.filter(v => !v.deleted).map(v => ({ ruleId: v.ruleId, date: v.date }));
    const m = computeRuleStats([rule], trades, checks, todayISO, legacy).month;
    if (m.evaluated === 0) return null;
    return `${m.followed} מתוך ${m.evaluated} ימים`;
  }, [rule, trades, checks, todayISO, violations]);

  const lastTrade = useMemo(() => {
    if (trades.length === 0) return null;
    return [...trades].sort((a, b) =>
      (b.dateISO + b.time).localeCompare(a.dateISO + a.time) || b.id - a.id)[0];
  }, [trades]);

  return (
    <div className="eg" ref={rootRef}>
      {/* The brand moment belongs to the first screen of a visit, whichever
          screen that turns out to be. Behind the login the scope is the Clerk
          session id, so it plays once per sign-in. */}
      <SplashIntro scope={splashScope} />

      <div className="eg-page" data-entering={entering}>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="eg-head">
          <div className="eg-mark">
            <span className="eg-mark-a">Onyx</span>
            <span className="eg-mark-b">TRADING</span>
          </div>

          <div className="eg-sess">
            <span className="eg-dot" aria-hidden />
            <span className="eg-sess-l">סשן פעיל</span>
            <span className="eg-sess-v">{sessName}</span>
            <span className="eg-sess-div" aria-hidden />
            <span className="eg-sess-clock eg-ltr">{clock}</span>
            <span className="eg-sess-tz eg-ltr">{now ? zoneShortName(zone, now) : ''}</span>
          </div>

          <div className="eg-who">
            {email && <span className="eg-email eg-ltr" title={email}>{email}</span>}
            <span className="eg-plan" data-off={!member}>
              {D} {member ? PLAN_LABEL[role] ?? role.toUpperCase() : 'אין מנוי'}
            </span>
            <span className="eg-avatar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : <span>{initial}</span>}
            </span>
          </div>
        </header>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="eg-hero" ref={heroRef}>
          <div className="eg-hero-wash" aria-hidden />
          <div className="eg-hero-grid" aria-hidden />
          <div className="eg-spot" ref={spotRef} aria-hidden />
          <div className="eg-scan" aria-hidden />
          <div className="eg-dust" aria-hidden>
            {DUST.map((d, i) => (
              <span
                key={i}
                style={{
                  bottom: d.bottom, right: d.right, width: d.size, height: d.size,
                  background: d.color, filter: `blur(${d.blur}px)`,
                  animation: `eg-dust ${d.dur}s linear infinite ${d.delay}s`,
                }}
              />
            ))}
          </div>
          <div className="eg-rail" data-side="right" aria-hidden />
          <div className="eg-rail" data-side="left" aria-hidden />

          <div className="eg-hero-in">
            <div className="eg-kicker">
              <i data-side="a" aria-hidden />
              <span className="eg-kicker-t">{D} אתה מחובר · חיבור מאובטח</span>
              <i data-side="b" aria-hidden />
            </div>

            {/* Until Clerk resolves, greet without a name rather than flashing
                a placeholder that then changes under the reader. */}
            <h1 className="eg-h1">
              {isLoaded && name ? `שלום, ${name}.` : 'שלום.'}<br />
              <span className="eg-shimmer">{member ? 'המערכת מחכה לך.' : 'נשאר לבחור מסלול.'}</span>
            </h1>

            <p className="eg-lead">
              {member
                ? 'כל מה שתיעדת שמור. תיכנס להמשיך מאיפה שעצרת, או קפוץ ישר למקום שאתה צריך.'
                : 'ההרשמה הושלמה, אבל עדיין אין מנוי פעיל על החשבון. בחר מסלול והמערכת נפתחת מיד.'}
            </p>

            <div className="eg-cta-wrap">
              <div className="eg-cta-row">
                <span className="eg-halo" aria-hidden />
                <div className="eg-btns">
                  <button type="button" className="eg-btn eg-btn-primary" onClick={enter}>
                    {member ? 'כניסה למערכת' : 'בחירת מסלול'}
                    <span aria-hidden>←</span>
                  </button>
                  <Link
                    href={member ? '/dashboard/journal' : '/checkout'}
                    className="eg-btn eg-btn-secondary"
                  >
                    {member ? 'לתעד עסקה' : 'להשלמת התשלום'}
                  </Link>
                </div>
              </div>
              <span className="eg-hint">
                או הקש <kbd>Enter</kbd>
              </span>
            </div>

            <div className="eg-strip">
              <div className="eg-cell">
                <span className="eg-cell-l">{tzLabel}</span>
                <span className="eg-cell-v eg-ltr">{clock}</span>
                <span className="eg-cell-s" data-gold="true">{sessName}</span>
              </div>

              <div className="eg-cell">
                <span className="eg-cell-l">{nyOpen ? 'ניו יורק · סגירה בעוד' : 'פתיחת ניו יורק בעוד'}</span>
                <span className="eg-cell-v eg-ltr" data-gold="true">
                  {now ? countdownTo(nyOpen ? NY_CLOSE_HOUR : NY_OPEN_HOUR, hourFloat) : '--:--:--'}
                </span>
                <span className="eg-cell-s">{nyOpen ? 'השוק פתוח · נזילות גבוהה' : 'ES · NQ · CME'}</span>
              </div>

              <div className="eg-cell" data-soon={macroSoon}>
                <span className="eg-cell-l"><i aria-hidden />אירוע מאקרו הבא</span>
                {nextEvent ? (
                  <>
                    <span className="eg-cell-v eg-ltr" data-serif="true" title={nextEvent.event.title}>
                      {nextEvent.event.title}
                    </span>
                    <span className="eg-cell-s">
                      {humanizeMinutes(nextEvent.minutes)} · השפעה {IMPACT_HE[nextEvent.event.impact] ?? nextEvent.event.impact}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="eg-cell-v" data-serif="true">אין אירוע קרוב</span>
                    <span className="eg-cell-s">לוח האירועים פנוי</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {member && (
            <div className="eg-cue" aria-hidden>
              <span className="eg-cue-l">התדריך של היום</span>
              <span className="eg-cue-track"><i /></span>
            </div>
          )}
        </section>

        {/* Everything below the hero is the member's own record. Without a
            subscription there is nothing to show and every door is shut, so
            the screen ends at the hero rather than listing what is locked. */}
        {member && (
          <>
            <section className="eg-brief">
              <div className="eg-brief-grid">

                {/* ── Rule of the day ─────────────────────────────────── */}
                <div className="eg-rule" data-reveal>
                  <span className="eg-rule-k">{D} כלל היום<i aria-hidden /></span>

                  {rule ? (
                    <>
                      <p className="eg-rule-t">{ruleTitle(rule)}</p>
                      {rule.reason && <p className="eg-rule-r">{rule.reason}</p>}
                      <div className="eg-rule-meta">
                        <span className="eg-meta">
                          <span className="eg-meta-l">קטגוריה</span>
                          <span className="eg-meta-v">{CAT_HE[rule.category] ?? rule.category}</span>
                        </span>
                        <span className="eg-meta">
                          <span className="eg-meta-l">חומרה</span>
                          <span className="eg-meta-v" data-tone="gold">{SEV_HE[ruleSeverity(rule)]}</span>
                        </span>
                        <span className="eg-meta">
                          <span className="eg-meta-l">אימות</span>
                          <span className="eg-meta-v">{VERIFY_HE[ruleVerification(rule)]}</span>
                        </span>
                        <span className="eg-meta">
                          <span className="eg-meta-l">נשמר בפועל</span>
                          <span className="eg-meta-v" data-tone="bull">{ruleKept ?? 'אין עדיין מדידה'}</span>
                        </span>
                      </div>
                      <Link href="/dashboard/rules" className="eg-rule-src">
                        מוצג חוק אחד ביום מתוך החוקים הפעילים שלך · {activeRules.length} פעילים · לדף החוקים ←
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="eg-rule-t">עוד לא כתבת חוקים.</p>
                      <p className="eg-rule-r">
                        כלל היום נבחר מתוך החוקים שאתה כותב לעצמך — אחד ליום, לפי סדר קבוע. כשיהיה
                        לך חוק פעיל אחד, הוא יופיע כאן בכל בוקר, יחד עם כמה ימים באמת עמדת בו.
                      </p>
                      <Link href="/dashboard/rules" className="eg-rule-src">לכתוב את החוק הראשון ←</Link>
                    </>
                  )}
                </div>

                {/* ── Status column ───────────────────────────────────── */}
                <div className="eg-status" data-reveal data-count>
                  <span className="eg-row">
                    <span className="eg-row-l">
                      <span className="eg-row-k">משמעת רצופה</span>
                      <span className="eg-row-s">ימים לפי הכללים</span>
                    </span>
                    <span className="eg-streak eg-ltr">
                      {streak === null ? '—' : Math.round(streak * cu)}
                    </span>
                  </span>

                  {/* Win rate and profit factor used to sit here as well.
                      They are the dashboard's numbers, and a doorway that
                      quotes them is a second place for the same figure to be
                      read — and eventually to disagree. What stays is what
                      this screen alone can say: the streak, and the last
                      thirty days as a single line. */}
                  <span className="eg-metric">
                    <span className="eg-metric-l eg-ltr">PNL · 30D</span>
                    <span
                      className="eg-metric-v eg-ltr"
                      data-tone={pnl30 === null ? 'muted' : pnl30 >= 0 ? 'bull' : 'bear'}
                    >
                      {pnl30 === null ? '—' : money(pnl30 * cu)}
                    </span>
                  </span>

                  <Link href="/dashboard/stats" className="eg-status-link">לסטטיסטיקה המלאה ←</Link>
                </div>
              </div>
            </section>

            {/* ── Destinations ─────────────────────────────────────────── */}
            <section className="eg-dest">
              <div className="eg-dest-in">
                <Link href="/dashboard/journal" className="eg-continue" data-reveal>
                  <span className="eg-continue-l">
                    <span className="eg-continue-k">{D} המשך מאיפה שעצרת</span>
                    <span className="eg-continue-t">
                      {lastTrade ? 'העסקה האחרונה שתיעדת ביומן' : 'עוד לא תיעדת עסקה'}
                    </span>
                    {lastTrade ? (
                      <span className="eg-continue-s eg-ltr">
                        {lastTrade.symbol} · {lastTrade.direction} · {lastTrade.session}
                        {lastTrade.tradeR != null ? ` · ${lastTrade.tradeR > 0 ? '+' : ''}${lastTrade.tradeR.toFixed(1)}R` : ''}
                      </span>
                    ) : (
                      <span className="eg-continue-s">שתי דקות, והיומן מתחיל לעבוד בשבילך</span>
                    )}
                  </span>
                  <span className="eg-continue-a" aria-hidden>←</span>
                </Link>

                {DESTINATIONS.map((d, i) => (
                  <Link key={d.href} href={d.href} className="eg-link" data-reveal>
                    <span className="eg-link-n eg-ltr">{String(i + 1).padStart(2, '0')}</span>
                    <span className="eg-link-t">{d.title}</span>
                    <span className="eg-link-d">{d.desc}</span>
                    <span className="eg-link-a" aria-hidden>←</span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer className="eg-foot">
          <span className="eg-foot-l">מסחר כולל סיכון · הכלים לשימוש לימודי בלבד</span>
          <span className="eg-foot-r">
            {member && <Link href="/dashboard/settings" className="eg-foot-a">הגדרות חשבון</Link>}
            <button type="button" className="eg-signout" onClick={() => signOut({ redirectUrl: '/' })}>
              התנתקות
            </button>
          </span>
        </footer>
      </div>

      {entering && (
        <div className="eg-vault">
          <div className="eg-vault-glow" aria-hidden />
          <div className="eg-vault-wipe" aria-hidden />
          {/* dir=ltr: the lockup is Latin and must read ONYX → Trading. Left in
              the page's RTL flow it renders in the other order. */}
          <div className="eg-vault-mark" dir="ltr">
            <span className="eg-vault-a">ONYX</span>
            <span className="eg-vault-bar" aria-hidden />
            <span className="eg-vault-b">Trading</span>
          </div>
          <div className="eg-vault-track"><i /></div>
          <span className="eg-vault-t">
            מאמת הרשאות · {member ? PLAN_LABEL[role] ?? role.toUpperCase() : 'ללא מנוי'}
          </span>
        </div>
      )}
    </div>
  );
}

