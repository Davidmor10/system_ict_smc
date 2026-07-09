'use client';

import { createContext, useContext } from 'react';

export type Role = 'free' | 'pro' | 'deluxe';
const RANK: Record<Role, number> = { free: 0, pro: 1, deluxe: 2 };

const PlanCtx = createContext<Role>('free');

/** Makes the current user's plan available to client nav components so they can
    lock what the user can't reach. The real enforcement is the server-side
    route-segment guards — this is UX only. */
export function PlanProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <PlanCtx.Provider value={role}>{children}</PlanCtx.Provider>;
}

export function usePlan() {
  const role = useContext(PlanCtx);
  return { role, canAccess: (min: Role) => RANK[role] >= RANK[min] };
}
