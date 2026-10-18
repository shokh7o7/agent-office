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
