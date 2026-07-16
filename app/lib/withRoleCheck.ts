import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getUserRole, ROLE_RANK, type Role } from './getUserRole';
import { logSecurityEvent } from './securityLog';

// Server-side guard. Call at the top of a Server Component (e.g. a route-segment
// layout), Route Handler, or Server Action to restrict access by plan. Access
// is ranked (deluxe ⊇ pro ⊇ free); an insufficient plan is redirected to the
// upgrade funnel. Returns the resolved role when access is granted.
export async function requirePlan(required: Role): Promise<Role> {
  const role = await getUserRole();
  if (ROLE_RANK[role] < ROLE_RANK[required]) {
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
  const role = await getUserRole();
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
