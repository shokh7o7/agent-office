import { useEffect } from 'react';
import { store, useStore } from './store/store';
import { OfficeGame } from './game/OfficeGame';
import { TopBar } from './ui/TopBar';
import { Sidebar } from './ui/Sidebar';
import { AgentInspector } from './ui/AgentInspector';
import { ManagementView } from './ui/ManagementView';
import { TaskForm } from './ui/TaskForm';
import { AgentEditor } from './ui/AgentEditor';
import { Settings } from './ui/Settings';
import { ApprovalCenter, HoverTooltip, Toasts } from './ui/Overlays';

export default function App() {
  const s = useStore();
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        <section className="office-wrap" aria-hidden={s.ui.view !== 'office'}>
          <OfficeGame />
          {s.settings.paused && <div className="paused-flag">Paused</div>}
          {s.settings.mode === 'demo' && <div className="demo-flag" title="Tasks are simulated in the browser; no AI model is called.">Demo mode: simulated work</div>}
          <AgentInspector />
          <HoverTooltip />
        </section>
        {s.ui.view === 'office' && <Sidebar />}
        {s.ui.view === 'manage' && <ManagementView />}
      </main>
      {s.ui.taskForm.open && <TaskForm />}
      {s.ui.agentEditor.open && <AgentEditor />}
      {s.ui.settingsOpen && <Settings />}
      <ApprovalCenter />
      <Toasts />
    </div>
  );
}
