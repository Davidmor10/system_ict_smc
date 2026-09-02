// ─────────────────────────────────────────────────────────────────────────────
// Telling the owner a payment was declared.
//
// Nothing polls the verification queue. Without this the owner learns about a
// transfer only by opening the panel and looking, which means a customer who
// paid at 23:00 waits until somebody happens to check.
//
// SENT OVER PLAIN HTTP, WITH NO NEW DEPENDENCY. Resend's REST API is one POST
// with a JSON body, so a package adds a bundle and a supply-chain surface for
// nothing. Swapping providers is changing the URL and the body shape in one
// function.
//
// IT CANNOT FAIL THE REQUEST. The payment request is already recorded by the
// time this runs. A customer must never see "submission failed" because the
// owner's mail provider was down — so every path here returns a result and
// throws nothing, and the caller ignores it beyond logging.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../logger';
import { PLANS, type PlanKey } from './plans';

export type NotifyResult = 'sent' | 'not_configured' | 'failed';

export interface OwnerNotification {
  name: string;
  email: string;
  plan: PlanKey;
  amount: number;
  /** HH:mm in the trader's zone, as the panel shows it. */
  time: string;
}

/** Where the verification panel lives, absolute, so the link works from a mail
 *  client.
 *
 *  Inside the dashboard rather than on the checkout: the owner is signed in
 *  and already in the app when this arrives, and the page is admin-gated on
 *  the server. */
export function adminPanelUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
  return `${base}/dashboard/payments`;
}

/** Escapes text before it goes into the HTML body.
 *
 *  The name and the address are typed by a customer. Without this, a name
 *  containing a tag would be markup in the owner's inbox — the one reader who
 *  must be able to trust what this message says. */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function subject(n: OwnerNotification): string {
  return `בקשת תשלום · ${PLANS[n.plan].name} · ${n.amount} ₪ · ${n.name}`;
}

/** The message body. RTL, and the address is forced LTR inside it — a mail
 *  client rendering an address right to left makes it unreadable, and this is
 *  the field the owner matches against the Bit transfer. */
function html(n: OwnerNotification): string {
  const url = adminPanelUrl();
  const link = url.startsWith('http')
    ? `<p style="margin:24px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#d4af37;color:#0a0a0a;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:2px">פתיחת פאנל האימות</a></p>`
    : '';
  const row = (k: string, v: string, ltr = false) =>
    `<tr>
       <td style="padding:8px 0;color:#8a8a8a;font-size:14px">${esc(k)}</td>
       <td style="padding:8px 0;color:#ffffff;font-size:15px;font-weight:600"${ltr ? ' dir="ltr"' : ''}>${esc(v)}</td>
     </tr>`;

  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#050505;padding:28px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#0d0d0f;border:1px solid #1c1c1e;border-radius:12px;padding:28px">
    <div style="font-size:11px;letter-spacing:.28em;color:#d4af37;font-weight:700">ONYX · בקשת תשלום</div>
    <h1 style="font-size:22px;color:#ffffff;margin:14px 0 4px">התקבלה הצהרה על העברה</h1>
    <p style="color:#8a8a8a;font-size:14px;line-height:1.7;margin:0 0 18px">
      בדוק שההעברה התקבלה בביט, ואז אשר או דחה בפאנל.
    </p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #1c1c1e">
      ${row('שם', n.name)}
      ${row('אימייל', n.email, true)}
      ${row('מסלול', PLANS[n.plan].name)}
      ${row('סכום מוצהר', `${n.amount} ₪`)}
      ${row('נשלח', n.time)}
    </table>
    ${link}
  </div>
</body></html>`;
}

function text(n: OwnerNotification): string {
  return [
    'ONYX · התקבלה הצהרה על העברה',
    '',
    `שם: ${n.name}`,
    `אימייל: ${n.email}`,
    `מסלול: ${PLANS[n.plan].name}`,
    `סכום מוצהר: ${n.amount} ₪`,
    `נשלח: ${n.time}`,
    '',
    adminPanelUrl(),
  ].join('\n');
}

/** Send it. Never throws.
 *
 *  Returns `not_configured` rather than failing when the key or the addresses
 *  are missing, so a deployment without mail set up still takes payments —
 *  the owner just has to open the panel themselves, which is where this
 *  started. */
export async function notifyOwner(n: OwnerNotification): Promise<NotifyResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const to = process.env.OWNER_NOTIFY_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();
  const from = process.env.OWNER_NOTIFY_FROM?.trim();

  if (!key || !to || !from) {
    logger.warn('payment notification not configured — set RESEND_API_KEY, OWNER_NOTIFY_FROM and OWNER_NOTIFY_EMAIL', {
      hasKey: !!key, hasTo: !!to, hasFrom: !!from,
    });
    return 'not_configured';
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        // Comma-separated in the variable, an array on the wire.
        to: to.split(',').map(a => a.trim()).filter(Boolean),
        subject: subject(n),
        html: html(n),
        text: text(n),
        reply_to: n.email,
      }),
    });

    if (!res.ok) {
      // The provider's message, not just the status — a 422 for an unverified
      // sending domain is the likeliest failure and says so in the body.
      const detail = await res.text().catch(() => '');
      logger.error('payment notification rejected', { status: res.status, detail: detail.slice(0, 300) });
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    logger.error('payment notification failed to send', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}
