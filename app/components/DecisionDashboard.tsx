'use client';

import { useState }                  from 'react';
import { useDecisionEngine }         from '../hooks/useDecisionEngine';
import { useLivePrices }             from '../hooks/useLivePrices';
import { fmtHMS }                    from '../lib/sessions';
import EngineTestPanel               from './EngineTestPanel';
import type { Phase, Direction, Mode, Signal, YesSignal } from '../lib/engine/types';
import type { SessionInfo }          from '../hooks/useDecisionEngine';

// ── Phase LED config ──────────────────────────────────────────────────────────

const PHASE_CFG: Record<Phase, { dot: string; glow: string; label: string; pulse: boolean }> = {
  IDLE:         { dot: '#52525b', glow: 'none',                         label: 'IDLE',         pulse: false },
  ZONE_ACTIVE:  { dot: '#d4af37', glow: '0 0 10px rgba(212,175,55,.6)', label: 'ZONE ACTIVE',  pulse: false },
  MANIP_WATCH:  { dot: '#3b82f6', glow: '0 0 10px rgba(59,130,246,.6)', label: 'MANIP WATCH',  pulse: false },
  CONFIRMATION: { dot: '#f97316', glow: '0 0 16px rgba(249,115,22,.8)', label: 'CONFIRMATION', pulse: true  },
};

// ── Session bar ───────────────────────────────────────────────────────────────

const SESSION_COLOR: Record<string, string> = {
  ASIA:   '#5b7a99',
  LONDON: '#6fa580',
  NY_AM:  '#d4af37',
  NY_PM:  '#c98080',
};

function SessionBar({ info }: { info: SessionInfo }) {
  const color = SESSION_COLOR[info.session.id] ?? '#52525b';
  return (
    <div
      className="flex items-center justify-between rounded-[4px] border px-3 py-2"
      style={{
        borderColor: info.inSession ? `${color}55` : '#2a2a2d',
        background:  info.inSession ? `${color}0f` : 'transparent',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className={info.inSession ? 'animate-pulse' : ''}
          style={{ display:'block', width:6, height:6, borderRadius:'50%',
                   background: info.inSession ? color : '#3a3a3e' }}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: info.inSession ? color : '#52525b' }}>
          {info.session.label}
        </span>
        {!info.inSession && (
          <span className="font-mono text-[9px] text-white/25 uppercase tracking-[0.1em]">
            — Next
          </span>
        )}
      </div>
      <span className="font-mono text-[10px] tabular-nums"
            style={{ color: info.inSession ? color : '#52525b' }}>
        {info.inSession ? fmtHMS(info.remaining) : `in ${fmtHMS(info.remaining)}`}
      </span>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseIndicator({ phase }: { phase: Phase }) {
  const { dot, glow, label, pulse } = PHASE_CFG[phase];
  return (
    <div className="flex items-center gap-2">
      <span
        className={pulse ? 'animate-pulse' : ''}
        style={{ display: 'block', width: 8, height: 8,
                 borderRadius: '50%', background: dot, boxShadow: glow }}
      />
      <span className="font-mono text-[11px] font-bold tracking-[0.22em] uppercase"
            style={{ color: dot }}>
        {label}
      </span>
    </div>
  );
}

function ToggleBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em]
                  rounded-[4px] border transition-all duration-150 whitespace-nowrap
                  ${active
                    ? 'bg-[rgba(212,175,55,.10)] border-[rgba(212,175,55,.55)] text-[#d4af37] [box-shadow:0_0_14px_rgba(212,175,55,.18)]'
                    : 'bg-[#0d0d0f] border-[#2a2a2d] text-white/40 hover:text-white/70 hover:border-[#3a3a3e]'}`}
    >
      {children}
    </button>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">{label}</span>
      <span className={`font-mono text-[12px] font-bold uppercase
                        ${highlight ? 'text-[#6fa580]' : 'text-white/80'}`}>
        {value}
      </span>
    </div>
  );
}

function YesCard({ sig }: { sig: YesSignal }) {
  const time = new Date(sig.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const zoneLabel = 'gap_top' in sig.zone
    ? `FVG ${sig.zone.gap_bottom.toFixed(2)} – ${sig.zone.gap_top.toFixed(2)}`
    : `${sig.zone.type.replace(/_/g, ' ')} @ ${sig.zone.price.toFixed(2)}`;

  return (
    <div
      className="rounded-[6px] border p-5"
      style={{
        background:  'rgba(74,124,89,.07)',
        borderColor: '#4a7c59',
        boxShadow:   '0 0 28px rgba(74,124,89,.18)',
        animation:   'sm-in 300ms cubic-bezier(0.16,1,0.3,1) both',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full
                           bg-[#4a7c59] text-white text-[10px] font-black leading-none">
            ✓
          </span>
          <span className="font-mono text-[13px] font-black tracking-[0.14em] text-[#6fa580] uppercase">
            Entry Signal
          </span>
        </div>
        <span className="font-mono text-[10px] text-white/25">{time}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <Field label="Mode"     value={sig.mode}      />
        <Field label="Bias"     value={sig.bias}      highlight />
        <Field label="Entry TF" value={sig.entry_tf}  />
      </div>

      <div className="rounded-[4px] border border-[#4a7c59]/30 bg-[rgba(74,124,89,.06)] px-3 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">Zone</span>
        <p className="font-mono text-[11px] font-bold text-white/70 mt-0.5">{zoneLabel}</p>
      </div>
    </div>
  );
}

function LogRow({ sig, i }: { sig: Signal; i: number }) {
  const isYes = sig.result === 'YES';
  const time  = new Date(sig.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      className="flex items-center gap-3 py-[9px] border-b border-[#1c1c1e] last:border-0"
      style={{ animation: i === 0 ? 'sm-in 250ms ease both' : undefined }}
    >
      <span className="font-mono text-[9px] font-black w-3"
            style={{ color: isYes ? '#6fa580' : '#7c3a3a' }}>
        {isYes ? 'Y' : 'N'}
      </span>
      <span className="font-mono text-[10px] text-white/20 tabular-nums w-[52px] shrink-0">
        {time}
      </span>
      <span className="font-mono text-[10px] text-white/50 flex-1 truncate">
        {isYes
          ? `${(sig as YesSignal).mode} · ${(sig as YesSignal).bias} · ${(sig as YesSignal).entry_tf}`
          : (sig as import('../lib/engine/types').NoSignal).reason}
      </span>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function DecisionDashboard() {
  const live = useLivePrices();
  const { phase, bias, mode, signals, last, sessionInfo, feedStatus, levelsCount, setBias, injectEvent, resetEngine, getSmState } =
    useDecisionEngine(live.es.price);
  const [showTest, setShowTest] = useState(false);

  const latestYes = last?.result === 'YES' ? (last as YesSignal) : null;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-4 border-b border-[#1c1c1e]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] tracking-[0.3em] text-[#52525b]">02</span>
          <div>
            <h2 className="font-serif text-[24px] font-bold text-white leading-none">
              Decision Engine
            </h2>
            <p className="font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase mt-1">
              ICT · State Machine · ES Futures
            </p>
          </div>
        </div>
        <PhaseIndicator phase={phase} />
      </div>

      {/* ── Bias controls ──────────────────────────────────────────────────── */}
      <div className="rounded-[6px] border border-[#1c1c1e] bg-[#0d0d0f] p-5 flex flex-col gap-5">

        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 w-14 shrink-0">
            Bias
          </span>
          <div className="flex gap-2">
            <ToggleBtn active={bias === 'bullish'}
                       onClick={() => setBias('bullish', mode ?? 'REVERSAL')}>
              ▲ Bullish
            </ToggleBtn>
            <ToggleBtn active={bias === 'bearish'}
                       onClick={() => setBias('bearish', mode ?? 'REVERSAL')}>
              ▼ Bearish
            </ToggleBtn>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 w-14 shrink-0">
            Mode
          </span>
          <div className="flex gap-2">
            <ToggleBtn active={mode === 'REVERSAL'}
                       onClick={() => setBias(bias ?? 'bullish', 'REVERSAL')}>
              ⟲ Reversal
            </ToggleBtn>
            <ToggleBtn active={mode === 'CONTINUATION'}
                       onClick={() => setBias(bias ?? 'bullish', 'CONTINUATION')}>
              → Continuation
            </ToggleBtn>
          </div>
        </div>

        {/* Active summary line */}
        <div className="flex items-center gap-2 pt-1 border-t border-[#1c1c1e]">
          <span className="font-mono text-[10px] text-white/25 uppercase tracking-[0.14em]">
            Active:
          </span>
          {bias && mode ? (
            <span className="font-mono text-[11px] font-bold text-[#d4af37] uppercase tracking-[0.1em]">
              {bias} · {mode}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-white/20 italic">
              — הגדר bias להפעלת המנוע —
            </span>
          )}
        </div>
      </div>

      {/* ── Session indicator ──────────────────────────────────────────────── */}
      <SessionBar info={sessionInfo} />

      {/* ── Liquidity levels status ────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-[4px] border border-[#1c1c1e] px-3 py-2">
        <div className="flex items-center gap-2">
          <span style={{ display:'block', width:6, height:6, borderRadius:'50%',
                         background: levelsCount > 0 ? '#d4af37' : '#3a3a3e' }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{ color: levelsCount > 0 ? '#d4af37' : '#52525b' }}>
            Liquidity Levels
          </span>
        </div>
        <span className="font-mono text-[9px] tabular-nums"
              style={{ color: levelsCount > 0 ? '#d4af37' : '#3a3a3e' }}>
          {levelsCount > 0 ? `${levelsCount} active` : 'Loading...'}
        </span>
      </div>

      {/* ── Market data feed status ────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between rounded-[4px] border px-3 py-2"
        style={{
          borderColor: feedStatus === 'live'  ? '#4a7c5955'
                     : feedStatus === 'error' ? '#7c3a3a55' : '#2a2a2d',
          background:  feedStatus === 'live'  ? '#4a7c590a' : 'transparent',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              display: 'block', width: 6, height: 6, borderRadius: '50%',
              background: feedStatus === 'live'  ? '#6fa580'
                        : feedStatus === 'error' ? '#c98080' : '#3a3a3e',
            }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{ color: feedStatus === 'live' ? '#6fa580' : '#52525b' }}>
            Market Data — ES Futures
          </span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]"
              style={{ color: feedStatus === 'live' ? '#6fa580' : '#3a3a3e' }}>
          {feedStatus === 'live' ? 'Live' : feedStatus === 'error' ? 'Error' : 'Loading...'}
        </span>
      </div>

      {/* ── Out-of-session lock ─────────────────────────────────────────────── */}
      {!sessionInfo.inSession && (
        <div className="flex flex-col items-center justify-center py-8 gap-2
                        rounded-[6px] border border-[#1c1c1e] bg-[#0d0d0f]">
          <span className="font-mono text-[22px] text-white/10">⏸</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/25">
            Engine Inactive
          </span>
          <span className="font-mono text-[10px] text-white/15">
            המנוע פועל רק בזמן סשנים
          </span>
        </div>
      )}

      {/* ── Latest YES signal ───────────────────────────────────────────────── */}
      {latestYes && sessionInfo.inSession && <YesCard sig={latestYes} />}

      {/* ── Signal log ──────────────────────────────────────────────────────── */}
      {signals.length > 0 ? (
        <div className="rounded-[6px] border border-[#1c1c1e] bg-[#0d0d0f] px-4 py-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/25">
            Signal Log
          </span>
          <div className="mt-3">
            {signals.map((s, i) => <LogRow key={i} sig={s} i={i} />)}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-14 gap-2">
          <span className="font-mono text-[32px] text-white/8">◎</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/20">
            Waiting for setup
          </span>
        </div>
      )}

      {/* ── Test Mode toggle ────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowTest(p => !p)}
          className="font-mono text-[9px] uppercase tracking-[0.2em] px-2.5 py-1 rounded-[3px]
                     border border-[#2a1f1f] bg-[#0d0a0a] text-[#c98080]/50
                     hover:text-[#c98080]/80 hover:border-[#5a2a2a] transition-all"
        >
          {showTest ? '▲ Hide Test Mode' : '▼ Test Mode'}
        </button>
      </div>

      {showTest && (
        <EngineTestPanel
          bias={bias}
          mode={mode}
          onInject={injectEvent}
          onReset={resetEngine}
          getSmState={getSmState}
          setBias={setBias}
        />
      )}

      <style>{`
        @keyframes sm-in {
          from { opacity:0; transform:translateY(6px) scale(.99); }
          to   { opacity:1; transform:translateY(0)  scale(1);    }
        }
      `}</style>
    </div>
  );
}
