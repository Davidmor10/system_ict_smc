'use client';

import { useRef, useState } from 'react';

/** Hover tooltip with a 200ms show-delay, so it doesn't flicker on quick passes. */
export default function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function onEnter() {
    timerRef.current = setTimeout(() => setShow(true), 200);
  }
  function onLeave() {
    clearTimeout(timerRef.current);
    setShow(false);
  }

  return (
    <span className="relative inline-flex" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      {show && (
        <span
          role="tooltip"
          className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 rounded-lg border border-white/10 bg-[#0a0a0b] px-3 py-2 text-[11px] font-mono leading-relaxed text-white/70 shadow-xl pointer-events-none transition-opacity duration-200"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[#0a0a0b] border-r border-b border-white/10" />
        </span>
      )}
    </span>
  );
}
