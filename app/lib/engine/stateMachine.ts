import {
  TF_PRIORITY, TF_MS,
  type TF, type Phase, type Direction, type Mode,
  type Candle, type FVG, type ManipLeg, type LiquidityLevel,
  type MachineState, type Signal, type SMEvent,
} from './types';
import { engineEmitter } from './emitter';

const STORAGE_KEY   = 'onyx.sm.state';
const LEG_HIST_MAX  = 5;

// ── UTC helpers (timezone-safe) ───────────────────────────────

const utcToday = (): string => new Date().toISOString().slice(0, 10);
const utcNow   = (): number => Date.now();

// ─────────────────────────────────────────────────────────────────────────────

export class StateMachine {
  private s: MachineState;

  constructor(private onSignal: (sig: Signal) => void) {
    this.s = this.loadState() ?? this.freshState();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  processBatch(events: SMEvent[]): void {
    const ordered = this.orderBatch(events);
    for (const event of ordered) {
      this.processOne(event);
      if (this.s.is_emitted) break;   // signal fired — skip rest of batch
    }
    this.persist();
  }

  rehydrate(missedCandles: Candle[]): void {
    for (const candle of missedCandles) {
      if (this.s.phase === 'IDLE') break;
      this.processOne({ type: 'CANDLE_CLOSE', candle, tf: candle.tf });
    }
    this.persist();
  }

  getState(): MachineState { return { ...this.s }; }

  reset(): void { this.resetToIdle(); this.persist(); }

  // ── Batch ordering ────────────────────────────────────────────────────────

  private orderBatch(events: SMEvent[]): SMEvent[] {
    const legs   = events.filter(e => e.type === 'LEG_FOUND') as
                   Extract<SMEvent, { type: 'LEG_FOUND' }>[];
    const others = events.filter(e => e.type !== 'LEG_FOUND');
    const sorted = [...legs].sort(
      (a, b) => TF_PRIORITY.indexOf(a.tf) - TF_PRIORITY.indexOf(b.tf),
    );
    return [...others, ...sorted];
  }

  // ── Event router ──────────────────────────────────────────────────────────

  private processOne(e: SMEvent): void {
    switch (e.type) {
      case 'BIAS_SET':         return this.onBiasSet(e.bias, e.mode);
      case 'ZONE_TOUCHED':     return this.onZoneTouched(e.zone);
      case 'ZONE_ENTERED':     return this.onZoneEntered(e.fvg);
      case 'LEG_FOUND':        return this.onLegFound(e);
      case 'CANDLE_CLOSE':     return this.onCandleClose(e.candle, e.tf);
      case 'ZONE_INVALIDATED': return this.onZoneInvalidated();
    }
  }

  // ── Phase handlers ────────────────────────────────────────────────────────

  private onBiasSet(bias: Direction, mode: Mode): void {
    if (this.s.bias && this.s.bias !== bias && this.s.phase !== 'IDLE') {
      this.resetToIdle();
    }
    this.s.bias = bias;
    this.s.mode = mode;
    this.emitPhase();
  }

  private onZoneTouched(zone: LiquidityLevel): void {
    if (this.s.phase !== 'IDLE' || this.s.mode !== 'REVERSAL') return;
    this.transition('ZONE_ACTIVE', { zone });
  }

  private onZoneEntered(fvg: FVG): void {
    if (this.s.phase !== 'IDLE' || this.s.mode !== 'CONTINUATION') return;
    this.transition('ZONE_ACTIVE', { zone: fvg });
  }

  private onLegFound(e: Extract<SMEvent, { type: 'LEG_FOUND' }>): void {
    if (this.s.phase !== 'ZONE_ACTIVE' && this.s.phase !== 'MANIP_WATCH') return;
    if (!this.s.bias) return;

    const newLeg = this.s.mode === 'REVERSAL' ? e.reversal_leg : e.continuation_leg;
    if (!newLeg) return;
    if (newLeg.direction === this.s.bias) return;   // must be counter-trend

    if (this.s.phase === 'ZONE_ACTIVE') {
      this.transition('MANIP_WATCH', { active_leg: newLeg });
      return;
    }
    this.evaluateHierarchy(newLeg);
  }

  private onCandleClose(candle: Candle, tf: TF): void {
    // Zone invalidation check (Continuation) — any TF
    if (this.s.mode === 'CONTINUATION' && this.s.zone && this.s.phase === 'ZONE_ACTIVE') {
      const zone = this.s.zone as FVG;
      if ('gap_top' in zone && this.isZoneInvalidated(candle, zone)) {
        this.onZoneInvalidated();
        return;
      }
    }

    const leg = this.s.active_leg;
    if (!leg || tf !== leg.tf) return;

    if (this.s.phase === 'MANIP_WATCH') {
      if (this.isInverse(candle, leg.fvg)) {
        this.transition('CONFIRMATION');
        this.emitSignal();
        return;
      }
      if (this.isStructureBreak(candle, leg)) {
        leg.invalidated = true;
        this.fallbackOrIdle();
      }
    }
  }

  private onZoneInvalidated(): void {
    this.resetToIdle();
  }

  // ── Hierarchy evaluation ──────────────────────────────────────────────────

  private evaluateHierarchy(newLeg: ManipLeg): void {
    const cur    = this.s.active_leg!;
    const newPri = TF_PRIORITY.indexOf(newLeg.tf);
    const curPri = TF_PRIORITY.indexOf(cur.tf);

    if (newPri <= curPri) {
      if (!this.isSameStructure(newLeg, cur)) this.setActiveLeg(newLeg);
      return;
    }
    if (this.isNewerAndCloser(newLeg, cur)) {
      this.s.leg_history = [cur, ...this.s.leg_history].slice(0, LEG_HIST_MAX);
      this.setActiveLeg(newLeg);
    }
  }

  private isSameStructure(a: ManipLeg, b: ManipLeg): boolean {
    const overlap  = this.overlapPct(a.fvg, b.fvg);
    const withinTf = Math.abs(a.formed_at - b.formed_at) < TF_MS[a.tf] * 2;
    return overlap > 0.75 && withinTf;
  }

  private isNewerAndCloser(newLeg: ManipLeg, cur: ManipLeg): boolean {
    return newLeg.formed_at > cur.formed_at &&
           newLeg.fvg.gap_bottom >= cur.fvg.gap_bottom &&
           newLeg.fvg.gap_top    <= cur.fvg.gap_top;
  }

  private overlapPct(a: FVG, b: FVG): number {
    const top    = Math.min(a.gap_top, b.gap_top);
    const bottom = Math.max(a.gap_bottom, b.gap_bottom);
    if (top <= bottom) return 0;
    return (top - bottom) / (a.gap_top - a.gap_bottom);
  }

  // ── Fallback ──────────────────────────────────────────────────────────────

  private fallbackOrIdle(): void {
    const candidate = this.s.leg_history.find(l => this.isLegStillValid(l));
    if (candidate) {
      this.s.leg_history = this.s.leg_history.filter(l => l !== candidate);
      this.setActiveLeg(candidate);
    } else {
      this.transition('ZONE_ACTIVE', { active_leg: null, leg_history: [] });
    }
  }

  private isLegStillValid(leg: ManipLeg): boolean {
    if (leg.invalidated || leg.inversed)               return false;
    if (utcNow() - leg.formed_at > TF_MS[leg.tf] * 10) return false;
    return true;
  }

  // ── Inverse & invalidation ────────────────────────────────────────────────

  private isInverse(candle: Candle, fvg: FVG): boolean {
    return fvg.direction === 'bullish'
      ? candle.close > fvg.gap_top
      : candle.close < fvg.gap_bottom;
  }

  private isStructureBreak(candle: Candle, leg: ManipLeg): boolean {
    const [c1] = leg.fvg.candles;
    return leg.direction === 'bullish'
      ? candle.close < c1.low
      : candle.close > c1.high;
  }

  private isZoneInvalidated(candle: Candle, zone: FVG): boolean {
    return zone.direction === 'bullish'
      ? candle.close < zone.gap_bottom
      : candle.close > zone.gap_top;
  }

  // ── Signal ────────────────────────────────────────────────────────────────

  private emitSignal(): void {
    if (this.s.is_emitted) return;
    this.s.is_emitted = true;

    const { active_leg, zone, bias, mode } = this.s;
    if (!active_leg || !zone || !bias || !mode) {
      this.onSignal({ result: 'NO', reason: 'incomplete_state', timestamp: utcNow() });
      this.resetToIdle();
      return;
    }

    active_leg.inversed = true;
    this.onSignal({
      result:   'YES',
      mode,
      bias,
      entry_tf: active_leg.tf,
      fvg:      active_leg.fvg,
      zone,
      timestamp: utcNow(),
    });

    this.resetToIdle();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private transition(phase: Phase, patch: Partial<MachineState> = {}): void {
    this.s = { ...this.s, phase, updated_at: utcNow(), ...patch };
    this.emitPhase();
  }

  private setActiveLeg(leg: ManipLeg): void {
    this.s.active_leg = leg;
    this.s.updated_at = utcNow();
  }

  private emitPhase(): void {
    engineEmitter.emit('phase_change', this.s.phase);
  }

  private resetToIdle(): void {
    this.s = {
      ...this.freshState(),
      mode:       this.s.mode,
      bias:       this.s.bias,
      session_id: this.s.session_id,
    };
    this.emitPhase();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.s)); } catch {}
    fetch('/api/preferences', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sm_state: this.s }),
    }).catch(() => {});
  }

  private loadState(): MachineState | null {
    let raw: string | null = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { return null; }
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw) as MachineState;
      if (!saved.phase || !saved.session_id || !Array.isArray(saved.leg_history)) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      if (saved.session_id !== utcToday()) return null;
      return saved;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  private freshState(): MachineState {
    return {
      phase:       'IDLE',
      mode:        null,
      bias:        null,
      zone:        null,
      active_leg:  null,
      leg_history: [],
      is_emitted:  false,
      session_id:  utcToday(),
      updated_at:  utcNow(),
    };
  }
}
