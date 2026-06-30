import Link from 'next/link';

// Shown to 'free' users — prompts the Pro upgrade funnel.
export default function UpgradeBanner() {
  return (
    <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-2.5 border-b border-[#d4af37]/30 bg-[#d4af37]/8" dir="rtl">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="h-2 w-2 rounded-full bg-[#d4af37] shrink-0" />
        <span className="text-sm font-bold font-mono text-white truncate">
          חשבון חינמי — שדרג ל-PRO לפתיחת מסך הניתוחים, יומן המסחר ומדדי הביצוע.
        </span>
      </div>
      <Link
        href="/checkout"
        className="shrink-0 px-4 py-1.5 rounded-xl bg-[#d4af37] text-black font-serif text-sm font-bold [box-shadow:0_0_24px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_40px_rgba(212,175,55,0.6)] transition-shadow duration-200"
      >
        שדרוג ל-PRO ←
      </Link>
    </div>
  );
}
