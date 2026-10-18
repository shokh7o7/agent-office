import { useStore } from '../store/store';
import { roomAt, ROOMS } from '../sim/map';
import { ActivityLog } from './ActivityLog';
import { Avatar, Progress, StateBadge } from './common';

export function AgentInspector() {
  const s = useStore();
  const a = s.ui.selectedAgentId ? s.sim.state.agents[s.ui.selectedAgentId] : undefined;
  if (!a) return null;
  const task = s.sim.activeTask(a);
  const ws = s.sim.workstation(a);
  const room = roomAt(a.pos);
  const roomName = ROOMS.find((r) => r.id === room)?.name ?? 'Corridor';

  return (
    <aside className="inspector" aria-label={`${a.name} details`}>
      <header>
        <Avatar appearance={a.appearance} size={3} dim={!a.enabled} />
        <div className="who">
          <h2>{a.name}</h2>
          <span className="muted">{a.role}</span>
        </div>
        <StateBadge state={a.state} />
        <button className="icon-btn" aria-label="Close details" onClick={() => s.selectAgent(null)}>×</button>
      </header>

      <dl className="facts">
        <div><dt>Desk</dt><dd>{ws?.label ?? 'None'}</dd></div>
        <div><dt>Location</dt><dd>{roomName}</dd></div>
        <div><dt>Model</dt><dd>{a.model ? `${a.provider ?? ''} ${a.model}`.trim() : s.settings.mode === 'demo' ? 'Simulated' : 'Not set'}</dd></div>
        <div><dt>Queue</dt><dd>{a.queue.length}</dd></div>
      </dl>

      <section className="current">
        {task ? (
          <>
            <div className="current-title">
              <strong>{task.title}</strong>
              {task.simulated && <span className="sim-tag">simulated</span>}
            </div>
            <Progress value={task.progress} simulated={task.simulated} />
            <span className="muted tiny">{Math.round(task.progress * 100)}% · attempt {task.attempt}</span>
          </>
        ) : (
          <span className="muted">{a.enabled ? 'No current task.' : 'Disabled. Enable to assign tasks.'}</span>
        )}
      </section>

      <div className="row-actions">
        <button className="btn primary" disabled={!a.enabled} onClick={() => s.openTaskForm(a.id)}>Assign task</button>
        {task && (task.status === 'running' || task.status === 'queued') && (
          <button className="btn danger" onClick={() => s.cancelTask(task.id)}>Cancel task</button>
        )}
        <button className="btn" onClick={() => s.selectAgent(a.id, true)}>Focus</button>
        <button className="btn" onClick={() => s.setUI({ agentEditor: { open: true, agentId: a.id } })}>Edit</button>
        <button className="btn" onClick={() => s.setAgentEnabled(a.id, !a.enabled)}>{a.enabled ? 'Disable' : 'Enable'}</button>
      </div>

      <h3>Recent activity</h3>
      <div className="inspector-log">
        <ActivityLog agentId={a.id} limit={8} />
      </div>
    </aside>
  );
}
