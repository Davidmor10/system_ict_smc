'use client';

import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Where customers send the money — typed here, not in a Vercel dashboard.
//
// This was two environment variables. Until they were set the payment page
// showed a dash where the number belongs, so the product was live and
// uncollectable, and changing the number meant a redeploy.
//
// It sits above the verification queue on purpose: an owner with no number
// configured has nothing to verify, and this is the screen where they find
// that out.
// ─────────────────────────────────────────────────────────────────────────────

export interface BitSettingsFormProps {
  initial: { number: string | null; payee: string | null };
  /** True when the values come from environment variables, which the form
   *  cannot change — saying so beats a save that silently does nothing. */
  fromEnv: boolean;
}

export default function BitSettingsForm({ initial, fromEnv }: BitSettingsFormProps) {
  const [number, setNumber] = useState(initial.number ?? '');
  const [payee, setPayee] = useState(initial.payee ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const configured = number.trim().length > 0;

  async function save() {
    if (state === 'saving') return;
    setState('saving');
    try {
      const res = await fetch('/api/payment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: number.trim(), payee: payee.trim() }),
      });
      setState(res.ok ? 'saved' : 'failed');
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
          ? 'זה מה שלקוח רואה בעמוד התשלום. שינוי כאן נכנס לתוקף מיד, בלי פריסה מחדש.'
          : 'בלי מספר ביט אין ללקוח לאן להעביר, ועמוד התשלום חסום. מלא את המספר וזה ייפתח מיד.'}
      </p>

      <div className="ck-settings-fields">
        <label className="ck-field">
          <span className="ck-field-label">מספר לביט</span>
          <input
            className="ck-input" dir="ltr" inputMode="tel" placeholder="050-0000000"
            value={number} onChange={e => edit(setNumber)(e.target.value)} disabled={fromEnv}
          />
        </label>
        <label className="ck-field">
          <span className="ck-field-label">שם המוטב</span>
          <input
            className="ck-input" dir="rtl" placeholder="השם שהלקוח יראה"
            value={payee} onChange={e => edit(setPayee)(e.target.value)} disabled={fromEnv}
          />
        </label>
      </div>

      {fromEnv ? (
        <p className="ck-settings-note">
          הערכים מגיעים ממשתני סביבה, ולכן אי אפשר לשנות אותם כאן. כדי לערוך אותם מהמסך הזה — מחק את
          <span dir="ltr"> NEXT_PUBLIC_BIT_NUMBER </span> ואת<span dir="ltr"> NEXT_PUBLIC_BIT_PAYEE </span>
          מהגדרות הפריסה.
        </p>
      ) : (
        <div className="ck-settings-actions">
          <button type="button" className="ck-btn ck-btn-md ck-btn-primary" onClick={save} disabled={state === 'saving'}>
            {state === 'saving' ? 'שומר…' : 'שמירה'}
          </button>
          {state === 'saved' && <span className="ck-settings-ok">נשמר. עמוד התשלום מעודכן.</span>}
          {state === 'failed' && <span className="ck-settings-err">השמירה נכשלה. נסה שוב.</span>}
        </div>
      )}
    </section>
  );
}
