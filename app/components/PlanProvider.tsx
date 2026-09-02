'use client';

import { createContext, useContext, useMemo } from 'react';

export type Role = 'free' | 'starter' | 'pro' | 'deluxe';
const RANK: Record<Role, number> = { free: 0, starter: 1, pro: 2, deluxe: 3 };

interface PlanState {
  role: Role;
  /** Whether this viewer may verify payments. Carried here only so the nav can
      show the owner their own link — the page itself refuses a non-admin with
      notFound(), and the API refuses them again on every call. A tampered
      context value reveals a link, not data. */
  isAdmin: boolean;
}

const PlanCtx = createContext<PlanState>({ role: 'free', isAdmin: false });

/** Makes the current user's plan available to client nav components so they can
    lock what the user can't reach. The real enforcement is the server-side
    route-segment guards — this is UX only. */
export function PlanProvider({
  role, isAdmin = false, children,
}: { role: Role; isAdmin?: boolean; children: React.ReactNode }) {
  const value = useMemo(() => ({ role, isAdmin }), [role, isAdmin]);
  return <PlanCtx.Provider value={value}>{children}</PlanCtx.Provider>;
}

export function usePlan() {
  const { role, isAdmin } = useContext(PlanCtx);
  return { role, isAdmin, canAccess: (min: Role) => RANK[role] >= RANK[min] };
}
