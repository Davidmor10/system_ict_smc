import Link from 'next/link';

const FEATURES = [
  {
    label: 'I',
    title: 'SMT Divergence',
    description:
      'Real-time Smart Money Tool divergence detection across ES and NQ futures. Identifies institutional divergence at swing highs and lows for high-probability reversal confirmation.',
  },
  {
    label: 'II',
    title: 'Dynamic Macro Bias',
    description:
      'Automated multi-timeframe structure analysis across D1, H4, H1, and execution frames. BOS, CHoCH, and MSS events synthesised into a single locked directional bias.',
  },
  {
    label: 'III',
    title: 'MTF Orderflow Arrays',
    description:
      'Institutional order blocks, fair value gaps, and liquidity sweep detection mapped across timeframes. Unmitigated premium and discount arrays visualised on the live chart.',
  },
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-[#c0c0c0] flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-[#1c1c1e] shrink-0">
        <div className="flex items-baseline gap-3">
          <span
            className="font-serif text-[18px] tracking-[0.06em] text-[#c0c0c0]"
            style={{ fontStyle: 'normal' }}
          >
            Onyx
          </span>
          <span className="font-mono text-[8px] tracking-[0.38em] text-[#c9a84c] uppercase">
            Trading
          </span>
        </div>
        <Link
          href="/dashboard"
          className="px-5 py-2 text-[9px] font-mono font-medium tracking-[0.22em] uppercase rounded border border-[#c9a84c]/30 text-[#c9a84c] hover:bg-[#c9a84c]/8 hover:border-[#c9a84c]/50 transition-all duration-700 ease-in-out"
        >
          Enter Platform
        </Link>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-32">

        {/* Eyebrow */}
        <span className="inline-block mb-8 px-4 py-1.5 border border-[#1c1c1e] text-[8px] font-mono tracking-[0.38em] text-[#52525b] uppercase">
          Institutional · CME ES &amp; NQ Futures
        </span>

        {/* Wordmark */}
        <h1 className="font-serif font-normal leading-[0.92] text-center mb-8">
          <span
            className="block text-[clamp(4rem,12vw,8.5rem)] text-[#c0c0c0] tracking-[-0.01em]"
            style={{ fontStyle: 'normal' }}
          >
            Onyx
          </span>
          <span className="block font-mono text-[clamp(0.65rem,1.8vw,1rem)] tracking-[0.48em] text-[#c9a84c] uppercase mt-2">
            Trading Platform
          </span>
        </h1>

        {/* Sub-headline */}
        <p className="max-w-md text-[#52525b] text-[13px] leading-7 font-mono mb-12 tracking-wide">
          Multi-timeframe Smart Money Concepts for ES &amp; NQ futures.
          Real-time structure, orderflow arrays, and institutional bias
          locked to completed H4 and D1 candles.
        </p>

        {/* CTA */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-4 px-8 py-4 border border-[#c9a84c]/40 text-[#c9a84c] font-mono text-[10px] tracking-[0.28em] uppercase hover:bg-[#c9a84c]/8 hover:border-[#c9a84c]/60 transition-all duration-700 ease-in-out"
        >
          <span>Enter Platform</span>
          <span className="text-[#c9a84c]/50">→</span>
        </Link>

        {/* Status strip */}
        <div className="flex items-center gap-6 mt-14 text-[8px] font-mono text-[#52525b] uppercase tracking-[0.22em]">
          <span>ES Futures</span>
          <span className="h-3 w-px bg-[#1c1c1e]" />
          <span>NQ Futures</span>
          <span className="h-3 w-px bg-[#1c1c1e]" />
          <span className="flex items-center gap-1.5 text-[#c9a84c]">
            <span className="h-1 w-1 rounded-full bg-[#c9a84c]" />
            Live
          </span>
        </div>
      </section>

      {/* ── Divider ───────────────────────────────────────────── */}
      <div className="h-px bg-[#1c1c1e] mx-10" />

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="px-10 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-serif text-[11px] tracking-[0.22em] text-[#c9a84c] uppercase mb-14 text-center"
            style={{ fontStyle: 'normal' }}>
            Core Capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#1c1c1e]">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="bg-[#050505] p-8 hover:bg-[#0d0d0f] transition-all duration-700 ease-in-out group"
              >
                <span className="block font-mono text-[9px] tracking-[0.35em] text-[#52525b] uppercase mb-5">
                  {f.label}
                </span>
                <h3
                  className="font-serif text-[17px] text-[#c0c0c0] mb-4 leading-tight tracking-wide group-hover:text-[#c9a84c] transition-all duration-700 ease-in-out"
                  style={{ fontStyle: 'normal' }}
                >
                  {f.title}
                </h3>
                <p className="text-[#52525b] text-[12px] leading-6 font-mono tracking-wide">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-[#1c1c1e] px-10 py-5 flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-2">
          <span
            className="font-serif text-[11px] tracking-[0.06em] text-[#52525b]"
            style={{ fontStyle: 'normal' }}
          >
            Onyx
          </span>
          <span className="font-mono text-[7px] tracking-[0.35em] text-[#52525b] uppercase">Trading</span>
        </div>
        <span className="text-[8px] font-mono text-[#3a3a3a] tracking-[0.18em] uppercase">
          Simulated data · Educational &amp; Research use only
        </span>
      </footer>
    </main>
  );
}
