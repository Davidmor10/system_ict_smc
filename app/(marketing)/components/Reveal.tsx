'use client';

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Reveal — content arrives as it is scrolled to.
//
// One IntersectionObserver per element, disconnected the moment it fires. The
// reveal is one-way on purpose: elements that fade back out on scroll-up read
// as a glitch rather than as motion, and they make a long sales page feel
// unstable exactly where it needs to feel composed.
//
// Under prefers-reduced-motion nothing animates and everything is visible
// immediately — the observer never runs.
// ─────────────────────────────────────────────────────────────────────────────

export default function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
  ...rest
}: {
  children: React.ReactNode;
  delay?: number;
  as?: 'div' | 'section' | 'li';
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(true); return; }

    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) { setShown(true); io.disconnect(); }
      },
      // Fires a little before the element's top edge arrives, so the motion is
      // finishing as it reaches comfortable reading height rather than starting.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={`lp-rv${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
