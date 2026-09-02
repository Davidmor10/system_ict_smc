// ─────────────────────────────────────────────────────────────────────────────
// Who may see and decide payment requests.
//
// The prototype gated the admin panel on a client-side email comparison. That
// is a UI convenience and nothing more: the request list carries other
// customers' names and email addresses, so the gate has to hold on the server,
// on both the read and the decision, or the data is one devtools panel away.
//
// FAILS CLOSED. Anything that is not an exact match — trimmed and lowercased —
// of an address on the list gets no admin surface and no request data. An
// unset env var does not open the door; it falls back to the owner allowlist
// the app already resolves roles against.
// ─────────────────────────────────────────────────────────────────────────────

import { currentUser } from '@clerk/nextjs/server';

/** The addresses allowed to verify payments.
 *
 *  ADMIN_EMAIL is read at call time rather than at module load so a deploy
 *  that sets it does not need a rebuild to take effect. Comma-separated, so a
 *  second owner can be added without a code change. */
function adminEmails(): string[] {
  const configured = process.env.ADMIN_EMAIL ?? '';
  const list = configured
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  // The allowlist the rest of the app already grants the top tier to. Keeps
  // the panel reachable on a deployment that has not set ADMIN_EMAIL yet,
  // without ever widening beyond addresses that were already privileged.
  return list.length ? list : ['davidmor030908@gmail.com'];
}

/** True when this address may verify payments. Exported for its own test. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return adminEmails().includes(normalized);
}

/** The signed-in user's address, or null. Never throws — a Clerk lookup that
 *  fails must deny, not crash the page. */
export async function viewerEmail(): Promise<string | null> {
  try {
    return (await currentUser())?.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** Whether the signed-in user may verify payments. */
export async function viewerIsAdmin(): Promise<boolean> {
  return isAdminEmail(await viewerEmail());
}
