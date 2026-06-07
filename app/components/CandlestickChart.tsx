'use client';

import { useEffect, useRef } from 'react';
import type { OrderBlock, FVGZone } from '../hooks/useMarketStream';

/**
 * Retained for prop-API compatibility with DashboardView.
 * The TradingView widget renders its own overlays from live data;
 * these values drive the Analytics sidebar instead.
 */
export interface ChartOverlays {
  ob: OrderBlock | null;
  htfFVG: FVGZone | null;
  equilibrium: number;
}

interface Props {
  /** TradingView symbol, e.g. "CME_MINI:ES1!" */
  symbol: string;
  /** Bar interval: "1"=1m "5"=5m "15"=15m "60"=1H "D"=Daily */
  interval?: string;
  /** Analytics overlay data — used by the sidebar, not rendered on the TV widget */
  overlays?: ChartOverlays;
}

interface TVWidgetConfig {
  autosize: boolean;
  symbol: string;
  interval: string;
  timezone: string;
  theme: 'dark' | 'light';
  style: string;
  locale: string;
  backgroundColor: string;
  gridColor: string;
  allow_symbol_change: boolean;
  save_image: boolean;
  calendar: boolean;
  hide_volume: boolean;
  support_host: string;
}

export default function CandlestickChart({ symbol, interval = '5' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Destroy any previous widget instance cleanly
    el.innerHTML = '';

    // TradingView Advanced Chart Widget pattern:
    //   <div.tradingview-widget-container>           ← el (containerRef)
    //     <div.tradingview-widget-container__widget> ← TV renders chart here
    //     <script src="embed-widget-advanced-chart.js">{ JSON config }</script>
    // The script reads its own textContent as widget configuration on load.

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.cssText = 'height:100%;width:100%;';
    el.appendChild(widgetDiv);

    const config: TVWidgetConfig = {
      autosize:           true,
      symbol,
      interval,
      timezone:           'America/New_York',
      theme:              'dark',
      style:              '1',   // Candlestick
      locale:             'en',
      backgroundColor:    '#18181b',
      gridColor:          '#27272a',
      allow_symbol_change: false,
      save_image:         false,
      calendar:           false,
      hide_volume:        false,
      support_host:       'https://www.tradingview.com',
    };

    const script = document.createElement('script');
    script.type    = 'text/javascript';
    script.async   = true;
    script.src     = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    // textContent must be set BEFORE appending to DOM —
    // TradingView reads it on script execution to configure the widget.
    script.textContent = JSON.stringify(config);
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [symbol, interval]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full h-full"
      // Suppress browser light/dark auto-inversion — TV widget handles its own theme
      style={{ colorScheme: 'dark' }}
    />
  );
}
