'use client';

import { useEffect } from 'react';

/** The width the dashboard was designed at. Every panel, grid track and type
 *  size in dashboard.css was chosen against this, and the auto-fit grids
 *  reflow below it — which is the "cramped and messy on a laptop" the design
 *  never intended and never asked for. */
const DESIGN_WIDTH = 1600;

/** Below this the app uses its own mobile layout — a deliberate design in its
 *  own right, not a squeezed desktop. Scaling must not touch it. */
const MOBILE_MAX = 880;

/** How far down the design may be scaled before the text is simply too small
 *  to read comfortably. A 1280-wide laptop lands at 0.80; the floor only binds
 *  on the narrow window sizes between the mobile layout and a real laptop. */
const MIN_SCALE = 0.78;

export function scaleForWidth(width: number): number {
  if (width <= MOBILE_MAX) return 1;
  if (width >= DESIGN_WIDTH) return 1;
  return Math.max(MIN_SCALE, Math.round((width / DESIGN_WIDTH) * 1000) / 1000);
}

/** Keeps the dashboard looking like itself on a smaller screen.
 *
 *  The alternative was re-deciding every breakpoint for every panel — a second
 *  design, maintained forever alongside the first, drifting from it with every
 *  change. This scales the one design instead: at 1366px the whole app renders
 *  as the 1600px layout at 0.854, so nothing rewraps, nothing collapses, and
 *  the proportions the design was drawn with are exactly the ones on screen.
 *
 *  `zoom` rather than `transform: scale()` on purpose — it scales the layout
 *  itself, so fixed elements, scroll height and hit targets all stay honest,
 *  where a transform would leave the page's real size unchanged underneath the
 *  visual one. */
export default function ViewportScale() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      root.style.setProperty('--onyx-zoom', String(scaleForWidth(window.innerWidth)));
    };

    apply();
    // Coalesced: a window drag fires resize dozens of times a second, and each
    // write to a custom property this high in the tree invalidates layout.
    const onResize = () => { if (!frame) frame = requestAnimationFrame(apply); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty('--onyx-zoom');
    };
  }, []);

  return null;
}
