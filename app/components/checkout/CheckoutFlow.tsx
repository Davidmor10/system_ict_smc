'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The checkout, recreated from the design handoff.
//
// Three screens behind two pieces of state: which plan is selected, and
// whether we are on plans or payment. The admin view is a third, and it is
// only ever reachable when the SERVER said so — `canSeeAdmin` arrives as a
// prop that a server component computed, and the request rows arrive already
// filtered. Nothing here decides who is an admin; it only decides what to draw.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import {
  PLANS, PLAN_DISPLAY_ORDER, isVerificationValid,
  type PaymentRequest, type PlanKey, type RequestStatus,
} from '../../lib/payments/plans';

/** Copy for each state of the customer's status card. Verbatim from the
 *  handoff — the wording is the product's voice and is not to be improvised. */
const STATUS_COPY: Record<RequestStatus, { title: string; body: string; label: string }> = {
  pending: {
    title: 'ההודעה נשלחה · ממתין לאימות',
    body: 'הפרטים שלך נשלחו לבדיקה. ההעברה תאומת ידנית והגישה תיפתח מיד לאחר האישור.',
    label: 'ממתין',
  },
  approved: {
    title: 'התשלום אומת · הגישה נפתחה',
    body: 'המנוי שלך פעיל. אפשר להיכנס למערכת ולהתחיל לעבוד.',
    label: 'אושר',
  },
  rejected: {
    title: 'ההעברה לא אותרה',
    body: 'לא נמצאה העברה תואמת. בדוק את הסכום ואת פרטי ההעברה, ושלח שוב לאימות.',
    label: 'נדחה',
  },
};

/** Where the per-plan Bit QR images live once they are supplied. Absent for
 *  now, and the frame says so rather than showing a broken image. */
const QR_SRC: Record<PlanKey, string> = {
  starter: '/bit/bit-qr-starter.png',
  pro: '/bit/bit-qr-pro.png',
  deluxe: '/bit/bit-qr-deluxe.png',
};

export interface CheckoutFlowProps {
  /** Decided on the server. False for everyone else, always. */
  canSeeAdmin: boolean;
  /** Empty for non-admins — never sent to the browser at all. */
  initialRequests: PaymentRequest[];
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
  qrAvailable: boolean;
}

export default function CheckoutFlow({
  canSeeAdmin, initialRequests, myRequest, defaultName, defaultEmail,
  initialPlan, bitNumber, bitPayee, qrAvailable,
}: CheckoutFlowProps) {
  const [plan, setPlan] = useState<PlanKey>(initialPlan);
  const [step, setStep] = useState<'plans' | 'pay'>('plans');
  const [view, setView] = useState<'user' | 'admin'>('user');
  const [fullName, setFullName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [requests, setRequests] = useState<PaymentRequest[]>(initialRequests);
  const [mine, setMine] = useState<PaymentRequest | null>(myRequest);
  const [confirmed, setConfirmed] = useState(myRequest !== null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // The effective view. A non-admin cannot reach 'admin' even by setting the
  // state, and the server would not have sent them any rows to render anyway.
  const effectiveView = canSeeAdmin ? view : 'user';
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

  async function decide(id: string, status: 'approved' | 'rejected') {
    // Optimistic: the row settles immediately and reverts if the call fails,
    // so a decision never looks made when it was not.
    const before = requests;
    setRequests(rs => rs.map(r => (r.id === id ? { ...r, status } : r)));
    try {
      const res = await fetch(`/api/payment-requests/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) setRequests(before);
    } catch {
      setRequests(before);
    }
  }

  return (
    <div className="ck" dir="rtl">
      {canSeeAdmin && (
        <button
          type="button"
          className="ck-admin-toggle"
          onClick={() => setView(v => (v === 'admin' ? 'user' : 'admin'))}
        >
          {effectiveView === 'admin' ? '→ תצוגת לקוח' : 'פאנל אימות ←'}
        </button>
      )}

      {effectiveView === 'admin' ? (
        <AdminPanel requests={requests} onDecide={decide} />
      ) : step === 'plans' ? (
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
          qrAvailable={qrAvailable}
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
  qrAvailable: boolean;
}

function PayScreen(props: PayScreenProps) {
  const p = PLANS[props.plan];
  const st = STATUS_COPY[props.status];

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
                {props.qrAvailable ? (
                  // eslint-disable-next-line @next/next/no-img-element -- fixed-size static asset in a 220px frame; no loader to gain from
                  <img src={QR_SRC[props.plan]} alt={`ברקוד ביט — ${p.name} ${p.price} ₪`} />
                ) : (
                  <div className="ck-qr-missing">ברקוד ביט — {p.name} {p.price} ₪</div>
                )}
              </div>
              <div className="ck-bit-details">
                <div className="ck-detail">
                  <div className="ck-micro">סכום להעברה</div>
                  <div className="ck-amount ck-num">{p.price} ₪</div>
                </div>
                <div className="ck-detail">
                  <div className="ck-micro">מספר לביט</div>
                  <div className="ck-detail-mono ck-num" dir="ltr">{props.bitNumber ?? '—'}</div>
                </div>
                <div className="ck-detail">
                  <div className="ck-micro">שם המוטב</div>
                  <div className="ck-detail-text">{props.bitPayee ?? '—'}</div>
                </div>
              </div>
            </div>

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
            disabled={!props.valid || props.sending}
            onClick={props.onSubmit}
          >
            {props.sending ? 'שולח…' : 'העברתי את התשלום — שליחה לאימות'}
          </button>

          {props.sendError && <div className="ck-status ck-status-rejected"><div className="ck-status-body">{props.sendError}</div></div>}

          {props.confirmed && !props.sendError && (
            <div className={`ck-status ck-status-${props.status}`}>
              <div className="ck-status-head">
                <span className={`ck-dot ck-dot-${props.status}`} aria-hidden />
                <span className={`ck-status-title ck-status-title-${props.status}`}>{st.title}</span>
              </div>
              {props.summary && <div className="ck-status-line">{props.summary}</div>}
              <div className="ck-status-body">{st.body}</div>
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

/* ── Admin ────────────────────────────────────────────────────────────────── */

function AdminPanel({
  requests, onDecide,
}: { requests: PaymentRequest[]; onDecide: (id: string, s: 'approved' | 'rejected') => void }) {
  return (
    <div className="ck-admin ck-fade">
      <div className="ck-admin-head ck-rise">
        <div className="ck-kicker">ADMIN · אימות תשלומים</div>
        <h1 className="ck-h1 ck-h1-admin">בקשות ממתינות</h1>
        <p>
          כל שליחה מהצ׳קאאוט מגיעה לכאן ובמקביל נשלחת אליך התראה. אישור פותח את הגישה למסלול שנבחר,
          דחייה משאירה את החשבון סגור.
        </p>
      </div>

      <div className="ck-admin-list">
        {requests.length === 0 ? (
          <div className="ck-admin-empty">אין בקשות. כל שליחה חדשה מהצ׳קאאוט תופיע כאן.</div>
        ) : (
          requests.map(r => {
            const decided = r.status !== 'pending';
            return (
              <div className="ck-req" key={r.id}>
                <div className="ck-req-main">
                  <div className="ck-req-top">
                    <div className="ck-req-name">{r.name}</div>
                    <div className={`ck-req-status ck-req-status-${r.status}`}>{STATUS_COPY[r.status].label}</div>
                  </div>
                  <div className="ck-req-email" dir="ltr">{r.email}</div>
                  <div className="ck-req-metrics">
                    <div className="ck-req-metric">
                      <div className="ck-req-metric-k">מסלול</div>
                      <div className="ck-req-plan">{PLANS[r.plan].name}</div>
                    </div>
                    <div className="ck-req-metric">
                      <div className="ck-req-metric-k">סכום מוצהר</div>
                      <div className="ck-req-amount ck-num">{r.amount} ₪</div>
                    </div>
                    <div className="ck-req-metric">
                      <div className="ck-req-metric-k">נשלח</div>
                      <div className="ck-req-time ck-num">{r.time}</div>
                    </div>
                  </div>
                </div>
                <div className={`ck-req-actions${decided ? ' ck-req-actions-decided' : ''}`}>
                  <button
                    type="button"
                    className="ck-btn ck-btn-md ck-btn-primary"
                    disabled={decided}
                    onClick={() => onDecide(r.id, 'approved')}
                  >
                    אישור — פתיחת גישה
                  </button>
                  <button
                    type="button"
                    className="ck-btn ck-btn-md ck-btn-ghost"
                    disabled={decided}
                    onClick={() => onDecide(r.id, 'rejected')}
                  >
                    לא התקבל תשלום
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
