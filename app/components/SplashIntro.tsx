'use client';

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Onyx "Smoke Reveal" splash — a first-impression brand moment, not a loader.
// Pure-CSS transitions driven by a `phase` state machine (no JS frame loops).
// It's a fixed overlay on top of the already-rendered landing page, so it never
// blocks data/auth/routing. Session-once, respects reduced-motion, tap-to-skip.
// ─────────────────────────────────────────────────────────────────────────────

type Phase = 'pre' | 'in' | 'hold' | 'out' | 'done';

const EASE_OUT = 'cubic-bezier(0.16,1,0.3,1)'; // expo-out (--ease-expo-out)
const EASE_IN = 'cubic-bezier(0.7,0,0.84,0)';  // expo-in  (--ease-in-expo)
const GOLD = '#d4af37';
const KEY = 'onyx_splash_shown';

/** What "once" is counted against.
 *
 *  On the public site it is the browser session — a visitor should not be made
 *  to sit through the opening on every page they click.
 *
 *  Behind the login it is the sign-in session instead. Signing in IS the
 *  arrival, and a member who logs out and back in has arrived again; keying
 *  that to the browser session would have shown it to them once and then never
 *  again, which is what happened before this change. */
function storageKey(scope?: string): string {
  return scope ? `${KEY}:${scope}` : KEY;
}

// Three grey smoke blobs: [base offset, disperse target], px.
const BLOBS = [
  { size: 360, color: 'rgba(120,120,124,0.50)', base: [-46, -14], to: [-190, -130], delay: 0 },
  { size: 380, color: 'rgba(90,90,94,0.45)', base: [44, -22], to: [210, -96], delay: 120 },
  { size: 340, color: 'rgba(120,120,124,0.50)', base: [2, 42], to: [10, 210], delay: 240 },
];

export default function SplashIntro({ scope }: { scope?: string } = {}) {
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>('pre');
  const [reduced, setReduced] = useState(false);
  const timers = useRef<number[]>([]);
  const finished = useRef(false);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  useEffect(() => {
    let seen = false;
    const key = storageKey(scope);
    try { seen = sessionStorage.getItem(key) === '1'; } catch { /* private mode */ }
    if (seen) return;                                  // repeat visit → never mount
    try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ }

    const rm = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(rm);
    setShow(true);

    at(30, () => setPhase('in')); // let 'pre' paint, then trigger the transitions
    if (rm) {
      at(430, () => setPhase('out'));   // fade in ~250 + short hold
      at(730, finish);                  // + fade out ~300  (< ~700ms of motion)
    } else {
      at(1650, () => setPhase('hold'));
      at(2050, () => setPhase('out'));
      at(2700, finish);
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  function finish() {
    if (finished.current) return;
    finished.current = true;
    setPhase('done');                        // overlay bg cross-fades to 0
    at(650, () => setShow(false));           // then unmount (out of the a11y tree)
  }

  function skip() {
    if (finished.current || phase === 'out' || phase === 'done') return;
    clearTimers();
    setPhase('out');
    at(reduced ? 320 : 560, finish);
  }

  if (!show) return null;

  const dispersed = phase !== 'pre';
  const bright = phase === 'in' || phase === 'hold';

  // ── Logo motion per phase ──────────────────────────────────────────────────
  let logo: React.CSSProperties;
  if (reduced) {
    const visible = phase === 'in' || phase === 'hold';
    logo = {
      opacity: visible ? 1 : 0,
      transform: 'none',
      filter: 'none',
      transition: `opacity ${phase === 'out' || phase === 'done' ? 300 : 250}ms ease`,
    };
  } else if (phase === 'pre') {
    logo = { opacity: 0, transform: 'scale(0.94)', filter: 'blur(14px)', transition: 'none' };
  } else if (phase === 'in') {
    logo = {
      opacity: 1, transform: 'scale(1)',
      filter: `blur(0px) drop-shadow(0 0 30px rgba(212,175,55,0.45))`,
      transition: `opacity 1500ms ${EASE_OUT} 500ms, transform 1500ms ${EASE_OUT} 500ms, filter 1500ms ${EASE_OUT} 500ms`,
    };
  } else if (phase === 'hold') {
    logo = {
      opacity: 1, transform: 'scale(1)',
      filter: `blur(0px) drop-shadow(0 0 20px rgba(212,175,55,0.3))`,
      transition: `filter 900ms ease`,
    };
  } else {
    // out / done
    logo = {
      opacity: 0, transform: 'scale(1.02)',
      filter: `blur(4px) drop-shadow(0 0 12px rgba(212,175,55,0.18))`,
      transition: `opacity 550ms ${EASE_IN}, transform 550ms ${EASE_IN}, filter 550ms ${EASE_IN}`,
    };
  }

  return (
    <div
      onClick={skip}
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#000000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        opacity: phase === 'done' ? 0 : 1,
        transition: `opacity 600ms ${EASE_OUT}`,
        pointerEvents: phase === 'done' ? 'none' : 'auto',
      }}
    >
      {/* Smoke blobs (skipped entirely under reduced-motion) */}
      {!reduced && BLOBS.map((b, i) => {
        const [x, y] = dispersed ? b.to : b.base;
        return (
          <div
            key={i}
            aria-hidden
            style={{
              position: 'absolute', top: '50%', left: '50%',
              width: b.size, height: b.size, marginLeft: -b.size / 2, marginTop: -b.size / 2,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${b.color}, transparent 68%)`,
              filter: `blur(${dispersed ? 50 : 30}px)`,
              opacity: dispersed ? 0 : 0.9,
              transform: `translate(${x}px, ${y}px) scale(${dispersed ? 1.6 : 1})`,
              transition: `opacity 1400ms ${EASE_OUT} ${b.delay}ms, transform 1400ms ${EASE_OUT} ${b.delay}ms, filter 1400ms ${EASE_OUT} ${b.delay}ms`,
              willChange: 'opacity, transform, filter',
            }}
          />
        );
      })}

      {/* Ambient gold wash — brightest as the logo lands */}
      {!reduced && (
        <div
          aria-hidden
          style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 640, height: 640, marginLeft: -320, marginTop: -320,
            background: `radial-gradient(circle, rgba(212,175,55,0.14), transparent 60%)`,
            opacity: bright ? 1 : 0,
            transition: `opacity 1500ms ${EASE_OUT} 500ms`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Logo lockup: ONYX | Trading */}
      <div
        style={{
          position: 'relative', zIndex: 1,
          display: 'flex', alignItems: 'center', gap: 'clamp(12px, 1.6vw, 22px)',
          willChange: 'opacity, transform, filter',
          ...logo,
        }}
      >
        <span style={{
          fontFamily: 'var(--font-playfair), Georgia, serif',
          fontWeight: 700, letterSpacing: '0.05em', color: '#ffffff',
          fontSize: 'clamp(48px, 9vw, 104px)', lineHeight: 1,
        }}>
          ONYX
        </span>
        <span aria-hidden style={{
          width: 1, height: 'clamp(20px, 3.8vw, 44px)', background: GOLD, flexShrink: 0,
        }} />
        <span style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.32em', color: GOLD,
          fontSize: 'clamp(14px, 2vw, 22px)',
        }}>
          Trading
        </span>
      </div>
    </div>
  );
}
