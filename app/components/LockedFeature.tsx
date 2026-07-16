import Link from 'next/link';

interface LockedFeatureProps {
  title: string;
  description: string;
  ctaLabel?: string;
  children: React.ReactNode;
}

/** Wraps a Deluxe-only page for a FREE user: the real page still renders
    underneath (so the feature is visibly "there"), blurred and inert, with
    an upgrade prompt on top. Server component — no client state needed. */
export default function LockedFeature({ title, description, ctaLabel = 'שדרוג ל-Deluxe ←', children }: LockedFeatureProps) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="pointer-events-none select-none h-full overflow-hidden [filter:blur(6px)] opacity-40" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-6" dir="rtl">
        <div className="max-w-sm w-full rounded-2xl border border-[#d4af37]/40 bg-black/90 p-6 text-center [box-shadow:0_0_60px_rgba(212,175,55,0.15)]">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#d4af37]/10 border border-[#d4af37]/40 text-[#d4af37] text-xl">
            🔒
          </div>
          <h2 className="font-serif text-lg font-bold text-white mb-2">{title}</h2>
          <p className="text-sm text-[#c0c0c0]/80 mb-5 leading-relaxed">{description}</p>
          <Link
            href="/checkout"
            className="inline-block px-5 py-2 rounded-xl bg-[#d4af37] text-black font-serif text-sm font-bold [box-shadow:0_0_24px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_40px_rgba(212,175,55,0.6)] transition-shadow duration-200"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
