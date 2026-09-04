// ─────────────────────────────────────────────────────────────────────────────
// The three plans, their prices, and the copy the checkout shows for each.
//
// One source. The prices appear on /pricing, in the terms, on the checkout
// cards, in the Bit amount the trader is told to transfer, and in the amount
// the owner approves against — and a mismatch between the last two is a
// customer who paid the wrong number and an owner who cannot tell.
//
// The copy is verbatim from the design handoff and is not to be rewritten.
// ─────────────────────────────────────────────────────────────────────────────

import type { Role } from '../getUserRole';

export type PlanKey = 'starter' | 'pro' | 'deluxe';

export const PLAN_KEYS: readonly PlanKey[] = ['starter', 'pro', 'deluxe'] as const;

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === 'string' && (PLAN_KEYS as readonly string[]).includes(v);
}

export interface Plan {
  key: PlanKey;
  /** Display name — also what the admin panel row shows. */
  name: string;
  /** Monthly price in shekels. */
  price: number;
  /** The role this plan grants on approval. */
  role: Role;
  /** Gold kicker above the plan name. */
  kicker: string;
  blurb: string;
  features: string[];
  /** PRO carries the gold button and the badge; the other two are outlined. */
  featured: boolean;
}

export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: 'starter',
    name: 'STARTER',
    price: 49,
    role: 'starter',
    kicker: '49 ש״ח / חודש',
    blurb: 'תובנת ה-AI על העסקאות שתיעדת ביומן — פסקה אחת, מסקנה אחת.',
    features: [
      'כל מה שיש ב-Free',
      'פאנל AI Insight נפתח ביומן',
      'סנכרון חוצה-מכשירים של החוקים, הסטאפים וההעדפות',
      'ביטול בכל רגע, ללא התחייבות',
    ],
    featured: false,
  },
  pro: {
    key: 'pro',
    name: 'PRO',
    price: 99,
    role: 'pro',
    kicker: 'שכבת הבינה המלאה',
    blurb: '99 ₪/חודש · כל שכבת ה-AI של המערכת נפתחת — תובנה על כל עסקה, עמוד Analytics מלא, זיכרון דפוסים, סימולטור תרחישים, דוח שבועי + ארכיון. הכול עובד ביחד.',
    features: [
      'תובנת AI על כל עסקה שתיעדת — פסקה אישית מיד כשסגרת את הטרייד',
      'עמוד ה-AI Analytics המלא: אחוזי הצלחה חתוכים לפי סשן, סטאפ, ביאס ויום',
      'זיכרון דפוסים אישי — המערכת לומדת דפוסים אמיתיים על המסחר שלך שבוע אחר שבוע',
      'סימולטור תרחישים + דוח שבועי אישי + ארכיון היסטורי מלא',
    ],
    featured: true,
  },
  deluxe: {
    key: 'deluxe',
    name: 'DELUXE',
    price: 199,
    role: 'deluxe',
    kicker: '199 ש״ח / חודש · ללא תקרות',
    blurb: 'כל שכבת הבינה של PRO — במלואה — ובנוסף המאמן האישי, שיחה שקוראת את היומן שלך בזמן אמת ועונה מתוך הנתונים שלך.',
    features: [
      'כל שכבת ה-AI של PRO — במלואה',
      'המאמן האישי שיחה נפתחת — שיחה שקוראת את היומן שלך בזמן אמת',
      'היסטוריית שיחות עם המאמן, נשמרת פר סוחר',
      'גישה מועדפת לפיצ׳רים חדשים — נפתחים ל-Deluxe קודם',
    ],
    featured: false,
  },
};

/** Source order for the plan grid. The grid is RTL, so this renders right to
 *  left as DELUXE, PRO, STARTER — the order the handoff specifies. */
export const PLAN_DISPLAY_ORDER: readonly PlanKey[] = ['deluxe', 'pro', 'starter'] as const;

export const DEFAULT_PLAN: PlanKey = 'pro';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export function isRequestStatus(v: unknown): v is RequestStatus {
  return v === 'pending' || v === 'approved' || v === 'rejected';
}

/** A declared Bit transfer, as the admin panel and the status card show it. */
export interface PaymentRequest {
  id: string;
  name: string;
  email: string;
  plan: PlanKey;
  amount: number;
  status: RequestStatus;
  /** HH:mm, already formatted server-side in the trader's zone. */
  time: string;
}

/** The verification form is submittable only when both hold.
 *
 *  Shared between the button's disabled state and the route's validation, so
 *  the two cannot drift into a form that submits what the server rejects. */
export function isVerificationValid(fullName: string, email: string): boolean {
  return fullName.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** How long an approved Bit transfer buys.
 *
 *  Bit here is a one-off transfer per month, not a standing mandate — nothing
 *  charges the customer again and nothing revokes access on its own. So an
 *  approval has to carry an end date, or one payment becomes permanent access. */
export function accessPeriodEnd(from: Date = new Date()): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + 1);
  return end;
}

/** Where a renewal's month should be added from.
 *
 *  A RENEWAL EXTENDS; IT DOES NOT RESET.
 *
 *  The approval used to write "today plus a month" unconditionally, so a
 *  customer who paid a week before their access ran out lost that week — they
 *  had bought it and it was thrown away. Renew consistently early and it is a
 *  fortnight a year of paid time taken back.
 *
 *  The new period starts from whichever is later: now, or the end of the one
 *  they are still inside. An expiry already in the past is not a credit, so it
 *  falls back to now. */
export function renewalStart(currentAccessUntil: string | null | undefined, now: Date = new Date()): Date {
  if (!currentAccessUntil) return now;
  const current = new Date(currentAccessUntil);
  if (Number.isNaN(current.getTime())) return now;
  return current.getTime() > now.getTime() ? current : now;
}
