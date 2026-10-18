import { useState, type FormEvent } from 'react';
import { useStore } from '../store/store';
import { STATE_LABEL } from '../sim/agentMachine';
import { Modal } from './common';

export function TaskForm() {
  const s = useStore();
  const enabled = s.sim.agents.filter((a) => a.enabled);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState(s.ui.taskForm.agentId ?? enabled.find((a) => !s.sim.isBusy(a))?.id ?? enabled[0]?.id ?? '');
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const devices = s.settings.mode === 'real' ? s.devices.filter((d) => d.online) : [];
  const close = () => s.setUI({ taskForm: { open: false, agentId: null } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return; // prevents double assignment on double-click
    setBusy(true);
    const ok = await s.createTask({ title, description, agentId, deviceId: deviceId || undefined });
    setBusy(false);
    if (ok) close();
  };

  return (
    <Modal title="New task" onClose={close}>
      {enabled.length === 0 ? (
        <div className="empty">
          <p>There are no enabled agents to take a task.</p>
          <button className="btn primary" onClick={() => s.setUI({ taskForm: { open: false, agentId: null }, agentEditor: { open: true, agentId: null } })}>Add an agent</button>
        </div>
      ) : (
        <form onSubmit={submit} className="form">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summarise last week's support tickets" required maxLength={120} />
          </label>
          <label>
            Details
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What should the agent produce?" maxLength={2000} />
          </label>
          <label>
            Agent
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
              {enabled.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}, {a.role} ({STATE_LABEL[a.state].toLowerCase()}{a.queue.length || s.sim.isBusy(a) ? ', will queue' : ''})
                </option>
              ))}
            </select>
          </label>
          {devices.length > 0 && (
            <label>
              Run on
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Just answer (no PC access)</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.workDir ? ` — ${d.workDir}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="hint">
            {s.settings.mode === 'demo'
              ? 'Demo mode simulates the work locally; no AI model is called. Include “[fail]” in the title to see a failure and retry.'
              : deviceId
                ? 'The agent will work inside the chosen PC folder. Risky actions ask for your approval; files are moved to the Recycle Bin, never permanently deleted.'
                : devices.length > 0
                  ? 'The agent will just answer. Pick a PC above to let it read and change files there.'
                  : 'The task is sent to your backend, which runs it and reports progress. Connect a PC runner to let an agent work on your files.'}
          </p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !title.trim()}>{busy ? 'Assigning…' : 'Assign task'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
