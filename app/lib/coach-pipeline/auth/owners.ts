// ─────────────────────────────────────────────────────────────────────────────
// The owner allowlist, and nothing else.
//
// Deliberately dependency-free: the background worker needs it too, and the
// worker must not pull in Clerk or next/server just to answer "is this the
// account owner?". guards.ts re-exports from here so there is still exactly
// one list in the codebase.
//
// Scope note: this grants PLAN ACCESS only (top tier without a Stripe
// subscription). It is not an admin capability and must never be used to
// gate one — see assertOwner in guards.ts for the request-level check.
// ─────────────────────────────────────────────────────────────────────────────

export const OWNER_EMAILS = [
  'davidmor030908@gmail.com',
  'davidmor030909@gmail.com',
] as const;

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (OWNER_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}
