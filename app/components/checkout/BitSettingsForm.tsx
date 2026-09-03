'use client';

import { useState } from 'react';
import { PLANS, PLAN_KEYS, type PlanKey } from '../../lib/payments/plans';

// ─────────────────────────────────────────────────────────────────────────────
// Where customers send the money — set here, not in a Vercel dashboard and not
// by committing files to the repository.
//
// THE QR IS THE POINT, AND THE NUMBER IS OPTIONAL.
//
// The first version made the phone number the thing that turned payment on.
// That number is the owner's personal one and every customer would see it on
// the payment page. A Bit QR encodes the same transfer — recipient and amount
// — without publishing it, so the code is the primary route and the number is
// there only for an owner who wants it shown.
//
// One code per plan, because the amount differs per plan: a PRO code does not
// let a DELUXE customer pay the right sum.
//
// IMAGES ARE DOWNSCALED BEFORE THEY ARE SENT. An owner uploads whatever their
// Bit app produced, which may be a full-resolution phone screenshot; a QR is
// perfectly scannable at 600px, and three untouched screenshots would be a
// megabyte sitting in every customer's checkout payload.
// ─────────────────────────────────────────────────────────────────────────────

/** Longest edge kept. Well above what any scanner needs, well below a photo. */
const MAX_EDGE = 600;

/** Read a file, shrink it, and return a PNG data URI. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no canvas')); return; }
        // A QR is black on white; a transparent source would otherwise flatten
        // to black on black and become unscannable.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export interface BitSettingsFormProps {
  initial: { number: string | null; payee: string | null; qr: Record<string, string | null> };
  /** True when the number comes from an environment variable, which the form
   *  cannot change — saying so beats a save that silently does nothing. */
  fromEnv: boolean;
}

export default function BitSettingsForm({ initial, fromEnv }: BitSettingsFormProps) {
  const [number, setNumber] = useState(initial.number ?? '');
  const [payee, setPayee] = useState(initial.payee ?? '');
  const [qr, setQr] = useState<Record<string, string | null>>({
    starter: initial.qr.starter ?? null,
    pro: initial.qr.pro ?? null,
    deluxe: initial.qr.deluxe ?? null,
  });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const ready = PLAN_KEYS.filter(k => qr[k]);
  const configured = ready.length > 0 || number.trim().length > 0;

  async function pick(plan: PlanKey, file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setQr(q => ({ ...q, [plan]: null }));
      const data = await shrink(file);
      setQr(q => ({ ...q, [plan]: data }));
      setState('idle');
    } catch {
      setError('לא הצלחנו לקרוא את הקובץ. נסה תמונה אחרת.');
    }
  }

  async function save() {
    if (state === 'saving') return;
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/payment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: number.trim(), payee: payee.trim(), qr }),
      });
      if (res.ok) { setState('saved'); return; }
      const body = await res.json().catch(() => null);
      setState('failed');
      if (body?.error === 'invalid_qr') setError('אחת התמונות לא נשמרה. העלה קובץ תמונה קטן יותר.');
    } catch {
      setState('failed');
    }
  }

  const edit = (set: (v: string) => void) => (v: string) => { set(v); setState('idle'); };

  return (
    <section className="ck-settings">
      <div className="ck-settings-head">
        <div className="ck-kicker">פרטי ההעברה</div>
        <span className={`ck-settings-state ck-settings-state-${configured ? 'on' : 'off'}`}>
          {configured ? 'התשלום פעיל' : 'התשלום מושבת'}
        </span>
      </div>

      <p className="ck-settings-body">
        {configured
          ? `הלקוח סורק את הברקוד ומעביר. שינוי כאן נכנס לתוקף מיד, בלי פריסה מחדש.${
              ready.length > 0 && ready.length < PLAN_KEYS.length
                ? ' שים לב שיש מסלולים בלי ברקוד — הם עדיין חסומים.' : ''}`
          : 'בלי ברקוד אין ללקוח לאן להעביר, ועמוד התשלום חסום. העלה ברקוד לכל מסלול וזה ייפתח מיד.'}
      </p>

      <div className="ck-qr-grid">
        {PLAN_KEYS.map(plan => (
          <div className="ck-qr-slot" key={plan} data-set={qr[plan] !== null}>
            <div className="ck-qr-slot-head">
              <span className="ck-qr-slot-name">{PLANS[plan].name}</span>
              <span className="ck-qr-slot-amount ck-num">{PLANS[plan].price} ₪</span>
            </div>

            <div className="ck-qr-slot-frame">
              {qr[plan] ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URI; there is no URL for a loader to optimise
                <img src={qr[plan]!} alt={`ברקוד ביט — ${PLANS[plan].name}`} />
              ) : (
                <span className="ck-qr-slot-empty">אין ברקוד</span>
              )}
            </div>

            <label className="ck-qr-slot-pick">
              <input
                type="file" accept="image/*"
                onChange={e => { void pick(plan, e.target.files?.[0]); e.target.value = ''; }}
              />
              <span>{qr[plan] ? 'החלפת ברקוד' : 'העלאת ברקוד'}</span>
            </label>

            {qr[plan] && (
              <button type="button" className="ck-qr-slot-clear" onClick={() => { setQr(q => ({ ...q, [plan]: null })); setState('idle'); }}>
                הסרה
              </button>
            )}
          </div>
        ))}
      </div>

      <details className="ck-settings-more">
        <summary>פרטים נוספים — לא חובה</summary>
        <p className="ck-settings-note">
          המספר מוצג ללקוח בעמוד התשלום. אם הברקוד מוגדר אין בו צורך, ואפשר להשאיר ריק.
        </p>
        <div className="ck-settings-fields">
          <label className="ck-field">
            <span className="ck-field-label">מספר לביט</span>
            <input
              className="ck-input" dir="ltr" inputMode="tel" placeholder="לא חובה"
              value={number} onChange={e => edit(setNumber)(e.target.value)} disabled={fromEnv}
            />
          </label>
          <label className="ck-field">
            <span className="ck-field-label">שם המוטב</span>
            <input
              className="ck-input" dir="rtl" placeholder="לא חובה"
              value={payee} onChange={e => edit(setPayee)(e.target.value)} disabled={fromEnv}
            />
          </label>
        </div>
        {fromEnv && (
          <p className="ck-settings-note">
            המספר מגיע ממשתנה סביבה ולכן נעול כאן. כדי לערוך אותו מהמסך הזה — מחק את
            <span dir="ltr"> NEXT_PUBLIC_BIT_NUMBER </span>מהגדרות הפריסה.
          </p>
        )}
      </details>

      <div className="ck-settings-actions">
        <button type="button" className="ck-btn ck-btn-md ck-btn-primary" onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'שומר…' : 'שמירה'}
        </button>
        {state === 'saved' && !error && <span className="ck-settings-ok">נשמר. עמוד התשלום מעודכן.</span>}
        {error && <span className="ck-settings-err">{error}</span>}
        {state === 'failed' && !error && <span className="ck-settings-err">השמירה נכשלה. נסה שוב.</span>}
      </div>
    </section>
  );
}
