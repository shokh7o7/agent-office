export type AgentState =
  | 'IDLE'
  | 'THINKING'
  | 'WORKING'
  | 'WALKING'
  | 'WAITING'
  | 'COMPLETED'
  | 'ERROR'
  | 'SLEEPING';

export type AgentRole = 'Developer' | 'Researcher' | 'Designer' | 'Writer' | 'Tester' | 'Analyst' | 'Manager';

export type Facing = 'down' | 'up' | 'left' | 'right';

export type HairStyle = 'short' | 'long' | 'spiky' | 'bun' | 'curly' | 'bald';

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
}

export interface Point {
  x: number;
  y: number;
}

/** Why an agent is walking — decides what happens when it arrives. */
export type WalkIntent = 'work' | 'rest' | 'wander';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  appearance: Appearance;
  enabled: boolean;
  provider?: string;
  model?: string;

  state: AgentState;
  /** Sim-clock time (ms) the current state began. */
  stateSince: number;
  /** Position in tile units (fractional while walking). */
  pos: Point;
  facing: Facing;
  path: Point[];
  intent: WalkIntent | null;
  /** Assigned workstation id, or null if none. */
  deskId: string | null;
  /** Rest spot currently reserved, if any. */
  restSpotId: string | null;

  currentTaskId: string | null;
  /** Task ids waiting for this agent, oldest first. */
  queue: string[];
  /** Sim-clock time of the next idle wander decision. */
  nextWanderAt: number;
  /** Wall-clock time of last meaningful activity. */
  lastActivityAt: number;
  /** Sim-clock ms spent waiting for another agent to clear the next tile. */
  blockedFor?: number;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskLog {
  t: number;
  level: 'info' | 'success' | 'warn' | 'error';
  msg: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  agentId: string;
  status: TaskStatus;
  progress: number; // 0..1
  attempt: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: TaskLog[];
  output?: string;
  /** True when produced by the demo simulator, not a real AI run. */
  simulated: boolean;
  /** Demo only: simulated work duration (ms of sim clock). */
  durationMs: number;
  /** Demo only: progress at which this attempt fails, or null if it succeeds. */
  failAt: number | null;
  /** Real mode: terminal status reported by the backend, applied once the agent is at work. */
  pendingStatus?: 'completed' | 'failed';
}

export interface Activity {
  id: string;
  t: number;
  level: 'info' | 'success' | 'warn' | 'error';
  msg: string;
  agentId?: string;
  taskId?: string;
}

export type AppMode = 'demo' | 'real';

export interface Settings {
  mode: AppMode;
  paused: boolean;
  speed: 1 | 2 | 4;
  apiBaseUrl: string;
}

export interface SimState {
  clock: number;
  seed: number;
  agents: Record<string, Agent>;
  agentOrder: string[];
  tasks: Record<string, Task>;
  taskOrder: string[];
  activity: Activity[];
}
