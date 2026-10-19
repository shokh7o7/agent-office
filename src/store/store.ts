import { useSyncExternalStore } from 'react';
import type { AppMode, Settings, SimState } from '../types';
import { Simulation, emptyState, type NewAgentInput, type Result } from '../sim/engine';
import { SEED_AGENTS, SEED_TASKS, appearanceFor } from '../sim/seed';
import type { Backend, ConnectionStatus, RemoteDevice, RemoteTask } from '../api/adapter';
import { DemoBackend } from '../api/demoAdapter';
import { HttpBackend } from '../api/httpAdapter';
import { ENV_API_BASE_URL } from '../config';
import { loadJSON, saveJSON } from './persistence';

export type View = 'office' | 'manage';
export type SideTab = 'agents' | 'tasks' | 'activity';

export interface UIState {
  view: View;
  sideTab: SideTab;
  sidebarOpen: boolean;
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  taskForm: { open: boolean; agentId: string | null };
  agentEditor: { open: boolean; agentId: string | null };
  settingsOpen: boolean;
}

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'error';
  msg: string;
}

export interface HoverInfo {
  agentId: string | null;
  deskLabel?: string;
  x: number;
  y: number;
}

const SETTINGS_KEY = 'agent-office:settings:v1';
const simKey = (mode: AppMode) => `agent-office:sim:${mode}:v1`;
const EMIT_INTERVAL = 150;
const SAVE_INTERVAL = 2000;

type Listener = () => void;

export class Store {
  sim: Simulation;
  settings: Settings;
  ui: UIState = {
    view: 'office',
    sideTab: 'agents',
    sidebarOpen: typeof window === 'undefined' ? true : window.innerWidth > 900,
    selectedAgentId: null,
    selectedTaskId: null,
    taskForm: { open: false, agentId: null },
    agentEditor: { open: false, agentId: null },
    settingsOpen: false,
  };
  connection: { status: ConnectionStatus; detail?: string } = { status: 'demo' };
  toasts: Toast[] = [];
  hover: HoverInfo = { agentId: null, x: 0, y: 0 };

  private backend: Backend = new DemoBackend();
  private disconnect: (() => void) | null = null;
  private devicePoll: ReturnType<typeof setInterval> | null = null;
  devices: RemoteDevice[] = [];
  private version = 0;
  private listeners = new Set<Listener>();
  private hoverListeners = new Set<Listener>();
  private focusListeners = new Set<(agentId: string) => void>();
  private dirty = false;
  private lastEmit = 0;
  private lastSave = 0;
  private raf = 0;
  private lastFrame = 0;
  private toastId = 0;

  constructor() {
    const saved = loadJSON<Partial<Settings>>(SETTINGS_KEY) ?? {};
    this.settings = {
      mode: saved.mode === 'real' && (saved.apiBaseUrl || ENV_API_BASE_URL) ? 'real' : 'demo',
      paused: !!saved.paused,
      speed: saved.speed === 2 || saved.speed === 4 ? saved.speed : 1,
      apiBaseUrl: saved.apiBaseUrl ?? ENV_API_BASE_URL,
    };
    this.sim = this.loadSim(this.settings.mode);
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    if (this.raf) return;
    this.connectBackend();
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      const dt = now - this.lastFrame;
      this.lastFrame = now;
      if (!this.settings.paused) {
        this.sim.tick(dt * this.settings.speed);
        this.dirty = true;
      }
      if (this.dirty && now - this.lastEmit > EMIT_INTERVAL) this.emit();
      if (now - this.lastSave > SAVE_INTERVAL) this.save();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('beforeunload', this.save);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.disconnect?.();
    this.disconnect = null;
    if (this.devicePoll) clearInterval(this.devicePoll);
    this.devicePoll = null;
    window.removeEventListener('beforeunload', this.save);
    this.save();
  }

  private loadSim(mode: AppMode): Simulation {
    const saved = loadJSON<SimState>(simKey(mode));
    if (saved && saved.agents && saved.taskOrder) return new Simulation(saved);
    const sim = new Simulation(emptyState());
    if (mode === 'demo') {
      for (const a of SEED_AGENTS) sim.addAgent(a);
      for (const t of SEED_TASKS) {
        const agent = sim.agents.find((a) => a.name === t.agent);
        if (agent) sim.createTask({ title: t.title, description: t.description, agentId: agent.id }, { simulated: true });
      }
      sim.log('info', 'Demo office ready. Tasks here are simulated; no AI model is called.');
    }
    return sim;
  }

  save = () => {
    this.lastSave = performance.now();
    saveJSON(simKey(this.settings.mode), this.sim.state);
    saveJSON(SETTINGS_KEY, this.settings);
  };

  // ---------------------------------------------------------------- subscriptions
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;

  emit() {
    this.dirty = false;
    this.lastEmit = performance.now();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribeHover = (l: Listener) => {
    this.hoverListeners.add(l);
    return () => this.hoverListeners.delete(l);
  };
  setHover(h: HoverInfo) {
    if (h.agentId === this.hover.agentId && h.deskLabel === this.hover.deskLabel && h.x === this.hover.x && h.y === this.hover.y) return;
    this.hover = h;
    this.hoverListeners.forEach((l) => l());
  }

  onFocus(l: (agentId: string) => void) {
    this.focusListeners.add(l);
    return () => this.focusListeners.delete(l);
  }

  // ---------------------------------------------------------------- feedback
  toast(level: Toast['level'], msg: string) {
    const t = { id: ++this.toastId, level, msg };
    this.toasts = [...this.toasts, t].slice(-4);
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.emit();
    }, level === 'error' ? 5000 : 3200);
  }

  private report<T>(r: Result<T>, success?: string): r is { ok: true; value: T } {
    if (!r.ok) this.toast('error', r.error);
    else if (success) this.toast('success', success);
    this.emit();
    return r.ok;
  }

  // ---------------------------------------------------------------- UI actions
  setUI(patch: Partial<UIState>) {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }

  selectAgent(id: string | null, focus = false) {
    this.ui = { ...this.ui, selectedAgentId: id };
    if (id && focus) this.focusListeners.forEach((l) => l(id));
    this.emit();
  }

  openTaskForm(agentId: string | null = null) {
    this.setUI({ taskForm: { open: true, agentId } });
  }

  // ---------------------------------------------------------------- settings
  togglePause() {
    this.settings = { ...this.settings, paused: !this.settings.paused };
    this.toast('info', this.settings.paused ? 'Simulation paused' : 'Simulation resumed');
  }

  setSpeed(speed: Settings['speed']) {
    this.settings = { ...this.settings, speed };
    this.emit();
  }

  setApiBaseUrl(url: string) {
    this.settings = { ...this.settings, apiBaseUrl: url.trim().replace(/\/$/, '') };
    this.save();
    if (this.settings.mode === 'real') this.connectBackend();
    this.emit();
  }

  setMode(mode: AppMode) {
    if (mode === this.settings.mode) return;
    if (mode === 'real' && !this.settings.apiBaseUrl) {
      this.setUI({ settingsOpen: true });
      this.toast('error', 'Add a backend URL in Settings to use Real mode.');
      return;
    }
    this.save();
    this.settings = { ...this.settings, mode };
    this.sim = this.loadSim(mode);
    this.ui = { ...this.ui, selectedAgentId: null, selectedTaskId: null };
    this.connectBackend();
    this.save();
    this.toast('info', mode === 'demo' ? 'Switched to Demo mode (simulated tasks)' : 'Switched to Real mode');
  }

  private connectBackend() {
    this.disconnect?.();
    this.backend = this.settings.mode === 'real' ? new HttpBackend(this.settings.apiBaseUrl) : new DemoBackend();
    this.disconnect = this.backend.connect({
      onStatus: (status, detail) => {
        const changed = status !== this.connection.status;
        this.connection = { status, detail };
        if (changed && status === 'connected') void this.syncRemoteAgents().then(() => this.syncActivity());
        if (changed) this.startDevicePolling(status === 'connected');
        if (changed) this.emit();
      },
      onTask: (t) => this.mergeRemoteTask(t),
    });
  }

  private async syncRemoteAgents() {
    try {
      const remote = await this.backend.listAgents();
      for (const ra of remote) {
        const look = ra.appearance ?? appearanceFor(ra.id);
        const existing = this.sim.state.agents[ra.id];
        if (existing) {
          // The server owns name, role and look; keep them in sync with the PC app.
          Object.assign(existing, { name: ra.name, role: ra.role, appearance: look, model: ra.model, provider: ra.provider });
          continue;
        }
        const r = this.sim.addAgent({ name: ra.name, role: ra.role, provider: ra.provider, model: ra.model, appearance: look }, ra.id);
        if (r.ok && ra.enabled === false) this.sim.setEnabled(ra.id, false);
      }
      this.emit();
    } catch (e) {
      this.toast('error', `Couldn't load agents from the backend: ${(e as Error).message}`);
    }
  }

  private async syncActivity() {
    try {
      const entries = await this.backend.listActivity();
      const known = this.sim.state.agents;
      if (this.sim.importActivity(entries.map((e) => ({ ...e, agentId: e.agentId && known[e.agentId] ? e.agentId : undefined })))) this.emit();
    } catch {
      /* activity history is optional; live task events still work */
    }
  }

  private startDevicePolling(on: boolean) {
    if (this.devicePoll) {
      clearInterval(this.devicePoll);
      this.devicePoll = null;
    }
    if (!on) {
      this.devices = [];
      return;
    }
    const poll = async () => {
      try {
        const next = await this.backend.listDevices();
        if (JSON.stringify(next) !== JSON.stringify(this.devices)) {
          this.devices = next;
          this.emit();
        }
      } catch {
        /* devices are optional */
      }
    };
    void poll();
    this.devicePoll = setInterval(poll, 4000);
  }

  async respondApproval(approvalId: string, approve: boolean) {
    try {
      await this.backend.respondApproval(approvalId, approve);
    } catch (e) {
      this.toast('error', `Couldn't send your decision: ${(e as Error).message}`);
    }
  }

  private mergeRemoteTask(t: RemoteTask) {
    if (!this.sim.state.tasks[t.id]) {
      if (t.status !== 'queued' && t.status !== 'running') return; // only adopt live work
      const r = this.sim.createTask({ title: t.title, description: t.description, agentId: t.agentId }, { simulated: false, id: t.id });
      if (!r.ok) return;
    }
    this.sim.applyRemoteTask(t);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- domain actions
  async createTask(input: { title: string; description: string; agentId: string; deviceId?: string; quality?: 'fast' | 'strong' }): Promise<boolean> {
    if (this.settings.mode === 'demo') {
      return this.report(this.sim.createTask(input, { simulated: true }), 'Task assigned (simulated)');
    }
    if (!input.title.trim()) return this.report({ ok: false, error: 'Give the task a title.' });
    try {
      const remote = await this.backend.createTask(input);
      // The live event stream may deliver the new task before this response does.
      if (this.sim.state.tasks[remote.id]) {
        this.sim.applyRemoteTask(remote);
        return this.report({ ok: true, value: undefined }, 'Task sent to the backend');
      }
      const ok = this.report(this.sim.createTask(input, { simulated: false, id: remote.id }), 'Task sent to the backend');
      if (ok) this.sim.applyRemoteTask(remote);
      return ok;
    } catch (e) {
      return this.report({ ok: false, error: `The backend rejected the task: ${(e as Error).message}` });
    }
  }

  async cancelTask(id: string) {
    const task = this.sim.state.tasks[id];
    if (task && !task.simulated) {
      try {
        await this.backend.cancelTask(id);
      } catch (e) {
        return this.report({ ok: false, error: `Couldn't cancel on the backend: ${(e as Error).message}` });
      }
    }
    this.report(this.sim.cancelTask(id), 'Task cancelled');
  }

  retryTask(id: string) {
    this.report(this.sim.retryTask(id), 'Task queued again');
  }

  async addAgent(input: NewAgentInput): Promise<string | null> {
    if (this.settings.mode === 'real') {
      try {
        const ra = await this.backend.createAgent({ name: input.name, role: input.role, provider: input.provider, model: input.model, appearance: input.appearance });
        const r = this.sim.addAgent(input, ra.id);
        return this.report(r, `${input.name} joined the office`) ? r.value.id : null;
      } catch (e) {
        this.report({ ok: false, error: `The backend rejected the agent: ${(e as Error).message}` });
        return null;
      }
    }
    const r = this.sim.addAgent(input);
    return this.report(r, `${input.name} joined the office`) ? r.value.id : null;
  }

  updateAgent(id: string, patch: Parameters<Simulation['updateAgent']>[1]) {
    const ok = this.report(this.sim.updateAgent(id, patch), 'Agent saved');
    if (ok && this.settings.mode === 'real') {
      // Persist on the server so the look/name is the same everywhere (office + PC app).
      const { name, role, appearance, model } = patch;
      this.backend.updateAgent(id, { name, role, appearance, model }).catch((e) =>
        this.toast('error', `Saved here, but the server rejected it: ${(e as Error).message}`),
      );
    }
    return ok;
  }

  setAgentEnabled(id: string, enabled: boolean) {
    this.report(this.sim.setEnabled(id, enabled), enabled ? 'Agent enabled' : 'Agent disabled');
  }

  resetDemo() {
    if (this.settings.mode !== 'demo') return;
    saveJSON(simKey('demo'), null);
    this.sim = this.loadSim('demo');
    this.ui = { ...this.ui, selectedAgentId: null, selectedTaskId: null };
    this.save();
    this.toast('info', 'Demo office reset');
  }
}

export const store = new Store();

/** Re-render when the store emits (throttled while the sim runs). */
export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

export function useHover(): HoverInfo {
  return useSyncExternalStore(store.subscribeHover, () => store.hover);
}
