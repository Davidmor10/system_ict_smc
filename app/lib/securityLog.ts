// ─────────────────────────────────────────────────────────────────────────────
// Structured security-relevant logging.
//
// Deliberately just console.warn — Vercel captures every serverless function's
// stdout/stderr into its own log viewer automatically, no extra service to
// wire up. This is enough to *notice* a spike (repeated auth failures from
// one IP, a route getting rate-limited constantly) by reading or searching
// logs. Real-time alerting (paging someone when a threshold is crossed)
// needs an actual monitoring product — Sentry, Axiom, Better Stack, etc. —
// which requires an account decision, not just code.
// ─────────────────────────────────────────────────────────────────────────────

// `owner_mismatch` is the loudest of these: it means a request arrived whose
// tab believed it belonged to one account while the cookie authenticated
// another. That is the shape of one trader's journal reaching another's
// rows, so any occurrence is worth reading. See lib/sync/ownerHeader.
type SecurityEvent = 'auth_failed' | 'rate_limited' | 'validation_failed' | 'plan_denied' | 'owner_mismatch';

export function logSecurityEvent(event: SecurityEvent, details: Record<string, unknown>) {
  console.warn(JSON.stringify({ security_event: event, ts: new Date().toISOString(), ...details }));
}
