import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] px-6 text-center">
      <p className="font-mono text-[13px] tracking-wide text-white/40">404</p>
      <h1 className="text-lg text-white/80">הדף לא נמצא.</h1>
      <Link
        href="/"
        className="rounded-full border border-[#d4af37]/30 bg-[#d4af37]/[0.06] px-5 py-2 text-sm text-[#d4af37] transition-colors hover:bg-[#d4af37]/[0.12]"
      >
        חזרה לדף הבית
      </Link>
    </div>
  );
}
