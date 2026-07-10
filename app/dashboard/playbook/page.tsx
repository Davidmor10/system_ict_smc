'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { groupByKey, loadTrades, UNSPECIFIED_MODEL } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { hydrateList, commitList } from '../../lib/sync/collections';

const STORAGE_KEY = 'onyx_playbook';

interface ChecklistItem { text: string; required: boolean; }
interface Setup { id: string; name: string; description: string; checklist: ChecklistItem[]; tags: string[]; updatedAt?: number; deleted?: boolean; }

function emptySetup(): Setup {
  return { id: Date.now().toString(), name: '', description: '', checklist: [], tags: [] };
}

function SetupCard({ setup, stats, onEdit, onDelete }: {
  setup: Setup;
  stats?: { winRate: number; tradeCount: number; totalPnl: number; avgR: number };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const allRequired = setup.checklist.filter(i => i.required);
  const allChecked  = allRequired.every((_, idx) => checked[idx]);

  return (
    <div className="border border-[#1c1c1e] rounded-sm bg-[#0a0a0b] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-bold text-white">{setup.name || 'Unnamed Setup'}</h3>
          {setup.description && <p className="font-mono text-xs text-white/40 mt-1">{setup.description}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onEdit} className="font-mono text-[10px] text-white/30 hover:text-white/70 transition-colors uppercase tracking-[0.14em]">Edit</button>
          <button onClick={onDelete} className="font-mono text-[10px] text-white/20 hover:text-[#ef4444] transition-colors">✕</button>
        </div>
      </div>

      {/* Stats from journal */}
      {stats && stats.tradeCount > 0 && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: 'Trades', value: stats.tradeCount.toString() },
            { label: 'Win%',   value: `${stats.winRate.toFixed(0)}%`, color: stats.winRate >= 50 ? '#22c55e' : '#ef4444' },
            { label: 'Avg R',  value: `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`, color: stats.avgR >= 0 ? '#22c55e' : '#ef4444' },
            { label: 'P&L',    value: `${stats.totalPnl >= 0 ? '+' : ''}$${Math.abs(stats.totalPnl).toFixed(0)}`, color: stats.totalPnl >= 0 ? '#22c55e' : '#ef4444' },
          ].map(({ label, value, color }) => (
            <div key={label} className="px-3 py-1.5 border border-[#1c1c1e] rounded-sm">
              <span className="font-mono text-[9px] text-white/30 block">{label}</span>
              <span className="font-mono text-xs font-bold" style={{ color: color ?? '#fff' }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Checklist */}
      {setup.checklist.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 mb-2">Pre-entry Checklist</p>
          {setup.checklist.map((item, idx) => (
            <label key={idx} className="flex items-center gap-3 cursor-pointer group">
              <span
                onClick={() => setChecked(c => ({ ...c, [idx]: !c[idx] }))}
                className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors shrink-0 ${checked[idx] ? 'bg-[#d4af37] border-[#d4af37]' : 'border-[#333] group-hover:border-[#d4af37]/40'}`}
              >
                {checked[idx] && <span className="text-black text-[10px] font-bold leading-none">✓</span>}
              </span>
              <span className={`font-mono text-xs ${checked[idx] ? 'text-white/30 line-through' : 'text-white/60'} ${item.required ? '' : 'opacity-70'}`}>
                {item.text} {item.required && <span className="text-[#ef4444]/60 text-[9px]">*</span>}
              </span>
            </label>
          ))}
          {allRequired.length > 0 && (
            <div className={`mt-2 px-3 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${allChecked ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30' : 'bg-[#1c1c1e] text-white/30 border border-transparent'}`}>
              {allChecked ? '✓ Ready to Trade' : `${allRequired.filter((_, i) => checked[i]).length}/${allRequired.length} required`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SetupEditor({ setup, onChange, onSave, onCancel }: {
  setup: Setup;
  onChange: (s: Setup) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [newItem, setNewItem] = useState('');

  function addItem() {
    if (!newItem.trim()) return;
    onChange({ ...setup, checklist: [...setup.checklist, { text: newItem.trim(), required: true }] });
    setNewItem('');
  }

  function removeItem(idx: number) {
    onChange({ ...setup, checklist: setup.checklist.filter((_, i) => i !== idx) });
  }

  function toggleRequired(idx: number) {
    const updated = setup.checklist.map((item, i) => i === idx ? { ...item, required: !item.required } : item);
    onChange({ ...setup, checklist: updated });
  }

  return (
    <div className="border border-[#d4af37]/20 rounded-sm bg-[#0a0a0b] p-5 space-y-4">
      <div className="grid grid-cols-1 min-[600px]:grid-cols-2 gap-3">
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1.5">Setup Name</label>
          <input
            value={setup.name}
            onChange={e => onChange({ ...setup, name: e.target.value })}
            placeholder="e.g. Reversal at PDH"
            className="w-full bg-[#111] border border-[#222] rounded-sm px-3 py-2 font-mono text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/40 transition-colors"
            dir="ltr"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1.5">Description</label>
          <input
            value={setup.description}
            onChange={e => onChange({ ...setup, description: e.target.value })}
            placeholder="Short description..."
            className="w-full bg-[#111] border border-[#222] rounded-sm px-3 py-2 font-mono text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/40 transition-colors"
            dir="ltr"
          />
        </div>
      </div>

      {/* Checklist builder */}
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40 mb-2">Checklist Items</label>
        <div className="space-y-2 mb-3">
          {setup.checklist.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <button
                onClick={() => toggleRequired(idx)}
                className={`font-mono text-[9px] px-1.5 py-0.5 rounded-sm border transition-colors ${item.required ? 'border-[#ef4444]/40 text-[#ef4444]/70' : 'border-[#333] text-white/30'}`}
                title="Toggle required"
              >REQ</button>
              <span className="flex-1 font-mono text-sm text-white/70">{item.text}</span>
              <button onClick={() => removeItem(idx)} className="font-mono text-[10px] text-white/20 hover:text-[#ef4444] transition-colors">✕</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Add checklist item..."
            className="flex-1 bg-[#111] border border-[#222] rounded-sm px-3 py-2 font-mono text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/40 transition-colors"
            dir="ltr"
          />
          <button onClick={addItem} className="px-4 py-2 rounded-sm border border-[#d4af37]/30 text-[#d4af37]/70 hover:text-[#d4af37] hover:border-[#d4af37]/50 font-mono text-xs transition-colors">+</button>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onSave} className="px-5 py-2 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold uppercase tracking-[0.12em] hover:bg-[#e5c84a] transition-colors">Save Setup</button>
        <button onClick={onCancel} className="px-5 py-2 rounded-sm border border-[#1c1c1e] text-white/40 font-mono text-xs uppercase tracking-[0.12em] hover:text-white/70 transition-colors">Cancel</button>
      </div>
    </div>
  );
}

export default function PlaybookPage() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [setups, setSetups] = useState<Setup[]>([]);
  const [editing, setEditing] = useState<Setup | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [trades, setTrades] = useState<TradeEntry[]>([]);

  useEffect(() => {
    // Instant paint from cache, then reconcile with the cloud (cross-device).
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) try { setSetups((JSON.parse(raw) as Setup[]).filter(s => !s.deleted)); } catch { /* ignore */ }
    hydrateList<Setup>('setups', STORAGE_KEY).then(setSetups).catch(() => { /* keep local */ });
    setTrades(loadTrades());
  }, []);

  function persist(updated: Setup[]) {
    setSetups(updated);
    // commitList stamps changes, tombstones removals, writes local + pushes cloud.
    void commitList<Setup>('setups', STORAGE_KEY, updated);
  }

  function saveEdit() {
    if (!editing) return;
    const updated = isNew
      ? [editing, ...setups]
      : setups.map(s => s.id === editing.id ? editing : s);
    persist(updated);
    setEditing(null);
    setIsNew(false);
  }

  function deleteSetup(id: string) {
    persist(setups.filter(s => s.id !== id));
  }

  const statsBySetup = groupByKey(trades, t => t.model || UNSPECIFIED_MODEL);

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-4xl mx-auto space-y-6">

        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-serif text-3xl font-bold text-white">{en ? 'Playbook' : 'פלייבוק'}</h1>
            <p className="font-mono text-xs text-white/30 mt-1 uppercase tracking-[0.18em]">{setups.length} setups</p>
          </div>
          {!editing && (
            <button
              onClick={() => { setEditing(emptySetup()); setIsNew(true); }}
              className="px-5 py-2.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold tracking-[0.12em] uppercase hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.3)]"
            >
              {en ? '+ New Setup' : '+ Setup חדש'}
            </button>
          )}
        </div>

        {editing && (
          <SetupEditor
            setup={editing}
            onChange={setEditing}
            onSave={saveEdit}
            onCancel={() => { setEditing(null); setIsNew(false); }}
          />
        )}

        {setups.length === 0 && !editing ? (
          <div className="py-20 text-center border border-[#1c1c1e] rounded-sm">
            <p className="font-mono text-sm text-white/20">{en ? 'No setups yet' : 'אין Setups עדיין'}</p>
            <button
              onClick={() => { setEditing(emptySetup()); setIsNew(true); }}
              className="mt-4 font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors"
            >
              {en ? '+ Create your first setup' : '+ צור את ה-Setup הראשון שלך'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {setups.map(s => (
              <SetupCard
                key={s.id}
                setup={s}
                stats={statsBySetup.get(s.name) as { winRate: number; tradeCount: number; totalPnl: number; avgR: number } | undefined}
                onEdit={() => { setEditing(s); setIsNew(false); }}
                onDelete={() => deleteSetup(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
