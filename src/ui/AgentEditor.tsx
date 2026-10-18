import { useState, type FormEvent } from 'react';
import type { AgentRole, Appearance, HairStyle } from '../types';
import { useStore } from '../store/store';
import { HAIRS, HAIR_STYLES, PANTS, ROLES, SHIRTS, SKINS, appearanceFor } from '../sim/seed';
import { FullAvatar, Modal } from './common';

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <fieldset className="swatches">
      <legend>{label}</legend>
      {colors.map((c) => (
        <button type="button" key={c} style={{ background: c }} aria-label={`${label} ${c}`} aria-pressed={value === c} onClick={() => onPick(c)} />
      ))}
    </fieldset>
  );
}

export function AgentEditor() {
  const s = useStore();
  const editing = s.ui.agentEditor.agentId ? s.sim.state.agents[s.ui.agentEditor.agentId] : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [role, setRole] = useState<AgentRole>(editing?.role ?? 'Developer');
  const [provider, setProvider] = useState(editing?.provider ?? '');
  const [model, setModel] = useState(editing?.model ?? '');
  const free = s.sim.freeDesks();
  const [deskId, setDeskId] = useState<string>(editing?.deskId ?? free[0]?.id ?? '');
  const [look, setLook] = useState<Appearance>(editing?.appearance ?? appearanceFor(String(Date.now())));
  const close = () => s.setUI({ agentEditor: { open: false, agentId: null } });
  const desks = editing?.deskId ? [s.sim.map.workstations.find((w) => w.id === editing.deskId)!, ...free] : free;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (editing) {
      if (s.updateAgent(editing.id, { name, role, provider: provider || undefined, model: model || undefined, appearance: look, deskId: deskId || null })) close();
    } else {
      const id = await s.addAgent({ name, role, provider, model, appearance: look, deskId: deskId || undefined });
      if (id) {
        close();
        s.selectAgent(id, true);
      }
    }
  };

  const set = (k: keyof Appearance) => (v: string) => setLook({ ...look, [k]: v });

  return (
    <Modal title={editing ? `Edit ${editing.name}` : 'Add agent'} onClose={close} wide>
      <form onSubmit={submit} className="form editor">
        <div className="editor-preview">
          <FullAvatar appearance={look} size={5} />
          <button type="button" className="btn" onClick={() => setLook(appearanceFor(String(Math.random())))}>Shuffle look</button>
        </div>
        <div className="editor-fields">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={24} placeholder="Nora" />
          </label>
          <div className="two">
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label>
              Desk
              <select value={deskId} onChange={(e) => setDeskId(e.target.value)} required>
                {desks.map((d) => <option key={d.id} value={d.id}>{d.label} ({d.room === 'workspace' ? 'workspace' : 'break room'})</option>)}
              </select>
            </label>
          </div>
          <div className="two">
            <label>
              Provider <span className="muted">optional</span>
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="anthropic" maxLength={40} />
            </label>
            <label>
              Model <span className="muted">optional</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-4-6" maxLength={60} />
            </label>
          </div>
          <label>
            Hair style
            <select value={look.hairStyle} onChange={(e) => set('hairStyle')(e.target.value as HairStyle)}>
              {HAIR_STYLES.map((h) => <option key={h} value={h}>{h[0].toUpperCase() + h.slice(1)}</option>)}
            </select>
          </label>
          <Swatches label="Skin" colors={SKINS} value={look.skin} onPick={set('skin')} />
          <Swatches label="Hair" colors={HAIRS} value={look.hair} onPick={set('hair')} />
          <Swatches label="Shirt" colors={SHIRTS} value={look.shirt} onPick={set('shirt')} />
          <Swatches label="Trousers" colors={PANTS} value={look.pants} onPick={set('pants')} />
          {s.settings.mode === 'demo' && <p className="hint">Provider and model are labels in demo mode. A backend uses them in Real mode.</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!name.trim() || !deskId}>{editing ? 'Save agent' : 'Add agent'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
