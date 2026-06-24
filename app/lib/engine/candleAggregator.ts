import { TF_PRIORITY, TF_MS, type TF, type Tick, type Candle } from './types';

export class CandleAggregator {
  private queue:      Tick[]          = [];
  private processing  = false;
  private live        = new Map<TF, Candle>();

  constructor(private onClosed: (candles: Candle[]) => void) {}

  onTick(tick: Tick): void {
    this.queue.push(tick);
    if (!this.processing) this.flush();
  }

  private flush(): void {
    this.processing = true;
    while (this.queue.length > 0) {
      const tick   = this.queue.shift()!;
      const closed: Candle[] = [];

      // Process all TFs atomically for this tick — highest first
      for (const tf of TF_PRIORITY) {
        const result = this.update(tf, tick);
        if (result) closed.push(result);
      }

      if (closed.length > 0) this.onClosed(closed);
    }
    this.processing = false;
  }

  private update(tf: TF, tick: Tick): Candle | null {
    const period = TF_MS[tf];
    const slot   = Math.floor(tick.timestamp / period) * period;
    const live   = this.live.get(tf);

    if (!live || slot > live.open_time) {
      const closed = live ? { ...live } : null;
      this.live.set(tf, {
        tf, open_time: slot,
        open: tick.price, high: tick.price,
        low:  tick.price, close: tick.price,
      });
      return closed;
    }

    live.high  = Math.max(live.high, tick.price);
    live.low   = Math.min(live.low,  tick.price);
    live.close = tick.price;
    return null;
  }
}
