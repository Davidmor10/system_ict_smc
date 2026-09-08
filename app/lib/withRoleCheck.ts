import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getUserContext, ROLE_RANK, type Role } from './getUserRole';
import { logSecurityEvent } from './securityLog';

// Server-side guard. Call at the top of a Server Component (e.g. a route-segment
// layout), Route Handler, or Server Action to restrict access by plan. Access
// is ranked (deluxe ⊇ pro ⊇ free); an insufficient plan is redirected to the
// upgrade funnel. Returns the resolved role when access is granted.
export async function requirePlan(required: Role): Promise<Role> {
  const { role, resolved } = await getUserContext();
  if (ROLE_RANK[role] < ROLE_RANK[required]) {
    // Fails closed either way — an unknown role never opens a paid page. But
    // an unresolved role is logged as what it is, so a burst of these reads as
    // an outage in the log rather than as a wave of unpaid accounts.
    if (!resolved) logSecurityEvent('role_unresolved', { route: 'page', required });
    redirect('/checkout');
  }
  return role;
}

// API-route variant of requirePlan. Route Handlers can't redirect the caller
// to the upgrade funnel — they must answer the fetch — so an insufficient
// plan returns a 403 JSON response for the route to send back, and sufficient
// access returns null. Keeps paid features (AI coach, analytics) enforced at
// the API itself, not just in the page layouts that happen to call them.
export async function requirePlanApi(required: Role, route: string): Promise<NextResponse | null> {
  const { role, resolved } = await getUserContext();

  // The role could not be determined — Clerk or Supabase failed, not the
  // customer. Still refuse (an unknown role grants nothing), but refuse with
  // the truth: 503 is retryable and says the system is at fault, where 403
  // told a paying trader their plan was too low and cost them the answer they
  // had just written. See UserContext.resolved for the production trace.
  if (!resolved) {
    logSecurityEvent('role_unresolved', { route, required });
    return NextResponse.json(
      { error: 'Could not verify your plan right now', retryable: true },
      { status: 503, headers: { 'Retry-After': '2' } },
    );
  }

  if (ROLE_RANK[role] < ROLE_RANK[required]) {
    logSecurityEvent('plan_denied', { route, role, required });
    return NextResponse.json(
      { error: 'Plan upgrade required', requiredPlan: required },
      { status: 403 },
    );
  }
  return null;
}

// Back-compat aliases.
export const withRoleCheck = requirePlan;
export async function requirePro(): Promise<void> {
  await requirePlan('pro');
}
