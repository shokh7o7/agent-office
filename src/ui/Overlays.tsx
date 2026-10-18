import { useHover, useStore } from '../store/store';
import { STATE_LABEL } from '../sim/agentMachine';

export function Toasts() {
  const s = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`}>{t.msg}</div>
      ))}
    </div>
  );
}

export function HoverTooltip() {
  const h = useHover();
  const s = useStore();
  const agent = h.agentId ? s.sim.state.agents[h.agentId] : undefined;
  if (!agent && !h.deskLabel) return null;
  const task = agent ? s.sim.activeTask(agent) : null;
  return (
    <div className="tooltip" style={{ left: h.x + 14, top: h.y + 14 }}>
      {agent ? (
        <>
          <strong>{agent.name}</strong> <span className={`badge state-${agent.state}`}>{STATE_LABEL[agent.state]}</span>
          {task && <div className="tooltip-task">{task.title}{agent.state === 'WORKING' ? ` · ${Math.round(task.progress * 100)}%` : ''}</div>}
        </>
      ) : (
        h.deskLabel
      )}
    </div>
  );
}

/**
 * Shows risky PC actions that are waiting for the user's decision. A task's
 * pendingApproval is set by the backend while an agent wants to run something
 * that isn't on the safe list.
 */
export function ApprovalCenter() {
  const s = useStore();
  const pending = s.sim.tasks.filter((t) => t.pendingApproval);
  if (!pending.length) return null;
  return (
    <div className="approvals" role="alertdialog" aria-label="Actions awaiting approval">
      {pending.map((t) => {
        const a = t.pendingApproval!;
        const agent = s.sim.state.agents[t.agentId];
        return (
          <div key={t.id} className="approval">
            <div className="approval-head">
              <strong>{agent?.name ?? 'Agent'}</strong> wants to act on your PC
            </div>
            <code className="approval-cmd">{a.label}</code>
            {a.reason && <div className="approval-reason">{a.reason}</div>}
            <div className="approval-actions">
              <button className="btn danger" onClick={() => s.respondApproval(a.approvalId, false)}>Deny</button>
              <button className="btn primary" onClick={() => s.respondApproval(a.approvalId, true)}>Approve</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
