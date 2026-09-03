'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The checkout, recreated from the design handoff.
//
// Two screens behind two pieces of state: which plan is selected, and whether
// we are on plans or payment. Nothing else — the owner's verification panel
// used to be a third screen here behind a toggle, and it now lives at
// /dashboard/payments, so this file carries no other customer's data at all.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLANS, PLAN_DISPLAY_ORDER, isVerificationValid,
  type PaymentRequest, type PlanKey, type RequestStatus,
} from '../../lib/payments/plans';
import { STATUS_COPY } from './statusCopy';

/** How often a pending request asks whether it has been decided.
 *
 *  Ten seconds: the customer is sitting on this screen having just paid, and
 *  the wait is measured in the minutes it takes the owner to check their Bit
 *  app. Cheap — one row, by session, and it stops the moment an answer lands. */
const POLL_MS = 10_000;

/** Where the per-plan Bit QR images live once they are supplied. Absent for
 *  now, and the frame says so rather than showing a broken image. */
const QR_SRC: Record<PlanKey, string> = {
  starter: '/bit/bit-qr-starter.png',
  pro: '/bit/bit-qr-pro.png',
  deluxe: '/bit/bit-qr-deluxe.png',
};

export interface CheckoutFlowProps {
  /** The trader's own latest request, for the status card on reload. */
  myRequest: PaymentRequest | null;
  /** Pre-fills the verification form. */
  defaultName: string;
  defaultEmail: string;
  /** From ?plan= on the marketing link. */
  initialPlan: PlanKey;
  /** Supplied once the owner has them; rendered as — until then. */
  bitNumber: string | null;
  bitPayee: string | null;
  /** The owner's uploaded codes, one per plan, as data URIs. */
  qr: Record<string, string | null>;
  /** Legacy files in /public/bit, for a deployment that had them. */
  qrFilesPresent: boolean;
}

export default function CheckoutFlow({
  myRequest, defaultName, defaultEmail,
  initialPlan, bitNumber, bitPayee, qr, qrFilesPresent,
}: CheckoutFlowProps) {
  const [plan, setPlan] = useState<PlanKey>(initialPlan);
  const [step, setStep] = useState<'plans' | 'pay'>('plans');
  const [fullName, setFullName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [mine, setMine] = useState<PaymentRequest | null>(myRequest);
  const [confirmed, setConfirmed] = useState(myRequest !== null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── the decision has to arrive on its own ──────────────────────────────
  //
  // The status card was rendered once, from the server, at page load. The
  // owner then decides in the admin panel and this screen keeps saying
  // "waiting" until the customer happens to reload — which after a rejection
  // means sitting still for access that is never coming, and after an approval
  // means having paid and been shown nothing.
  //
  // Polls only while a request is actually pending, and stops the moment a
  // decision lands. Coming back to the tab checks immediately, because that is
  // when a customer looks.
  const pendingId = mine && mine.status === 'pending' ? mine.id : null;
  const seen = useRef(pendingId);
  seen.current = pendingId;

  useEffect(() => {
    if (!pendingId) return;
    let alive = true;

    const check = async () => {
      if (!alive || seen.current === null || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/payment-requests/mine', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const fresh = data?.request as PaymentRequest | null | undefined;
        if (!alive || !fresh) return;
        // Only ever move this card forward. A late answer to an older poll
        // must not put a decided request back to pending.
        if (fresh.id === pendingId && fresh.status !== 'pending') {
          setMine(fresh);
          setConfirmed(true);
        }
      } catch { /* a failed poll is a poll that did not happen */ }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void check(), POLL_MS);
    void check();

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [pendingId]);

  const selected = PLANS[plan];
  const valid = isVerificationValid(fullName, email);

  const summary = useMemo(
    () => (mine ? `${mine.name} · ${mine.email} · ${PLANS[mine.plan].name} · ${mine.amount} ₪` : ''),
    [mine],
  );

  /** Editing either field after submitting hides the card, so a resubmission
   *  is explicit rather than the old status quietly standing over new text. */
  const edit = useCallback((set: (v: string) => void) => (v: string) => {
    set(v);
    setConfirmed(false);
    setSendError(null);
  }, []);

  async function submit() {
    if (!valid || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/payment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), email: email.trim(), plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSendError('כבר קיימת בקשה ממתינה בחשבון הזה. היא תיבדק ידנית.');
        return;
      }
      if (!res.ok || !data?.request) {
        setSendError('השליחה נכשלה. נסה שוב בעוד רגע.');
        return;
      }
      setMine(data.request as PaymentRequest);
      setConfirmed(true);
    } catch {
      setSendError('השליחה נכשלה. נסה שוב בעוד רגע.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ck" dir="rtl">
      {step === 'plans' ? (
        <PlansScreen plan={plan} onPick={setPlan} onContinue={() => { setStep('pay'); }} />
      ) : (
        <PayScreen
          plan={selected.key}
          onBack={() => setStep('plans')}
          fullName={fullName}
          email={email}
          onName={edit(setFullName)}
          onEmail={edit(setEmail)}
          valid={valid}
          sending={sending}
          onSubmit={submit}
          confirmed={confirmed}
          status={mine?.status ?? 'pending'}
          summary={summary}
          sendError={sendError}
          bitNumber={bitNumber}
          bitPayee={bitPayee}
          qr={qr[selected.key] ?? null}
          qrFilesPresent={qrFilesPresent}
        />
      )}
    </div>
  );
}

/* ── Plan selection ───────────────────────────────────────────────────────── */

function PlansScreen({
  plan, onPick, onContinue,
}: { plan: PlanKey; onPick: (p: PlanKey) => void; onContinue: () => void }) {
  const selected = PLANS[plan];
  // Source order is DELUXE, PRO, STARTER; the grid is RTL, so that renders
  // right to left in the order the handoff specifies.
  const riseFor = (key: PlanKey) => (key === 'pro' ? 'ck-rise' : key === 'deluxe' ? 'ck-rise-2' : 'ck-rise-1');

  return (
    <div className="ck-plans ck-fade">
      <div className="ck-plans-head ck-rise">
        <div className="ck-kicker">CHECKOUT</div>
        <h1 className="ck-h1 ck-h1-plans">שדרוג המערכת</h1>
        <p className="ck-sub">בחר את המסלול שמתאים לך. גישה מיידית לכל הכלים של המוסדיים.</p>
      </div>

      <div className="ck-plan-grid">
        {PLAN_DISPLAY_ORDER.map(key => {
          const p = PLANS[key];
          const isSelected = plan === key;
          return (
            <div className={`ck-plan-slot ${riseFor(key)}`} key={key}>
              {p.featured && <div className="ck-badge">הכי פופולרי</div>}
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onPick(key)}
                className={`ck-plan${p.featured ? ' ck-plan-featured' : ''}`}
              >
                <span className="ck-plan-ring" aria-hidden />
                <span className="ck-plan-kicker">{p.kicker}</span>
                <span className="ck-plan-name">{p.name}</span>
                <p className="ck-plan-blurb">{p.blurb}</p>
                <span className="ck-features">
                  {p.features.map(f => (
                    <span className="ck-feature" key={f}>
                      <span className="ck-feature-mark" aria-hidden>◈</span>
                      <span>{f}</span>
                    </span>
                  ))}
                </span>
                <span className="ck-plan-cta">
                  <span className={`ck-btn ck-btn-lg ${p.featured ? 'ck-btn-primary' : 'ck-btn-secondary'}`}>
                    {isSelected ? 'נבחר ✓' : 'בחר מסלול'}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="ck-summary ck-rise-3">
        <div className="ck-summary-head">
          <div className="ck-label-22">המסלול שנבחר</div>
          <div className="ck-plan-gold">{selected.name}</div>
        </div>
        <div className="ck-row">
          <div className="ck-row-label">חיוב חודשי</div>
          <div className="ck-metric ck-num">{selected.price} ₪</div>
        </div>
        <p className="ck-note">התשלום מתבצע בביט. הגישה נפתחת מיד לאחר אימות ההעברה.</p>
        <button type="button" className="ck-btn ck-btn-lg ck-btn-primary" onClick={onContinue}>
          ← מעבר לתשלום
        </button>
        <div className="ck-foot">תשלום מאובטח · ביטול בכל עת</div>
      </div>
    </div>
  );
}

/* ── Payment ──────────────────────────────────────────────────────────────── */

interface PayScreenProps {
  plan: PlanKey;
  onBack: () => void;
  fullName: string;
  email: string;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
  valid: boolean;
  sending: boolean;
  onSubmit: () => void;
  confirmed: boolean;
  status: RequestStatus;
  summary: string;
  sendError: string | null;
  bitNumber: string | null;
  bitPayee: string | null;
  qr: string | null;
  qrFilesPresent: boolean;
}

function PayScreen(props: PayScreenProps) {
  const p = PLANS[props.plan];
  const st = STATUS_COPY[props.status];
  // The code the customer scans: the owner's upload first, then a legacy file.
  const code = props.qr ?? (props.qrFilesPresent ? QR_SRC[props.plan] : null);
  // Either route is enough. Rendering "—" made a missing configuration look
  // like a design element — a dash inside a gold frame reads as intentional —
  // so the page took declarations for transfers that could not have happened.
  const payable = code !== null || props.bitNumber !== null;

  return (
    <div className="ck-pay ck-fade">
      <div className="ck-pay-top ck-rise">
        <button type="button" className="ck-back" onClick={props.onBack}>← חזרה למסלולים</button>
        <div className="ck-kicker">תשלום</div>
      </div>

      <div className="ck-pay-head ck-rise-1">
        <h1 className="ck-h1 ck-h1-pay">השלמת התשלום</h1>
        <p className="ck-sub">התשלום מתבצע בביט. הגישה נפתחת עם אימות ההעברה.</p>
      </div>

      <div className="ck-pay-grid">
        <div className="ck-pay-main ck-rise-2">
          <div className="ck-method">
            <span style={{ color: 'var(--accent)' }} aria-hidden>◈</span>
            <span className="ck-method-label">תשלום בביט</span>
          </div>

          <div className="ck-bit">
            <span className="ck-sweep" aria-hidden />
            <div className="ck-bit-head">
              <div className="ck-bit-title">סריקה בביט</div>
              <p className="ck-bit-body">
                סרוק את הברקוד באפליקציית ביט והעבר את הסכום החודשי של המסלול שבחרת. בשדה ההערה יש
                לרשום את כתובת המייל שאיתה נרשמת.
              </p>
            </div>

            <div className="ck-bit-row">
              <div className="ck-qr">
                {code ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a data URI or a fixed-size static asset in a 220px frame; no loader to gain from
                  <img src={code} alt={`ברקוד ביט — ${p.name} ${p.price} ₪`} />
                ) : (
                  <div className="ck-qr-missing">ברקוד ביט — {p.name} {p.price} ₪</div>
                )}
              </div>
              <div className="ck-bit-details">
                <div className="ck-detail">
                  <div className="ck-micro">סכום להעברה</div>
                  <div className="ck-amount ck-num">{p.price} ₪</div>
                </div>
                {/* Only when the owner chose to publish them. The number is
                    their personal one, and a customer scanning a code has no
                    need of it — an empty row saying "—" was the whole reason
                    the page looked configured when it was not. */}
                {props.bitNumber && (
                  <div className="ck-detail">
                    <div className="ck-micro">מספר לביט</div>
                    <div className="ck-detail-mono ck-num" dir="ltr">{props.bitNumber}</div>
                  </div>
                )}
                {props.bitPayee && (
                  <div className="ck-detail">
                    <div className="ck-micro">שם המוטב</div>
                    <div className="ck-detail-text">{props.bitPayee}</div>
                  </div>
                )}
              </div>
            </div>

            {!payable && (
              <div className="ck-bit-blocked">
                <b>התשלום במסלול הזה עדיין לא זמין</b>
                עוד לא הוגדר ברקוד למסלול הזה, ולכן אין לאן להעביר. אל תשלח כלום — נסה מסלול אחר, או
                פנה אלינו ונפתח לך את הגישה ידנית.
              </div>
            )}

            <div className="ck-bit-foot">
              ההעברה בביט היא חד-פעמית לחודש. יש לחזור על ההעברה בכל תחילת חודש כדי לשמור על הגישה פתוחה.
            </div>
          </div>
        </div>

        <div className="ck-order ck-rise-3">
          <div className="ck-order-head">סיכום ההזמנה</div>
          <div className="ck-order-row">
            <div className="ck-order-key">מסלול</div>
            <div className="ck-plan-gold" style={{ textShadow: 'none' }}>{p.name}</div>
          </div>
          <div className="ck-order-row">
            <div className="ck-order-key">אמצעי תשלום</div>
            <div className="ck-order-method">ביט</div>
          </div>
          <div className="ck-order-row ck-order-total">
            <div className="ck-order-key">לתשלום חודשי</div>
            <div className="ck-metric ck-num">{p.price} ₪</div>
          </div>

          <div className="ck-verify">
            <div className="ck-verify-label">אחרי ההעברה — מלא את הפרטים כדי שנאמת אותה</div>
            <label className="ck-field">
              <span className="ck-field-label">שם מלא</span>
              <input
                className="ck-input"
                dir="rtl"
                value={props.fullName}
                onChange={e => props.onName(e.target.value)}
                placeholder="ישראל ישראלי"
                autoComplete="name"
              />
            </label>
            <label className="ck-field">
              <span className="ck-field-label">אימייל</span>
              <input
                className="ck-input"
                dir="ltr"
                type="email"
                value={props.email}
                onChange={e => props.onEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
          </div>

          <button
            type="button"
            className="ck-btn ck-btn-lg ck-btn-primary"
            disabled={!props.valid || props.sending || !payable}
            onClick={props.onSubmit}
          >
            {props.sending ? 'שולח…' : 'העברתי את התשלום — שליחה לאימות'}
          </button>

          {/* A declaration of a transfer nobody could have made is worse than
              no button: it puts a request in the owner's queue that can only
              ever be rejected. */}
          {!payable && (
            <div className="ck-status ck-status-rejected">
              <div className="ck-status-body">אי אפשר לשלוח לאימות כל עוד פרטי ההעברה חסרים.</div>
            </div>
          )}

          {props.sendError && <div className="ck-status ck-status-rejected"><div className="ck-status-body">{props.sendError}</div></div>}

          {props.confirmed && !props.sendError && (
            <div className={`ck-status ck-status-${props.status}`}>
              <div className="ck-status-head">
                <span className={`ck-dot ck-dot-${props.status}`} aria-hidden />
                <span className={`ck-status-title ck-status-title-${props.status}`}>{st.title}</span>
              </div>
              {props.summary && <div className="ck-status-line">{props.summary}</div>}
              <div className="ck-status-body">{st.body}</div>
              {props.status === 'approved' && (
                // A plain anchor, not a router link. The approval changed this
                // account's role on the server, and a client-side navigation
                // would carry the cached payload from before it did.
                <a className="ck-btn ck-btn-md ck-btn-primary" href="/dashboard" style={{ marginTop: 14 }}>
                  כניסה למערכת ←
                </a>
              )}
            </div>
          )}

          <div className="ck-foot">ביטול בכל עת · ללא התחייבות</div>
        </div>
      </div>

      <p className="ck-disclaimer">
        המסחר כרוך בסיכון משמעותי. הכלים במערכת נועדו למטרות לימוד ומחקר בלבד, והשימוש בהם באחריות המשתמש.
      </p>
    </div>
  );
}
