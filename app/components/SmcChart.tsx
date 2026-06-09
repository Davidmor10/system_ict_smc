'use client';

import { useEffect, useRef, memo } from 'react';

const SYMBOLS: Record<string, string> = {
  ES: 'CAPITALCOM:US500',
  NQ: 'CAPITALCOM:US100',
};

interface Props {
  symbol: 'ES' | 'NQ';
  interval?: string;
}

// Monochromatic "Quiet Luxury" overrides — pitch-black, gridless, B&W candles.
const OVERRIDES = {
  'paneProperties.background': '#000000',
  'paneProperties.backgroundType': 'solid',
  'paneProperties.vertGridProperties.color': 'rgba(0,0,0,0)',
  'paneProperties.horzGridProperties.color': 'rgba(0,0,0,0)',

  // Bullish — solid white (body, border, wick)
  'mainSeriesProperties.candleStyle.upColor':       '#ffffff',
  'mainSeriesProperties.candleStyle.borderUpColor': '#ffffff',
  'mainSeriesProperties.candleStyle.wickUpColor':   '#ffffff',

  // Bearish — rich charcoal body with a sharp contrasting border/wick so it
  // stays fully legible against the pitch-black background.
  'mainSeriesProperties.candleStyle.downColor':       '#1c1c1e',
  'mainSeriesProperties.candleStyle.borderDownColor': '#787878',
  'mainSeriesProperties.candleStyle.wickDownColor':   '#787878',

  'mainSeriesProperties.candleStyle.drawBorder': true,
  'mainSeriesProperties.candleStyle.drawWick':   true,
} as const;

function SmcChart({ symbol, interval = '5' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const tvSymbol = SYMBOLS[symbol] ?? symbol;

    // Build the widget host imperatively so React never owns these nodes
    // (keeps hydration clean — SSR only renders the empty ref container).
    container.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    container.appendChild(widget);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',                  // candlesticks
      locale: 'en',
      backgroundColor: '#000000',
      gridColor: 'rgba(0,0,0,0)',
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      enable_publishing: false,
      support_host: 'https://www.tradingview.com',
      overrides: OVERRIDES,
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, interval]);

  // dir="ltr" guard: prevents the chart from inverting inside Hebrew/RTL layouts.
  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="tradingview-widget-container w-full h-full"
      style={{ minHeight: 0, colorScheme: 'dark' }}
    />
  );
}

export default memo(SmcChart);
