'use client';
import { useEffect, useRef, useState } from 'react';

// Expo-out easing — starts fast, decelerates smoothly into the final value.
// Feels like a physical dial settling into position (trading terminal aesthetic).
const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Animates a number from its previous value to `target` using expo-out easing.
 * Returns the current animated value as a raw number — callers handle formatting.
 *
 * Does NOT animate on the first render (starts at target to avoid 0→N flash
 * on page load). Only fires when target actually changes after mount.
 */
export function useCountUp(target: number, duration = 550): number {
  const [displayed, setDisplayed] = useState(target);
  const prevTarget   = useRef(target);
  const fromRef      = useRef(target);
  const rafRef       = useRef(0);
  const mountedRef   = useRef(false);

  useEffect(() => {
    // Skip animation on the very first mount.
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevTarget.current = target;
      return;
    }

    if (prevTarget.current === target) return;

    const from = prevTarget.current;
    fromRef.current   = from;
    prevTarget.current = target;

    cancelAnimationFrame(rafRef.current);
    let startTime: number | null = null;

    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = expoOut(progress);
      setDisplayed(from + (target - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else setDisplayed(target);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return displayed;
}
