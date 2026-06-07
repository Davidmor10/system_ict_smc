'use client';

const SYMBOLS: Record<string, string> = {
  ES: 'CAPITALCOM:US500',
  NQ: 'CAPITALCOM:US100',
};

interface Props {
  symbol: 'ES' | 'NQ';
  interval?: string;
}

export default function SmcChart({ symbol, interval = '5' }: Props) {
  const tv = encodeURIComponent(SYMBOLS[symbol] ?? symbol);
  const src =
    `https://www.tradingview.com/widgetembed/` +
    `?symbol=${tv}` +
    `&interval=${interval}` +
    `&theme=dark` +
    `&style=1` +
    `&locale=en` +
    `&backgroundColor=%2318181b` +
    `&gridColor=%2327272a` +
    `&allow_symbol_change=false` +
    `&save_image=false` +
    `&calendar=false` +
    `&hide_volume=false` +
    `&enable_publishing=false` +
    `&hide_legend=false`;

  return (
    <iframe
      src={src}
      title={`${symbol} Chart`}
      className="w-full h-full border-0"
      style={{ colorScheme: 'dark', minHeight: 0 }}
      allow="fullscreen"
      loading="lazy"
    />
  );
}
