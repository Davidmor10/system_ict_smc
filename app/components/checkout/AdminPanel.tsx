'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The owner's verification panel.
//
// IT REFETCHES, and that is the point of the file. The first version rendered
// whatever rows the server happened to have when the page was opened and never
// looked again — so a transfer declared a minute later left the owner staring
// at an empty panel while the request sat in the table. The panel is a queue;
// a queue that only reads itself once is a screenshot.
//
// Three refresh triggers, all cheap: coming back to the tab, a slow poll while
// it is open, and the button. The list endpoint is admin-gated on the server,
// so a refetch cannot widen what this viewer may see.
//
// NOTHING HERE DECIDES WHO IS AN ADMIN. The page that renders it made that
// call on the server, and the API makes it again on every request.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { PLANS, type PaymentRequest } from '../../lib/payments/plans';
import { STATUS_COPY } from './statusCopy';

/** How often the open panel re-reads the queue. Slow on purpose: the owner
 *  reaches this screen from a notification, and a tab left open overnight
 *  should not spend a request a second. */
const POLL_MS = 60_000;

export interface AdminPanelProps {
  /** Rows the server already read, so the first paint is not empty. */
  initialRequests: PaymentRequest[];
}

export default function AdminPanel({ initialRequests }: AdminPanelProps) {
  const [requests, setRequests] = useState<PaymentRequest[]>(initialRequests);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against two refreshes overlapping and the older answer landing
  // last, which would put the panel back to a state that is already stale.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/payment-requests', { cache: 'no-store' });
      if (!res.ok) {
        setError('רענון הרשימה נכשל. נסה שוב.');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.requests)) {
        setError('רענון הרשימה נכשל. נסה שוב.');
        return;
      }
      setRequests(data.requests as PaymentRequest[]);
      setError(null);
    } catch {
      setError('רענון הרשימה נכשל. נסה שוב.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Returning to the tab is the moment the owner expects to see what arrived
  // while they were away — the notification mail is read in another window.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

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
      if (!res.ok) {
        setRequests(before);
        setError('הפעולה נכשלה. רענן ונסה שוב.');
        return;
      }
      setError(null);
      // Read the queue back rather than trusting the optimistic row: the
      // decision is what opens a paid account, and the panel should show what
      // the table actually holds.
      void refresh();
    } catch {
      setRequests(before);
      setError('הפעולה נכשלה. רענן ונסה שוב.');
    }
  }

  const pending = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="ck-admin ck-fade">
      <div className="ck-admin-head ck-rise">
        <div className="ck-kicker">ADMIN · אימות תשלומים</div>
        <h1 className="ck-h1 ck-h1-admin">בקשות ממתינות</h1>
        <p>
          כל שליחה מהצ׳קאאוט מגיעה לכאן ובמקביל נשלחת אליך התראה. אישור פותח את הגישה למסלול שנבחר,
          דחייה משאירה את החשבון סגור.
        </p>
        <div className="ck-admin-bar">
          <span className="ck-admin-count ck-num">
            {pending} ממתינות · {requests.length} סך הכול
          </span>
          <button type="button" className="ck-btn ck-btn-md ck-btn-ghost" disabled={loading} onClick={() => void refresh()}>
            {loading ? 'מרענן…' : 'רענון'}
          </button>
        </div>
        {error && <div className="ck-admin-error">{error}</div>}
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
                    onClick={() => decide(r.id, 'approved')}
                  >
                    אישור — פתיחת גישה
                  </button>
                  <button
                    type="button"
                    className="ck-btn ck-btn-md ck-btn-ghost"
                    disabled={decided}
                    onClick={() => decide(r.id, 'rejected')}
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
