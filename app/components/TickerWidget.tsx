'use client';

import { useEffect, useRef, memo } from 'react';

// Official TradingView Single-Quote widget — accurate real-time price, tick and
// daily %. Injected client-side; transparent + dark to blend with the theme.
function TickerWidget({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    container.appendChild(widget);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      width: '100%',
      isTransparent: true,
      colorTheme: 'dark',
      locale: 'en',
    });
    container.appendChild(script);

    return () => { container.innerHTML = ''; };
  }, [symbol]);

  return <div ref={containerRef} dir="ltr" className="tradingview-widget-container w-full" />;
}

export default memo(TickerWidget);
