'use client';

/** Fixed brand header, visible on mobile (≤880px) only. */
export default function MobileHeader() {
  return (
    <header
      className="fixed top-0 inset-x-0 z-[60] h-[54px] flex items-center justify-between px-4
                 min-[881px]:hidden"
      style={{
        background: 'rgba(8,8,9,.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid #1c1c1e',
      }}
    >
      {/* Brand */}
      <div className="flex items-baseline gap-[7px] leading-none">
        <span className="font-serif text-[21px] font-bold text-white tracking-[0.04em]">ONYX</span>
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-[#d4af37]">Trading</span>
      </div>

      {/* PRO badge + live dot */}
      <div className="flex items-center gap-2">
        <span
          className="px-2 py-0.5 rounded-sm border border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37]
                     font-mono text-[10px] font-bold tracking-[0.2em] uppercase"
          style={{ boxShadow: '0 0 14px rgba(212,175,55,.22)' }}
        >
          PRO
        </span>
        {/* Live pulse */}
        <span
          className="h-2 w-2 rounded-full bg-[#d4af37] animate-pulse"
          style={{ boxShadow: '0 0 8px rgba(212,175,55,.7)' }}
        />
      </div>
    </header>
  );
}
