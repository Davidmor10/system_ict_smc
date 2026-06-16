'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Wraps dashboard route children with a smooth enter/exit animation.
 * Pattern: fast fade-out (80ms) → Next.js swaps content → slow expo-out
 * fade+slide-in (380ms). The asymmetry — quick exit, unhurried entrance —
 * makes navigation feel intentional rather than abrupt.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timer from a rapid navigation.
    if (timerRef.current) clearTimeout(timerRef.current);

    // Step 1 — exit: collapse opacity + nudge down (fast, reads as decisive).
    setPhase('out');

    // Step 2 — after Next has re-rendered the new page, enter smoothly.
    timerRef.current = setTimeout(() => setPhase('in'), 60);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname]);

  return (
    <div
      className="flex flex-col flex-1 min-w-0 overflow-hidden pb-14 md:pb-0"
      style={
        phase === 'out'
          ? {
              opacity: 0,
              transform: 'translateY(7px)',
              transition: 'opacity 80ms cubic-bezier(0.7,0,0.84,0), transform 80ms cubic-bezier(0.7,0,0.84,0)',
            }
          : {
              opacity: 1,
              transform: 'translateY(0)',
              transition: 'opacity 380ms cubic-bezier(0.16,1,0.3,1), transform 380ms cubic-bezier(0.16,1,0.3,1)',
            }
      }
    >
      {children}
    </div>
  );
}
