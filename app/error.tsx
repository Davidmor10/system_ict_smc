'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[app error boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] px-6 text-center">
      <p className="font-mono text-[13px] tracking-wide text-white/40">שגיאה בלתי צפויה</p>
      <h1 className="text-lg text-white/80">משהו השתבש. אפשר לנסות שוב.</h1>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="rounded-full border border-[#d4af37]/30 bg-[#d4af37]/[0.06] px-5 py-2 text-sm text-[#d4af37] transition-colors hover:bg-[#d4af37]/[0.12]"
      >
        נסה שוב
      </button>
    </div>
  );
}
