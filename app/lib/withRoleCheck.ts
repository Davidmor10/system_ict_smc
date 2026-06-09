import { redirect } from 'next/navigation';
import { getUserRole, type Role } from './getUserRole';

const RANK: Record<Role, number> = { free: 0, pro: 1 };

// Server-side guard. Call at the top of a Server Component / Route Handler /
// Server Action to restrict access. Redirects insufficient roles to the
// upgrade funnel; returns the resolved role when access is granted.
export async function withRoleCheck(required: Role): Promise<Role> {
  const role = await getUserRole();
  if (RANK[role] < RANK[required]) {
    redirect('/checkout');
  }
  return role;
}

// Convenience guard for Pro-only surfaces.
export async function requirePro(): Promise<void> {
  await withRoleCheck('pro');
}
