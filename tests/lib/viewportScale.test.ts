// ─────────────────────────────────────────────────────────────────────────────
// The dashboard is one design, drawn at one width. On a narrower screen it used
// to become a DIFFERENT layout — auto-fit grids dropping to fewer, narrower
// columns — which is the "cramped and messy on a laptop" that was reported.
// Scaling the design keeps the proportions it was drawn with; these are the
// boundaries of when that scaling applies.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { scaleForWidth } from '../../app/components/ViewportScale';

describe('scaleForWidth', () => {
  it('leaves a full-width desktop exactly as it was', () => {
    expect(scaleForWidth(1600)).toBe(1);
    expect(scaleForWidth(1920)).toBe(1);
    expect(scaleForWidth(2560)).toBe(1);
  });

  it('scales the common laptop widths to the design width', () => {
    // 1366 / 1600 — the whole app renders as the 1600px layout at 85%.
    expect(scaleForWidth(1366)).toBeCloseTo(0.854, 3);
    expect(scaleForWidth(1440)).toBeCloseTo(0.9, 3);
    expect(scaleForWidth(1512)).toBeCloseTo(0.945, 3);
    expect(scaleForWidth(1280)).toBeCloseTo(0.8, 3);
  });

  it('stops scaling down before the text stops being readable', () => {
    // Without a floor these would land at 0.64 and 0.55 — a legible layout
    // traded for a faithful one is a bad trade.
    expect(scaleForWidth(1024)).toBe(0.78);
    expect(scaleForWidth(900)).toBe(0.78);
  });

  it('never touches the mobile layout, which is its own design', () => {
    expect(scaleForWidth(880)).toBe(1);
    expect(scaleForWidth(430)).toBe(1);
    expect(scaleForWidth(390)).toBe(1);
  });

  it('is monotonic across the laptop band — no jump inside it', () => {
    for (let w = 888; w <= 1600; w += 7) {
      expect(scaleForWidth(w)).toBeGreaterThanOrEqual(scaleForWidth(w - 7));
    }
  });

  it('steps at the mobile boundary on purpose', () => {
    // 880 and 881 are two different designs, not two sizes of one: at 880 the
    // mobile layout takes over, and it is drawn for that width already. Just
    // above it the desktop layout has to appear somehow, and the floor gives
    // it the most room it can have. The step is between the designs, not
    // inside either of them.
    expect(scaleForWidth(880)).toBe(1);
    expect(scaleForWidth(881)).toBe(0.78);
  });
});
