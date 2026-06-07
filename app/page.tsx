import Link from 'next/link';

const FEATURES = [
  {
    icon: '⚡',
    title: 'Live SMT Tracking',
    description:
      'Real-time Smart Money Tool divergence detection between ES and NQ futures. Identifies institutional divergence at swing highs and lows for high-probability reversal signals.',
  },
  {
    icon: '🧠',
    title: 'Dynamic Macro Bias',
    description:
      'Automated multi-timeframe market structure analysis across D1, H4, H1, and execution frames. BOS, CHoCH, and MSS events synthesised into a single actionable daily directional bias.',
  },
  {
    icon: '📐',
    title: 'MTF Orderflow Arrays',
    description:
      'Institutional order blocks, fair value gaps, and liquidity sweep detection mapped across timeframes. Visual overlays on the live chart highlight unmitigated premium/discount arrays.',
  },
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-[#27272a] shrink-0">
        <div>
          <span className="font-mono font-bold text-[11px] tracking-[0.22em] text-[#f4f4f5]">FRACTAL </span>
          <span className="font-mono font-bold text-[11px] tracking-[0.22em] text-[#3b82f6]">// ENGINE</span>
        </div>
        <Link
          href="/dashboard"
          className="px-4 py-2 text-[11px] font-mono font-semibold tracking-widest uppercase rounded border border-[#3b82f6]/40 text-[#3b82f6] hover:bg-[#3b82f6]/10 transition-colors duration-200"
        >
          Launch Engine
        </Link>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 relative">
        {/* Subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(#3b82f6 1px, transparent 1px), linear-gradient(90deg, #3b82f6 1px, transparent 1px)',
            backgroundSize: '80px 80px',
          }}
        />

        <div className="relative z-10 flex flex-col items-center">
          {/* Eyebrow */}
          <span className="inline-block mb-6 px-3 py-1 rounded-full border border-[#3b82f6]/30 bg-[#3b82f6]/8 text-[10px] font-mono font-semibold text-[#3b82f6] uppercase tracking-[0.35em]">
            Institutional-Grade · CME ES &amp; NQ Futures
          </span>

          {/* Wordmark */}
          <h1 className="font-mono font-bold tracking-tight leading-none text-center mb-6">
            <span className="block text-[clamp(3rem,10vw,7rem)] text-[#f4f4f5]">FRACTAL</span>
            <span className="block text-[clamp(3rem,10vw,7rem)] text-[#3b82f6]">// ENGINE</span>
          </h1>

          {/* Sub-headline */}
          <p className="max-w-lg text-[#71717a] text-[15px] leading-7 font-mono mb-10">
            Multi-timeframe Smart Money Concepts platform for ES &amp; NQ futures.
            Real-time structure, orderflow arrays, and institutional bias detection —
            all in one unified workspace.
          </p>

          {/* CTA */}
          <Link
            href="/dashboard"
            className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-lg bg-[#3b82f6] text-white font-mono font-bold text-sm tracking-widest uppercase transition-all duration-200 hover:bg-[#2563eb] hover:shadow-[0_0_32px_rgba(59,130,246,0.35)]"
          >
            <span>Launch Engine</span>
            <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
          </Link>

          {/* Ticker strip */}
          <div className="flex items-center gap-6 mt-10 text-[10px] font-mono text-[#3f3f46] uppercase tracking-widest">
            <span>ES · 7549.50</span>
            <span className="h-3 w-px bg-[#27272a]" />
            <span>NQ · 20078.50</span>
            <span className="h-3 w-px bg-[#27272a]" />
            <span className="text-[#22c55e]">● Live Simulation</span>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center font-mono font-bold text-xs uppercase tracking-[0.35em] text-[#3b82f6] mb-10">
            Core Capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="bg-[#18181b] border border-[#27272a] rounded-lg p-6 hover:border-[#3b82f6]/30 transition-colors duration-300"
              >
                <span className="text-3xl block mb-4">{f.icon}</span>
                <h3 className="font-mono font-bold text-sm text-[#f4f4f5] mb-3 tracking-wide">
                  {f.title}
                </h3>
                <p className="text-[#71717a] text-[13px] leading-6">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-[#27272a] px-8 py-5 flex items-center justify-between shrink-0">
        <div>
          <span className="font-mono text-[10px] text-[#3f3f46] tracking-widest uppercase">FRACTAL // ENGINE</span>
        </div>
        <span className="text-[10px] font-mono text-[#3f3f46] tracking-wider">
          Simulated data for educational &amp; research purposes only.
        </span>
      </footer>
    </main>
  );
}
