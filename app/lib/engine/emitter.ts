import type { Phase, Signal } from './types';

type Events = {
  signal:       Signal;
  phase_change: Phase;
};

type Handler<T> = (data: T) => void;

class TypedEmitter<T extends Record<string, unknown>> {
  private map = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof T & string>(event: K, fn: Handler<T[K]>): () => void {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn as Handler<unknown>);
    return () => this.map.get(event)?.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof T & string>(event: K, data: T[K]): void {
    this.map.get(event)?.forEach(fn => fn(data as unknown));
  }
}

export const engineEmitter = new TypedEmitter<Events>();
