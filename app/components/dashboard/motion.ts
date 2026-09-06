'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The dashboard's two entrance animations.
//
// Both are DECORATION, and both are built so that a failure leaves the page
// readable rather than blank. That is the whole design constraint here: a
// number stuck at zero and a section stuck at opacity 0 look identical to a
// broken page, and neither would throw anything a test could catch.
//
//   · the count-up starts at p = 1 (the real value) and only animates DOWN to
//     zero and back if rAF is actually going to run
//   · the reveal clears every inline opacity after 1600ms whatever happened
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

const prefersReduced = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Progress 0 → 1 over 1200ms, quartic ease-out. Every figure on the page is
 *  rendered as `value × p`.
 *
 *  DEFAULTS TO 1, not 0. A tab that is hidden, a browser with reduced motion
 *  on, or an rAF that never fires all leave the real numbers on screen. */
export function useCountUp(duration = 1200): number {
  const [p, setP] = useState(1);

  useEffect(() => {
    if (prefersReduced() || document.visibilityState === 'hidden') return;

    let raf = 0;
    // Nothing is set here. The first frame writes a p of about zero on its
    // own, and starting the state at 1 means a browser that never runs the
    // callback shows the real numbers rather than a row of zeroes.
    //
    // The safety net covers the case where rAF fires once and then stops —
    // a tab backgrounded mid-animation — so a figure cannot be left partway.
    const safety = window.setTimeout(() => setP(1), 1500);

    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setP(1 - Math.pow(1 - k, 4));
      if (k < 1) raf = requestAnimationFrame(step);
      else window.clearTimeout(safety);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
    };
  }, [duration]);

  return p;
}

/** Sections rise as they come into view. The first is shown at once — it is
 *  already on screen, and animating it costs the reader a beat of nothing. */
export function useReveal(deps: readonly unknown[] = []): void {
  // The dependency array is the caller's, forwarded verbatim.
  const first = useRef(true);

  useEffect(() => {
    if (prefersReduced()) return;

    const show = (el: HTMLElement) => {
      el.style.animation = 'dsh-rise .9s cubic-bezier(.16,1,.3,1) forwards';
      el.style.opacity = '';
    };

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { show(e.target as HTMLElement); io.unobserve(e.target); }
      }
    }, { threshold: 0.04 });

    let safety = 0;
    const raf = requestAnimationFrame(() => {
      const els = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
      els.forEach((el, i) => {
        if (i === 0 && first.current) { show(el); return; }
        if (el.dataset.revealed === '1') return;
        el.style.opacity = '0';
        io.observe(el);
      });
      first.current = false;
      // Nothing may stay invisible. Whatever the observer did or did not do,
      // every section is readable after this fires.
      safety = window.setTimeout(() => {
        document.querySelectorAll<HTMLElement>('[data-reveal]').forEach(el => {
          el.style.opacity = '';
          el.dataset.revealed = '1';
        });
      }, 1600);
    });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
