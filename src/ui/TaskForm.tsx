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
  const [busy, setBusy] = useState(false);
  const close = () => s.setUI({ taskForm: { open: false, agentId: null } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return; // prevents double assignment on double-click
    setBusy(true);
    const ok = await s.createTask({ title, description, agentId });
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
          <p className="hint">
            {s.settings.mode === 'demo'
              ? 'Demo mode simulates the work locally; no AI model is called. Include “[fail]” in the title to see a failure and retry.'
              : 'The task is sent to your backend, which runs it and reports progress.'}
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
