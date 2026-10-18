import { useStore, type SideTab } from '../store/store';
import { AgentDirectory } from './AgentDirectory';
import { TaskPanel } from './TaskPanel';
import { ActivityLog } from './ActivityLog';

const TABS: { id: SideTab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'activity', label: 'Activity' },
];

export function Sidebar() {
  const s = useStore();
  if (!s.ui.sidebarOpen) return null;
  const running = s.sim.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
  return (
    <aside className="sidebar" aria-label="Office panel">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={s.ui.sideTab === t.id} onClick={() => s.setUI({ sideTab: t.id })}>
            {t.label}
            {t.id === 'tasks' && running > 0 && <span className="count">{running}</span>}
          </button>
        ))}
        <button className="icon-btn close-mobile" aria-label="Hide panel" onClick={() => s.setUI({ sidebarOpen: false })}>×</button>
      </div>
      {s.ui.sideTab === 'agents' && <AgentDirectory />}
      {s.ui.sideTab === 'tasks' && <TaskPanel />}
      {s.ui.sideTab === 'activity' && <div className="panel-body"><ActivityLog /></div>}
    </aside>
  );
}
