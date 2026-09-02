// The wording for each state of a payment request. Verbatim from the design
// handoff — this is the product's voice and is not to be improvised.
//
// Shared rather than duplicated: the customer's status card and the owner's
// verification panel name the same three states, and two copies drift the
// moment one of them is edited.

import type { RequestStatus } from '../../lib/payments/plans';

export const STATUS_COPY: Record<RequestStatus, { title: string; body: string; label: string }> = {
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
