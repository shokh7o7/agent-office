import type { AgentRole, AppMode, TaskLog, TaskStatus } from '../types';

/**
 * Contract the frontend expects from a backend. The backend owns provider
 * credentials and runs the real AI work; the browser never sees API keys.
 *
 *   GET  /api/agents              -> RemoteAgent[]
 *   POST /api/agents              RemoteAgentInput -> RemoteAgent
 *   GET  /api/tasks               -> RemoteTask[]
 *   POST /api/tasks               { title, description, agentId } -> RemoteTask
 *   GET  /api/tasks/:id           -> RemoteTask
 *   POST /api/tasks/:id/cancel    -> RemoteTask
 *   GET  /api/activity            -> { t, level, msg, agentId?, taskId? }[]
 *   GET  /api/events  (SSE)       event: task  data: RemoteTask
 */
export interface RemoteAgent {
  id: string;
  name: string;
  role: AgentRole;
  provider?: string;
  model?: string;
  enabled?: boolean;
}

export type RemoteAgentInput = Omit<RemoteAgent, 'id'>;

export interface RemoteTask {
  id: string;
  title: string;
  description: string;
  agentId: string;
  status: TaskStatus;
  progress: number;
  output?: string;
  logs?: TaskLog[];
}

export interface RemoteActivity {
  t: number;
  level: 'info' | 'success' | 'warn' | 'error';
  msg: string;
  agentId?: string;
  taskId?: string;
}

export type ConnectionStatus = 'demo' | 'connecting' | 'connected' | 'disconnected';

export interface BackendHandlers {
  onTask: (t: RemoteTask) => void;
  onStatus: (s: ConnectionStatus, detail?: string) => void;
}

export interface Backend {
  readonly mode: AppMode;
  /** Start live updates; returns a disposer. */
  connect(h: BackendHandlers): () => void;
  listAgents(): Promise<RemoteAgent[]>;
  createAgent(input: RemoteAgentInput): Promise<RemoteAgent>;
  listTasks(): Promise<RemoteTask[]>;
  createTask(input: { title: string; description: string; agentId: string }): Promise<RemoteTask>;
  getTask(id: string): Promise<RemoteTask>;
  cancelTask(id: string): Promise<RemoteTask>;
  listActivity(): Promise<RemoteActivity[]>;
}
