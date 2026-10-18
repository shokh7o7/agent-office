import { useStore } from '../store/store';
import { clock } from './common';

export function ActivityLog({ agentId, limit = 120 }: { agentId?: string; limit?: number }) {
  const s = useStore();
  const items = s.sim.state.activity.filter((a) => !agentId || a.agentId === agentId).slice(-limit).reverse();
  if (!items.length) return <p className="muted empty-line">No activity yet.</p>;
  return (
    <ol className="activity">
      {items.map((a) => (
        <li key={a.id} className={`lvl-${a.level}`}>
          <time>{clock(a.t)}</time>
          <span>{a.msg}</span>
        </li>
      ))}
    </ol>
  );
}
