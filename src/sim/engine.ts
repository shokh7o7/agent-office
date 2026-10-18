import type { Activity, Agent, AgentRole, Appearance, Point, SimState, Task, TaskLog, TaskStatus } from '../types';
import { transition } from './agentMachine';
import { findPath } from './pathfinding';
import { getOffice, idx, roomAt, type OfficeMap, type RestSpot } from './map';
import { hash, rand, uid } from './random';

export const THINK_MS = 1600;
export const COMPLETED_LINGER_MS = 2500;
export const ERROR_LINGER_MS = 7000;
export const WAIT_RETRY_MS = 1000;
export const WALK_SPEED = 3.6; // tiles per second
/** Wait this long behind another agent before looking for a way around. */
export const DETOUR_AFTER_MS = 350;
/** Give up waiting and squeeze past (prevents deadlocks in narrow corridors). */
export const PASS_THROUGH_AFTER_MS = 1200;
const ACTIVITY_CAP = 300;

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

export interface NewAgentInput {
  name: string;
  role: AgentRole;
  appearance: Appearance;
  provider?: string;
  model?: string;
  deskId?: string | null;
}

export interface RemoteTaskUpdate {
  id: string;
  status?: TaskStatus;
  progress?: number;
  output?: string;
  logs?: TaskLog[];
}

/** Demo-only: deterministic duration and failure point for a simulated run. */
export function planDemoRun(title: string, agentId: string, attempt: number) {
  const h = hash(`${title}|${agentId}`);
  const durationMs = 9000 + (h % 12000);
  let failAt: number | null = null;
  if (/\[fail\]|\bfail\b/i.test(title) && attempt === 1) failAt = 0.35 + (h % 30) / 100;
  else if (attempt === 1 && hash(`${title}|${attempt}`) % 11 === 0) failAt = 0.62;
  return { durationMs, failAt };
}

export function emptyState(): SimState {
  return { clock: 0, seed: 1234567, agents: {}, agentOrder: [], tasks: {}, taskOrder: [], activity: [] };
}

export class Simulation {
  readonly map: OfficeMap;
  constructor(public state: SimState = emptyState(), map: OfficeMap = getOffice()) {
    this.map = map;
  }

  // ------------------------------------------------------------------ helpers
  private random(): number {
    const [v, next] = rand(this.state.seed);
    this.state.seed = next;
    return v;
  }

  get agents(): Agent[] {
    return this.state.agentOrder.map((id) => this.state.agents[id]).filter(Boolean);
  }

  get tasks(): Task[] {
    return this.state.taskOrder.map((id) => this.state.tasks[id]).filter(Boolean);
  }

  activeTask(agent: Agent): Task | null {
    const t = agent.currentTaskId ? this.state.tasks[agent.currentTaskId] : undefined;
    return t ?? null;
  }

  /** Busy = owns a queued or running task (not merely showing a finished one). */
  isBusy(agent: Agent): boolean {
    const t = this.activeTask(agent);
    return !!t && (t.status === 'running' || t.status === 'queued');
  }

  workstation(agent: Agent) {
    return agent.deskId ? this.map.workstations.find((w) => w.id === agent.deskId) ?? null : null;
  }

  freeDesks() {
    const taken = new Set(this.agents.map((a) => a.deskId));
    return this.map.workstations.filter((w) => !taken.has(w.id));
  }

  log(level: Activity['level'], msg: string, agentId?: string, taskId?: string) {
    const entry: Activity = { id: uid('act'), t: Date.now(), level, msg, agentId, taskId };
    this.state.activity.push(entry);
    if (this.state.activity.length > ACTIVITY_CAP) this.state.activity.splice(0, this.state.activity.length - ACTIVITY_CAP);
    if (taskId) this.state.tasks[taskId]?.logs.push({ t: entry.t, level, msg });
    if (agentId && this.state.agents[agentId]) this.state.agents[agentId].lastActivityAt = entry.t;
  }

  private tile(p: Point): Point {
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  /** Nearest walkable tile to `p` (BFS), used for spawning. */
  nearestWalkable(p: Point): Point {
    const { width: W, height: H, blocked } = this.map;
    const start = this.tile(p);
    const seen = new Set<number>([idx(start.x, start.y)]);
    const q: Point[] = [start];
    while (q.length) {
      const c = q.shift()!;
      if (!blocked[idx(c.x, c.y)]) return c;
      for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
        const n = { x: c.x + dx, y: c.y + dy };
        if (n.x < 0 || n.y < 0 || n.x >= W || n.y >= H) continue;
        const k = idx(n.x, n.y);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push(n);
      }
    }
    return start;
  }

  /** Stop any walk after the current step so the character never jumps. */
  private haltAfterStep(agent: Agent) {
    agent.path = agent.path.slice(0, 1);
    agent.intent = null;
  }

  private releaseRest(agent: Agent) {
    agent.restSpotId = null;
  }

  private walkTo(agent: Agent, target: Point, intent: Agent['intent']): boolean {
    const path = findPath(this.map, this.tile(agent.pos), target);
    if (!path) return false;
    agent.path = path;
    agent.intent = intent;
    return true;
  }

  // ------------------------------------------------------------------ agents
  addAgent(input: NewAgentInput, id = uid('agent')): Result<Agent> {
    if (!input.name.trim()) return fail('Give the agent a name.');
    const deskId = input.deskId === undefined ? this.freeDesks()[0]?.id ?? null : input.deskId;
    if (!deskId) return fail('Every desk is taken. Free a desk before adding another agent.');
    if (this.agents.some((a) => a.deskId === deskId)) return fail('That desk already belongs to another agent.');
    const ws = this.map.workstations.find((w) => w.id === deskId);
    const spawn = this.nearestWalkable(ws ? { x: ws.seat.x, y: ws.seat.y - 1 } : { x: 23, y: 16 });
    const agent: Agent = {
      id,
      name: input.name.trim(),
      role: input.role,
      appearance: input.appearance,
      enabled: true,
      provider: input.provider || undefined,
      model: input.model || undefined,
      state: 'IDLE',
      stateSince: this.state.clock,
      pos: spawn,
      facing: 'down',
      path: [],
      intent: null,
      deskId,
      restSpotId: null,
      currentTaskId: null,
      queue: [],
      nextWanderAt: this.state.clock + 3000 + this.random() * 9000,
      lastActivityAt: Date.now(),
    };
    this.state.agents[id] = agent;
    this.state.agentOrder.push(id);
    this.log('info', `${agent.name} joined as ${agent.role} at desk ${ws?.label ?? '—'}`, id);
    return ok(agent);
  }

  updateAgent(id: string, patch: Partial<Pick<Agent, 'name' | 'role' | 'provider' | 'model' | 'appearance' | 'deskId'>>): Result<Agent> {
    const agent = this.state.agents[id];
    if (!agent) return fail('Agent not found.');
    if (patch.name !== undefined && !patch.name.trim()) return fail('Name cannot be empty.');
    if (patch.deskId !== undefined && patch.deskId !== agent.deskId) {
      if (this.isBusy(agent)) return fail('Move desks after the current task finishes.');
      if (patch.deskId && this.agents.some((a) => a.id !== id && a.deskId === patch.deskId)) return fail('That desk already belongs to another agent.');
    }
    Object.assign(agent, patch, patch.name ? { name: patch.name.trim() } : {});
    this.log('info', `${agent.name}'s profile was updated`, id);
    return ok(agent);
  }

  setEnabled(id: string, enabled: boolean): Result<Agent> {
    const agent = this.state.agents[id];
    if (!agent) return fail('Agent not found.');
    if (agent.enabled === enabled) return ok(agent);
    if (!enabled && (this.isBusy(agent) || agent.queue.length)) return fail(`Cancel ${agent.name}'s tasks before disabling.`);
    agent.enabled = enabled;
    this.log(enabled ? 'info' : 'warn', `${agent.name} was ${enabled ? 'enabled' : 'disabled'}`, id);
    if (!enabled && agent.state !== 'SLEEPING') this.goRest(agent);
    return ok(agent);
  }

  // ------------------------------------------------------------------ tasks
  createTask(
    input: { title: string; description: string; agentId: string },
    opts: { simulated: boolean; id?: string } = { simulated: true },
  ): Result<Task> {
    const title = input.title.trim();
    if (!title) return fail('Give the task a title.');
    const agent = this.state.agents[input.agentId];
    if (!agent) return fail('Choose an agent for this task.');
    if (!agent.enabled) return fail(`${agent.name} is disabled. Enable the agent first.`);
    const id = opts.id ?? uid('task');
    if (this.state.tasks[id]) return fail('This task already exists.');
    const plan = planDemoRun(title, agent.id, 1);
    const task: Task = {
      id,
      title,
      description: input.description.trim(),
      agentId: agent.id,
      status: 'queued',
      progress: 0,
      attempt: 1,
      createdAt: Date.now(),
      logs: [],
      simulated: opts.simulated,
      durationMs: plan.durationMs,
      failAt: opts.simulated ? plan.failAt : null,
    };
    this.state.tasks[id] = task;
    this.state.taskOrder.push(id);
    agent.queue.push(id);
    this.log('info', `Task “${title}” assigned to ${agent.name}${this.isBusy(agent) ? ' (queued)' : ''}`, agent.id, id);
    return ok(task);
  }

  cancelTask(taskId: string): Result<Task> {
    const task = this.state.tasks[taskId];
    if (!task) return fail('Task not found.');
    if (task.status !== 'queued' && task.status !== 'running') return fail('Only queued or running tasks can be cancelled.');
    const agent = this.state.agents[task.agentId];
    task.status = 'cancelled';
    task.finishedAt = Date.now();
    this.log('warn', `Task “${task.title}” was cancelled`, agent?.id, task.id);
    if (agent) {
      agent.queue = agent.queue.filter((q) => q !== taskId);
      if (agent.currentTaskId === taskId) {
        agent.currentTaskId = null;
        this.haltAfterStep(agent);
        transition(agent, 'IDLE', this.state.clock);
        agent.nextWanderAt = this.state.clock + 4000;
      }
    }
    return ok(task);
  }

  retryTask(taskId: string): Result<Task> {
    const task = this.state.tasks[taskId];
    if (!task) return fail('Task not found.');
    if (!task.simulated) return fail('Real tasks are retried from the backend.');
    if (task.status !== 'failed' && task.status !== 'cancelled') return fail('Only failed or cancelled tasks can be retried.');
    const agent = this.state.agents[task.agentId];
    if (!agent) return fail('The assigned agent no longer exists.');
    if (!agent.enabled) return fail(`${agent.name} is disabled. Enable the agent first.`);
    task.attempt += 1;
    const plan = planDemoRun(task.title, agent.id, task.attempt);
    Object.assign(task, { status: 'queued', pendingStatus: undefined, progress: 0, failAt: plan.failAt, output: undefined, finishedAt: undefined, startedAt: undefined });
    agent.queue.push(task.id);
    this.log('info', `Retrying “${task.title}” (attempt ${task.attempt})`, agent.id, task.id);
    return ok(task);
  }

  /** Real mode: merge backend state. The tick reacts to the new status. */
  applyRemoteTask(update: RemoteTaskUpdate) {
    const task = this.state.tasks[update.id];
    if (!task || task.simulated) return;
    if (task.status === 'cancelled' || task.status === 'completed' || task.status === 'failed') return;
    if (update.progress !== undefined) task.progress = Math.max(0, Math.min(1, update.progress));
    if (update.output !== undefined) task.output = update.output;
    if (update.logs) for (const l of update.logs.slice(task.logs.length)) task.logs.push(l);
    // The local state machine owns queued → running (the agent has to walk to its
    // desk first); the backend's final verdict is applied once the agent is working.
    if (update.status === 'cancelled') this.cancelTask(task.id);
    else if (update.status === 'completed' || update.status === 'failed') task.pendingStatus = update.status;
  }

  /** Real mode: merge backend activity history, skipping entries already present. */
  importActivity(entries: Omit<Activity, 'id'>[]) {
    const seen = new Set(this.state.activity.map((a) => `${a.t}|${a.msg}`));
    const fresh = entries.filter((e) => !seen.has(`${e.t}|${e.msg}`)).map((e) => ({ ...e, id: uid('act') }));
    if (!fresh.length) return 0;
    this.state.activity = [...this.state.activity, ...fresh].sort((a, b) => a.t - b.t).slice(-ACTIVITY_CAP);
    return fresh.length;
  }

  // ------------------------------------------------------------------ behaviour
  private startNext(agent: Agent): boolean {
    while (agent.queue.length) {
      const id = agent.queue.shift()!;
      const task = this.state.tasks[id];
      if (!task || task.status !== 'queued') continue;
      if (agent.restSpotId) this.releaseRest(agent);
      this.haltAfterStep(agent);
      agent.currentTaskId = id;
      task.status = 'running';
      task.startedAt = Date.now();
      transition(agent, 'THINKING', this.state.clock);
      this.log('info', `${agent.name} started thinking about “${task.title}”`, agent.id, id);
      return true;
    }
    return false;
  }

  private headToDesk(agent: Agent) {
    const ws = this.workstation(agent);
    const here = this.tile(agent.pos);
    if (!ws || (here.x === ws.seat.x && here.y === ws.seat.y)) {
      this.beginWork(agent);
      return;
    }
    if (this.walkTo(agent, ws.seat, 'work')) {
      transition(agent, 'WALKING', this.state.clock);
    } else if (agent.state !== 'WAITING') {
      agent.intent = 'work';
      transition(agent, 'WAITING', this.state.clock);
      this.log('warn', `${agent.name} can't reach desk ${ws.label}; waiting`, agent.id, agent.currentTaskId ?? undefined);
    }
  }

  private beginWork(agent: Agent) {
    agent.facing = 'down';
    agent.intent = null;
    transition(agent, 'WORKING', this.state.clock);
    const task = this.activeTask(agent);
    if (task) this.log('info', `${agent.name} sat down and is working${task.simulated ? ' (simulated)' : ''}`, agent.id, task.id);
  }

  freeRestSpot(agent: Agent): RestSpot | null {
    const reserved = new Set(this.agents.filter((a) => a.id !== agent.id).map((a) => a.restSpotId));
    const here = this.tile(agent.pos);
    let best: RestSpot | null = null;
    let bestD = Infinity;
    for (const s of this.map.restSpots) {
      if (reserved.has(s.id)) continue;
      // sofas/beanbags are preferred over floor cushions
      const d = Math.abs(s.pos.x - here.x) + Math.abs(s.pos.y - here.y) + (s.kind === 'floor' ? 40 : 0);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private goRest(agent: Agent) {
    const spot = this.freeRestSpot(agent);
    if (!spot) {
      transition(agent, 'IDLE', this.state.clock);
      return;
    }
    agent.restSpotId = spot.id;
    if (this.walkTo(agent, spot.pos, 'rest')) {
      transition(agent, 'WALKING', this.state.clock);
    } else {
      agent.intent = 'rest';
      transition(agent, 'WAITING', this.state.clock);
    }
  }

  private arrive(agent: Agent) {
    const intent = agent.intent;
    agent.intent = null;
    if (intent === 'work') {
      this.beginWork(agent);
    } else if (intent === 'rest') {
      const spot = this.map.restSpots.find((s) => s.id === agent.restSpotId);
      if (spot) agent.facing = spot.facing;
      transition(agent, 'SLEEPING', this.state.clock);
      this.log('info', `${agent.name} is resting in the ${roomAt(agent.pos) === 'breakroom' ? 'break room' : 'lounge'}`, agent.id);
    } else {
      transition(agent, 'IDLE', this.state.clock);
      agent.nextWanderAt = this.state.clock + 7000 + this.random() * 12000;
    }
  }

  private finishTask(agent: Agent, task: Task) {
    task.finishedAt = Date.now();
    task.progress = task.status === 'completed' ? 1 : task.progress;
    if (task.status === 'completed') {
      if (task.simulated && !task.output) task.output = simulatedOutput(task, agent);
      transition(agent, 'COMPLETED', this.state.clock);
      this.log('success', `${agent.name} completed “${task.title}”`, agent.id, task.id);
    } else {
      if (task.simulated && !task.output) task.output = `[Simulated failure] The demo run stopped at ${Math.round(task.progress * 100)}%. Retry to run it again.`;
      transition(agent, 'ERROR', this.state.clock);
      this.log('error', `${agent.name} failed “${task.title}”`, agent.id, task.id);
    }
  }

  private advanceSimulatedWork(agent: Agent, task: Task, dt: number) {
    const before = task.progress;
    task.progress = Math.min(1, task.progress + dt / task.durationMs);
    for (const m of [0.25, 0.5, 0.75]) {
      if (before < m && task.progress >= m) this.log('info', `${agent.name} ${milestone(agent, m)} [simulated, ${Math.round(m * 100)}%]`, agent.id, task.id);
    }
    if (task.failAt !== null && task.progress >= task.failAt) {
      task.progress = task.failAt;
      task.status = 'failed';
      this.log('error', `${agent.name} hit an injected demo error [simulated]`, agent.id, task.id);
    } else if (task.progress >= 1) {
      task.status = 'completed';
    }
  }

  /** Tiles other agents stand on or are stepping into. */
  private occupiedTiles(except: Agent): Set<number> {
    const occ = new Set<number>();
    for (const o of this.agents) {
      if (o.id === except.id) continue;
      occ.add(idx(Math.round(o.pos.x), Math.round(o.pos.y)));
      if (o.path.length) occ.add(idx(o.path[0].x, o.path[0].y));
    }
    return occ;
  }

  /** A* around other agents; returns null if there is no reasonable detour. */
  private detour(agent: Agent, occ: Set<number>): Point[] | null {
    const goal = agent.path[agent.path.length - 1];
    const blocked = this.map.blocked.slice();
    for (const k of occ) if (k !== idx(goal.x, goal.y)) blocked[k] = 1;
    const path = findPath({ width: this.map.width, height: this.map.height, blocked }, this.tile(agent.pos), goal);
    return path && path.length && path.length <= agent.path.length + 6 ? path : null;
  }

  private stepMovement(agent: Agent, dt: number) {
    let budget = (WALK_SPEED * dt) / 1000;
    while (budget > 0 && agent.path.length) {
      const next = agent.path[0];
      const atTile = agent.pos.x === Math.round(agent.pos.x) && agent.pos.y === Math.round(agent.pos.y);
      // Only decide at tile boundaries, so a step that has started always finishes.
      if (atTile && agent.path.length) {
        const occ = this.occupiedTiles(agent);
        if (occ.has(idx(next.x, next.y))) {
          const waited = (agent.blockedFor ?? 0) + dt;
          agent.blockedFor = waited;
          if (waited >= DETOUR_AFTER_MS && waited - dt < DETOUR_AFTER_MS) {
            const alt = this.detour(agent, occ);
            if (alt) {
              agent.path = alt;
              agent.blockedFor = 0;
              continue;
            }
          }
          if (waited < PASS_THROUGH_AFTER_MS) return;
        }
      }
      agent.blockedFor = 0;
      const dx = next.x - agent.pos.x;
      const dy = next.y - agent.pos.y;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) agent.facing = dx > 0 ? 'right' : 'left';
      else if (dist > 0) agent.facing = dy > 0 ? 'down' : 'up';
      if (dist <= budget) {
        agent.pos = { x: next.x, y: next.y };
        agent.path.shift();
        budget -= dist;
      } else {
        agent.pos = { x: agent.pos.x + (dx / dist) * budget, y: agent.pos.y + (dy / dist) * budget };
        budget = 0;
      }
    }
  }

  private pickWanderTarget(agent: Agent): Point | null {
    const room = roomAt(agent.pos);
    const here = this.tile(agent.pos);
    const occ = this.occupiedTiles(agent);
    const near = this.map.walkable.filter(
      (p) => !occ.has(idx(p.x, p.y)) && roomAt(p) === room && Math.abs(p.x - here.x) + Math.abs(p.y - here.y) <= 7 && (p.x !== here.x || p.y !== here.y),
    );
    if (!near.length) return null;
    return near[Math.floor(this.random() * near.length)];
  }

  tick(dtMs: number) {
    const dt = Math.min(dtMs, 250); // avoid huge jumps after tab switches
    this.state.clock += dt;
    const clock = this.state.clock;
    for (const agent of this.agents) {
      this.stepMovement(agent, dt);
      const inState = clock - agent.stateSince;
      const task = this.activeTask(agent);

      switch (agent.state) {
        case 'IDLE':
          if (agent.path.length) break;
          if (agent.enabled && this.startNext(agent)) break;
          if (!agent.enabled) {
            this.goRest(agent);
            break;
          }
          if (clock >= agent.nextWanderAt) {
            const target = this.pickWanderTarget(agent);
            agent.nextWanderAt = clock + 8000 + this.random() * 12000;
            if (target && this.walkTo(agent, target, 'wander')) transition(agent, 'WALKING', clock);
          }
          break;
        case 'THINKING':
          if (inState >= THINK_MS && !agent.path.length) this.headToDesk(agent);
          break;
        case 'WAITING':
          if (inState >= WAIT_RETRY_MS) {
            agent.stateSince = clock;
            if (agent.intent === 'work') this.headToDesk(agent);
            else if (agent.intent === 'rest') this.goRest(agent);
            else transition(agent, 'IDLE', clock);
          }
          break;
        case 'WALKING':
          if (agent.intent !== 'work' && agent.enabled && agent.queue.length && this.startNext(agent)) break;
          if (!agent.path.length) this.arrive(agent);
          break;
        case 'WORKING':
          if (!task) {
            transition(agent, 'IDLE', clock);
            break;
          }
          if (task.simulated && task.status === 'running') this.advanceSimulatedWork(agent, task, dt);
          if (!task.simulated && task.status === 'running' && task.pendingStatus) task.status = task.pendingStatus;
          if (task.status === 'completed' || task.status === 'failed') this.finishTask(agent, task);
          break;
        case 'COMPLETED':
          if (inState >= COMPLETED_LINGER_MS) {
            agent.currentTaskId = null;
            if (!(agent.enabled && this.startNext(agent))) this.goRest(agent);
          }
          break;
        case 'ERROR':
          if (inState >= ERROR_LINGER_MS) {
            agent.currentTaskId = null;
            if (!(agent.enabled && this.startNext(agent))) {
              transition(agent, 'IDLE', clock);
              agent.nextWanderAt = clock + 5000;
            }
          }
          break;
        case 'SLEEPING':
          if (agent.enabled && agent.queue.length) this.startNext(agent);
          break;
      }
    }
  }
}

function milestone(agent: Agent, m: number): string {
  const steps: Record<AgentRole, string[]> = {
    Developer: ['read the codebase', 'drafted the change', 'ran the test suite'],
    Researcher: ['collected sources', 'compared findings', 'outlined conclusions'],
    Designer: ['gathered references', 'sketched layouts', 'refined the mockup'],
    Writer: ['outlined the piece', 'wrote the first draft', 'edited for clarity'],
    Tester: ['wrote test cases', 'ran the checks', 'triaged results'],
    Analyst: ['loaded the data', 'built the model', 'checked the numbers'],
    Manager: ['reviewed the brief', 'split the work', 'checked progress'],
  };
  return steps[agent.role][m === 0.25 ? 0 : m === 0.5 ? 1 : 2];
}

function simulatedOutput(task: Task, agent: Agent): string {
  return [
    `[Simulated output — no AI model was called]`,
    `${agent.name} (${agent.role}) finished “${task.title}” in demo mode.`,
    task.description ? `Brief: ${task.description}` : 'No description was provided.',
    `Connect a backend in Real mode to get actual results.`,
  ].join('\n');
}
