import { useStore } from '../store/store';

export function TopBar() {
  const s = useStore();
  const agents = s.sim.agents;
  const count = (st: string[]) => agents.filter((a) => st.includes(a.state)).length;
  const { mode, paused, speed } = s.settings;
  const conn = s.connection;
  const connLabel =
    mode === 'demo' ? 'Simulated' : conn.status === 'connected' ? 'Connected' : conn.status === 'connecting' ? 'Connecting…' : 'Disconnected';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Agent Office</span>
      </div>

      <nav className="seg" aria-label="View">
        <button aria-pressed={s.ui.view === 'office'} onClick={() => s.setUI({ view: 'office' })}>
          Office
        </button>
        <button aria-pressed={s.ui.view === 'manage'} onClick={() => s.setUI({ view: 'manage' })}>
          Manage
        </button>
      </nav>

      <div className="tally" aria-label="Agent summary">
        <span className="tally-item"><i className="dot state-WORKING" />{count(['WORKING'])} working</span>
        <span className="tally-item"><i className="dot state-THINKING" />{count(['THINKING', 'WALKING', 'WAITING'])} busy</span>
        <span className="tally-item"><i className="dot state-IDLE" />{count(['IDLE', 'COMPLETED'])} idle</span>
        <span className="tally-item"><i className="dot state-SLEEPING" />{count(['SLEEPING'])} resting</span>
        {count(['ERROR']) > 0 && <span className="tally-item"><i className="dot state-ERROR" />{count(['ERROR'])} error</span>}
      </div>

      <div className="spacer" />

      <div className="mode" title={conn.detail ?? ''}>
        <div className="seg small" role="group" aria-label="Mode">
          <button aria-pressed={mode === 'demo'} onClick={() => s.setMode('demo')}>Demo</button>
          <button aria-pressed={mode === 'real'} onClick={() => s.setMode('real')}>Real</button>
        </div>
        <span className={`conn conn-${mode === 'demo' ? 'demo' : conn.status}`}>
          <i />
          {connLabel}
        </span>
      </div>

      <div className="controls">
        <button className="btn" onClick={() => s.togglePause()} aria-pressed={paused}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <select className="select" aria-label="Simulation speed" value={speed} onChange={(e) => s.setSpeed(Number(e.target.value) as 1 | 2 | 4)}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
        <button className="btn primary" onClick={() => s.openTaskForm(s.ui.selectedAgentId)}>
          New task
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={() => s.setUI({ settingsOpen: true })}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 1h2v2h2v2h2v2h-2v2h2v2h-2v2H9v2H7v-2H5v-2H3V9h2V7H3V5h2V3h2zm0 5v4h2V6z" /></svg>
        </button>
        {s.ui.view === 'office' && (
          <button className="icon-btn" aria-label={s.ui.sidebarOpen ? 'Hide panel' : 'Show panel'} aria-pressed={s.ui.sidebarOpen} onClick={() => s.setUI({ sidebarOpen: !s.ui.sidebarOpen })}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1 2h14v12H1zm2 2v8h6V4zm8 0v8h2V4z" /></svg>
          </button>
        )}
      </div>
    </header>
  );
}
