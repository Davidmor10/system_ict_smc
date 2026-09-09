'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Which portfolio you are looking at, on every screen.
//
// It sits directly under the wordmark and above the nav, because it scopes
// everything below it: the journal, the statistics, the analytics, the coach.
// A control that changes the meaning of every number on the page cannot live
// on a settings screen the trader visits twice a year.
//
// It renders nothing until the list has been hydrated. A switcher that shows
// "no portfolio" for a moment on every load, to someone who has one, teaches
// them not to trust it.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePortfolios } from './PortfolioProvider';
// Its own styles, rather than relying on Sidebar having imported them. The
// switcher is rendered by the rail today, but a component whose appearance
// depends on a sibling's import is one move away from shipping unstyled.
import './sidebar.css';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function PortfolioSwitcher() {
  const { portfolios, selected, ready, select } = usePortfolios();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  // Nothing decided yet. An empty frame holds the space so the nav below does
  // not jump when the answer arrives.
  if (!ready) return <div className="sb-pf-skeleton" aria-hidden />;

  if (!selected) {
    return (
      <div className="sb-pf">
        <Link href="/dashboard/portfolios" className="sb-pf-empty">
          <span className="sb-pf-empty-k">אין תיק מחובר</span>
          <span className="sb-pf-empty-cta">חיבור תיק ←</span>
        </Link>
      </div>
    );
  }

  const others = portfolios.filter(p => p.id !== selected.id);

  return (
    <div className="sb-pf" ref={box}>
      <button
        type="button"
        className="sb-pf-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="sb-pf-name">{selected.name || 'תיק ללא שם'}</span>
        <span className="sb-pf-meta" dir="ltr">{usd(selected.startingBalanceUsd)}</span>
        <span className="sb-pf-caret" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="sb-pf-menu" role="menu">
          {others.map(p => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className="sb-pf-item"
              onClick={() => { select(p.id); setOpen(false); }}
            >
              <span className="sb-pf-item-name">{p.name || 'תיק ללא שם'}</span>
              <span className="sb-pf-item-meta" dir="ltr">{usd(p.startingBalanceUsd)}</span>
            </button>
          ))}
          {others.length > 0 && <div className="sb-pf-rule" />}
          <Link href="/dashboard/portfolios?add=1" className="sb-pf-item is-link" role="menuitem" onClick={() => setOpen(false)}>
            + הוספת חשבון מסחר
          </Link>
          <Link href="/dashboard/portfolios" className="sb-pf-item is-link" role="menuitem" onClick={() => setOpen(false)}>
            ניהול תיקים
          </Link>
        </div>
      )}
    </div>
  );
}
