'use client';

import { useEffect, useRef, memo } from 'react';

const SYMBOLS: Record<string, string> = {
  ES: 'FOREXCOM:SPX500',
  NQ: 'CAPITALCOM:US100',
};

interface Props {
  symbol: 'ES' | 'NQ';
  interval?: string;
}

const OVERRIDES = {
  'paneProperties.background': '#000000',
  'paneProperties.backgroundType': 'solid',
  'paneProperties.vertGridProperties.color': 'rgba(0,0,0,0)',
  'paneProperties.horzGridProperties.color': 'rgba(0,0,0,0)',

  // Bullish — green
  'mainSeriesProperties.candleStyle.upColor':       '#4a7c59',
  'mainSeriesProperties.candleStyle.borderUpColor': '#6fa580',
  'mainSeriesProperties.candleStyle.wickUpColor':   '#6fa580',

  // Bearish — red/burgundy
  'mainSeriesProperties.candleStyle.downColor':       '#7c3a3a',
  'mainSeriesProperties.candleStyle.borderDownColor': '#c98080',
  'mainSeriesProperties.candleStyle.wickDownColor':   '#c98080',

  'mainSeriesProperties.candleStyle.drawBorder': true,
  'mainSeriesProperties.candleStyle.drawWick':   true,
} as const;

function SmcChart({ symbol, interval = '5' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const tvSymbol = SYMBOLS[symbol] ?? symbol;

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
      style: '1',
      locale: 'en',
      backgroundColor: '#000000',
      gridColor: 'rgba(0,0,0,0)',
      hide_side_toolbar: true,
      hide_top_toolbar: true,
      hide_legend: true,
      hide_volume: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      enable_publishing: false,
      support_host: 'https://www.tradingview.com',
      overrides: OVERRIDES,
      studies_overrides: {
        'volume.volume.color.0': '#7c3a3a',
        'volume.volume.color.1': '#4a7c59',
      },
    });
    container.appendChild(script);

    return () => { container.innerHTML = ''; };
  }, [symbol, interval]);

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
