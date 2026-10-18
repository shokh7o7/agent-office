import { useStore } from '../store/store';
import { Avatar, Progress, StateBadge, timeAgo } from './common';

export function AgentDirectory() {
  const s = useStore();
  const agents = s.sim.agents;
  const deskFull = s.sim.freeDesks().length === 0;

  return (
    <div className="panel-body">
      {agents.length === 0 ? (
        <div className="empty">
          <p>{s.settings.mode === 'real' ? 'No agents yet. They appear here once the backend reports them.' : 'The office is empty.'}</p>
          <button className="btn primary" onClick={() => s.setUI({ agentEditor: { open: true, agentId: null } })}>Add an agent</button>
        </div>
      ) : (
        <ul className="agent-list">
          {agents.map((a) => {
            const task = s.sim.activeTask(a);
            const selected = s.ui.selectedAgentId === a.id;
            return (
              <li key={a.id} className={`agent-row${selected ? ' selected' : ''}${a.enabled ? '' : ' disabled'}`}>
                <button className="agent-main" onClick={() => s.selectAgent(a.id, true)} aria-label={`Inspect ${a.name}`}>
                  <Avatar appearance={a.appearance} dim={!a.enabled} />
                  <span className="agent-text">
                    <span className="agent-line">
                      <strong>{a.name}</strong>
                      <span className="muted">{a.role}</span>
                    </span>
                    <span className="agent-task">
                      {task ? task.title : a.enabled ? 'No task' : 'Disabled'}
                      {a.queue.length > 0 && <span className="muted"> +{a.queue.length} queued</span>}
                    </span>
                    {a.state === 'WORKING' && task && <Progress value={task.progress} simulated={task.simulated} />}
                  </span>
                  <span className="agent-side">
                    <StateBadge state={a.state} />
                    <span className="muted tiny">{timeAgo(a.lastActivityAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="panel-foot">
        <button className="btn" disabled={deskFull} title={deskFull ? 'Every desk is taken' : undefined} onClick={() => s.setUI({ agentEditor: { open: true, agentId: null } })}>
          Add agent
        </button>
        <span className="muted tiny">{agents.length} of {s.sim.map.workstations.length} desks used</span>
      </div>
    </div>
  );
}
