// Shown to 'pro' users — confirms elevated access (counterpart to UpgradeBanner).
export default function AdvancedFeatures() {
  return (
    <div
      className="shrink-0 flex items-center justify-between gap-4 px-6 py-2 border-b border-[#d4af37]/20 bg-gradient-to-r from-[#d4af37]/8 to-transparent"
      dir="rtl"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="h-2 w-2 rounded-full bg-[#d4af37] animate-pulse shrink-0" />
        <span className="text-sm font-bold font-mono text-white/80 truncate">
          גישת PRO פעילה — מסך הניתוחים, יומן המסחר ומדדי הביצוע פתוחים.
        </span>
      </div>
      <span className="shrink-0 px-3 py-1 rounded-sm border border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37] font-serif text-xs font-bold tracking-[0.2em] uppercase [box-shadow:0_0_20px_rgba(212,175,55,0.25)]">
        PRO
      </span>
    </div>
  );
}
