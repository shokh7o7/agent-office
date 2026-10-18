import { useStore } from '../store/store';
import { TaskPanel } from './TaskPanel';
import { ActivityLog } from './ActivityLog';
import { Avatar, Progress, StateBadge, timeAgo } from './common';

export function ManagementView() {
  const s = useStore();
  const agents = s.sim.agents;
  return (
    <div className="manage">
      <section className="manage-col tasks">
        <header className="manage-head">
          <h2>Tasks</h2>
          <button className="btn primary" onClick={() => s.openTaskForm()}>New task</button>
        </header>
        <TaskPanel roomy />
      </section>

      <section className="manage-col agents">
        <header className="manage-head">
          <h2>Agents</h2>
          <button className="btn" disabled={!s.sim.freeDesks().length} onClick={() => s.setUI({ agentEditor: { open: true, agentId: null } })}>Add agent</button>
        </header>
        <div className="table-wrap">
          <table className="agent-table">
            <thead>
              <tr><th>Agent</th><th>Status</th><th>Current task</th><th>Desk</th><th>Last activity</th><th><span className="sr">Actions</span></th></tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const t = s.sim.activeTask(a);
                return (
                  <tr key={a.id} className={a.enabled ? '' : 'disabled'}>
                    <td>
                      <span className="cell-agent">
                        <Avatar appearance={a.appearance} dim={!a.enabled} />
                        <span><strong>{a.name}</strong><br /><span className="muted tiny">{a.role}{a.model ? `, ${a.model}` : ''}</span></span>
                      </span>
                    </td>
                    <td><StateBadge state={a.state} /></td>
                    <td className="cell-task">
                      {t ? t.title : <span className="muted">—</span>}
                      {a.state === 'WORKING' && t && <Progress value={t.progress} simulated={t.simulated} />}
                    </td>
                    <td>{s.sim.workstation(a)?.label ?? '—'}</td>
                    <td className="muted">{timeAgo(a.lastActivityAt)}</td>
                    <td className="cell-actions">
                      <button className="btn small" onClick={() => { s.setUI({ view: 'office' }); s.selectAgent(a.id, true); }}>Show</button>
                      <button className="btn small" onClick={() => s.setUI({ agentEditor: { open: true, agentId: a.id } })}>Edit</button>
                      <button className="btn small" onClick={() => s.setAgentEnabled(a.id, !a.enabled)}>{a.enabled ? 'Disable' : 'Enable'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <header className="manage-head"><h2>Activity</h2></header>
        <div className="manage-activity"><ActivityLog limit={200} /></div>
      </section>
    </div>
  );
}
