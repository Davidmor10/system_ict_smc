'use client';

import { useState, useCallback } from 'react';
import type { SMEvent, Direction, Mode, MachineState } from '../lib/engine/types';

// ── Fake data factories ───────────────────────────────────────────────────────

function makeCandle(tf: string, open: number, high: number, low: number, close: number, offsetMs = 0) {
  return { tf, open, high, low, close, open_time: Date.now() - offsetMs } as import('../lib/engine/types').Candle;
}

function makeBearishFVG(base: number) {
  // c3.high < c1.low → bearish FVG
  const c1 = makeCandle('1m', base + 4, base + 6, base + 2, base + 5, 180_000);
  const c2 = makeCandle('1m', base + 5, base + 6, base - 4, base - 3, 120_000);
  const c3 = makeCandle('1m', base - 3, base - 1, base - 5, base - 4, 60_000);
  return {
    tf: '1m' as const,
    direction: 'bearish' as const,
    gap_top:    c1.low,          // base+2
    gap_bottom: c3.high,         // base-1
    formed_at:  Date.now() - 60_000,
    candles:    [c1, c2, c3] as [import('../lib/engine/types').Candle, import('../lib/engine/types').Candle, import('../lib/engine/types').Candle],
  };
}

function makeBullishFVG(base: number) {
  // c1.high < c3.low → bullish FVG
  const c1 = makeCandle('1m', base - 5, base - 2, base - 6, base - 3, 180_000);
  const c2 = makeCandle('1m', base - 3, base + 4, base - 4, base + 3, 120_000);
  const c3 = makeCandle('1m', base + 3, base + 6, base + 1, base + 5, 60_000);
  return {
    tf: '1m' as const,
    direction: 'bullish' as const,
    gap_top:    c3.low,          // base+1
    gap_bottom: c1.high,         // base-2
    formed_at:  Date.now() - 60_000,
    candles:    [c1, c2, c3] as [import('../lib/engine/types').Candle, import('../lib/engine/types').Candle, import('../lib/engine/types').Candle],
  };
}

// ── Scenario definitions ──────────────────────────────────────────────────────

type Step = { label: string; event: SMEvent; delay: number };

function bullishReversalSteps(base: number): Step[] {
  const fvg = makeBearishFVG(base);
  const leg  = {
    tf: '1m' as const,
    fvg,
    direction: 'bearish' as const,
    formed_at: Date.now() - 60_000,
    swept_level: base - 10,
    invalidated: false,
  };
  return [
    {
      label: '1. Zone Touch (Swing Low)',
      delay: 0,
      event: {
        type:  'ZONE_TOUCHED',
        zone:  { price: base - 10, side: 'low', type: 'swing', swept: false },
      } as SMEvent,
    },
    {
      label: '2. Bearish Leg Found (Manipulation)',
      delay: 800,
      event: {
        type:             'LEG_FOUND',
        tf:               '1m',
        fvg,
        reversal_leg:     leg,
        continuation_leg: null,
        timestamp:        Date.now(),
      } as SMEvent,
    },
    {
      label: '3. Inverse Close (through FVG)',
      delay: 800,
      event: {
        type:   'CANDLE_CLOSE',
        tf:     '1m',
        candle: makeCandle('1m', fvg.gap_bottom - 0.5, fvg.gap_bottom, fvg.gap_bottom - 1.5, fvg.gap_bottom - 0.25),
      } as SMEvent,
    },
  ];
}

function bearishReversalSteps(base: number): Step[] {
  const fvg = makeBullishFVG(base);
  const leg  = {
    tf: '1m' as const,
    fvg,
    direction: 'bullish' as const,
    formed_at: Date.now() - 60_000,
    swept_level: base + 10,
    invalidated: false,
  };
  return [
    {
      label: '1. Zone Touch (Swing High)',
      delay: 0,
      event: {
        type: 'ZONE_TOUCHED',
        zone: { price: base + 10, side: 'high', type: 'swing', swept: false },
      } as SMEvent,
    },
    {
      label: '2. Bullish Leg Found (Manipulation)',
      delay: 800,
      event: {
        type:             'LEG_FOUND',
        tf:               '1m',
        fvg,
        reversal_leg:     leg,
        continuation_leg: null,
        timestamp:        Date.now(),
      } as SMEvent,
    },
    {
      label: '3. Inverse Close (through FVG)',
      delay: 800,
      event: {
        type:   'CANDLE_CLOSE',
        tf:     '1m',
        candle: makeCandle('1m', fvg.gap_top + 0.5, fvg.gap_top + 1.5, fvg.gap_top, fvg.gap_top + 0.25),
      } as SMEvent,
    },
  ];
}

function structureBreakSteps(base: number): Step[] {
  const fvg = makeBearishFVG(base);
  const leg  = {
    tf: '1m' as const,
    fvg,
    direction: 'bearish' as const,
    formed_at: Date.now() - 60_000,
    swept_level: base - 10,
    invalidated: false,
  };
  return [
    {
      label: '1. Zone Touch',
      delay: 0,
      event: {
        type: 'ZONE_TOUCHED',
        zone: { price: base - 10, side: 'low', type: 'swing', swept: false },
      } as SMEvent,
    },
    {
      label: '2. Leg Found',
      delay: 800,
      event: {
        type:             'LEG_FOUND',
        tf:               '1m',
        fvg,
        reversal_leg:     leg,
        continuation_leg: null,
        timestamp:        Date.now(),
      } as SMEvent,
    },
    {
      label: '3. Structure Break → fallback',
      delay: 800,
      event: {
        type:   'CANDLE_CLOSE',
        tf:     '1m',
        // Close below c1.low of the bearish FVG leg = structure break
        candle: makeCandle('1m', fvg.candles[0].low - 2, fvg.candles[0].low - 1, fvg.candles[0].low - 3, fvg.candles[0].low - 1.5),
      } as SMEvent,
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  bias:        string | null;
  mode:        string | null;
  onInject:    (event: SMEvent) => void;
  onReset:     () => void;
  getSmState:  () => MachineState;
  setBias:     (bias: 'bullish' | 'bearish', mode: 'REVERSAL' | 'CONTINUATION') => void;
}

const BASE_PRICE = 5248;

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-[3px]"
      style={{ background: `${color}18`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  );
}

export default function EngineTestPanel({ bias, mode, onInject, onReset, getSmState, setBias }: Props) {
  const [log, setLog]         = useState<{ ts: string; text: string; ok: boolean }[]>([]);
  const [running, setRunning] = useState(false);
  const [smState, setSmState] = useState<MachineState | null>(null);

  const addLog = (text: string, ok = true) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [{ ts, text, ok }, ...prev].slice(0, 30));
  };

  const runScenario = useCallback(async (
    name: string,
    bias_: 'bullish' | 'bearish',
    mode_: 'REVERSAL' | 'CONTINUATION',
    steps: Step[],
  ) => {
    if (running) return;
    setRunning(true);
    addLog(`▶ Scenario: ${name}`, true);

    // Set bias first
    setBias(bias_, mode_);
    addLog(`  BIAS_SET → ${bias_} / ${mode_}`, true);
    await new Promise(r => setTimeout(r, 400));

    for (const step of steps) {
      if (step.delay) await new Promise(r => setTimeout(r, step.delay));
      onInject(step.event);
      addLog(`  ${step.label}`, true);
      setSmState(getSmState());
    }

    await new Promise(r => setTimeout(r, 200));
    setSmState(getSmState());
    addLog(`✓ Done — check phase above`, true);
    setRunning(false);
  }, [running, onInject, getSmState, setBias]);

  const handleReset = () => {
    onReset();
    setSmState(getSmState());
    addLog('↺ Engine reset', false);
  };

  const refreshState = () => setSmState(getSmState());

  return (
    <div
      className="rounded-[6px] border border-[#2a1f1f] bg-[#0d0a0a] p-5 flex flex-col gap-4"
      style={{ boxShadow: 'inset 0 0 40px rgba(120,40,40,.06)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-[#c98080]">Dev</span>
          <span className="font-mono text-[12px] font-bold text-white/60">Engine Test Mode</span>
        </div>
        <div className="flex items-center gap-2">
          <Tag label={bias ?? 'no bias'} color={bias === 'bullish' ? '#6fa580' : bias === 'bearish' ? '#c98080' : '#52525b'} />
          <Tag label={mode ?? 'no mode'} color="#d4af37" />
        </div>
      </div>

      {/* Scenarios */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/25">Scenarios</span>
        <div className="grid grid-cols-1 gap-2 max-[600px]:grid-cols-1 sm:grid-cols-3">
          <ScenarioBtn
            label="▲ Bullish Reversal"
            color="#6fa580"
            disabled={running}
            onClick={() => runScenario(
              'Bullish Reversal',
              'bullish', 'REVERSAL',
              bullishReversalSteps(BASE_PRICE),
            )}
          />
          <ScenarioBtn
            label="▼ Bearish Reversal"
            color="#c98080"
            disabled={running}
            onClick={() => runScenario(
              'Bearish Reversal',
              'bearish', 'REVERSAL',
              bearishReversalSteps(BASE_PRICE),
            )}
          />
          <ScenarioBtn
            label="↕ Structure Break"
            color="#d4af37"
            disabled={running}
            onClick={() => runScenario(
              'Structure Break',
              'bullish', 'REVERSAL',
              structureBreakSteps(BASE_PRICE),
            )}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleReset}
          className="font-mono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 rounded-[4px]
                     border border-[#3a2a2a] bg-[#1a1010] text-white/40 hover:text-white/70
                     hover:border-[#5a3a3a] transition-all"
        >
          ↺ Reset Engine
        </button>
        <button
          onClick={refreshState}
          className="font-mono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 rounded-[4px]
                     border border-[#2a2a2a] bg-[#111] text-white/30 hover:text-white/60
                     hover:border-[#3a3a3a] transition-all"
        >
          ⟳ Refresh State
        </button>
      </div>

      {/* SM State dump */}
      {smState && (
        <div className="rounded-[4px] border border-[#1c1c1e] bg-[#070709] p-3 overflow-x-auto">
          <span className="font-mono text-[8px] uppercase tracking-[0.25em] text-white/20">SM State</span>
          <pre className="font-mono text-[10px] text-white/50 mt-1.5 leading-relaxed">
            {JSON.stringify({
              phase:      smState.phase,
              bias:       smState.bias,
              mode:       smState.mode,
              active_leg: smState.active_leg
                ? { tf: smState.active_leg.tf, dir: smState.active_leg.direction, invalidated: smState.active_leg.invalidated }
                : null,
              leg_history_count: smState.leg_history.length,
              is_emitted: smState.is_emitted,
            }, null, 2)}
          </pre>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="rounded-[4px] border border-[#1c1c1e] bg-[#070709] p-3 max-h-48 overflow-y-auto">
          <span className="font-mono text-[8px] uppercase tracking-[0.25em] text-white/20">Log</span>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {log.map((l, i) => (
              <div key={i} className="flex gap-2 font-mono text-[10px]">
                <span className="text-white/20 tabular-nums shrink-0">{l.ts}</span>
                <span style={{ color: l.ok ? '#6fa580' : '#c98080' }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioBtn({
  label, color, disabled, onClick,
}: { label: string; color: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] px-3 py-2.5
                 rounded-[4px] border transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        borderColor: `${color}44`,
        background:  `${color}0d`,
        color,
      }}
    >
      {label}
    </button>
  );
}
