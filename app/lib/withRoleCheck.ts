import { redirect } from 'next/navigation';
import { getUserRole, ROLE_RANK, type Role } from './getUserRole';

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

// Back-compat aliases.
export const withRoleCheck = requirePlan;
export async function requirePro(): Promise<void> {
  await requirePlan('pro');
}
