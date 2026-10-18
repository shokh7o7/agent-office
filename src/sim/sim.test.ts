import { describe, expect, it } from 'vitest';
import { findPath } from './pathfinding';
import { buildOffice, idx } from './map';
import { Simulation, emptyState, THINK_MS, COMPLETED_LINGER_MS } from './engine';
import { canTransition, transition } from './agentMachine';
import { appearanceFor } from './seed';
import type { Agent, AgentState } from '../types';

const office = buildOffice();

function newSim() {
  const sim = new Simulation(emptyState(), office);
  const r = sim.addAgent({ name: 'Test', role: 'Developer', appearance: appearanceFor('t'), deskId: 'ws-A01' });
  if (!r.ok) throw new Error(r.error);
  r.value.nextWanderAt = Infinity; // keep the test deterministic
  return { sim, agent: r.value };
}

/** Tick until predicate or timeout; records every state visited. */
function runUntil(sim: Simulation, agent: Agent, pred: () => boolean, maxMs = 120_000) {
  const states: AgentState[] = [agent.state];
  for (let t = 0; t < maxMs && !pred(); t += 50) {
    sim.tick(50);
    if (states[states.length - 1] !== agent.state) states.push(agent.state);
  }
  return states;
}

describe('pathfinding', () => {
  it('finds a route between rooms through the doorways', () => {
    const path = findPath(office, { x: 5, y: 5 }, { x: 45, y: 33 });
    expect(path).not.toBeNull();
    for (const p of path!.slice(0, -1)) expect(office.blocked[idx(p.x, p.y)]).toBe(0);
  });

  it('never steps diagonally or teleports', () => {
    const path = findPath(office, { x: 5, y: 5 }, { x: 30, y: 33 })!;
    let prev = { x: 5, y: 5 };
    for (const p of path) {
      expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBe(1);
      prev = p;
    }
  });

  it('returns null when the goal is walled off', () => {
    const grid = { width: 5, height: 5, blocked: new Uint8Array(25) };
    for (let y = 0; y < 5; y++) grid.blocked[y * 5 + 2] = 1;
    expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeNull();
  });

  it('can end on a seat but not pass through one', () => {
    const seat = office.workstations[0].seat;
    expect(office.blocked[idx(seat.x, seat.y)]).toBe(1);
    expect(findPath(office, { x: 3, y: 5 }, seat)).not.toBeNull();
  });

  it('has a separate rest spot for every possible agent', () => {
    expect(office.restSpots.length).toBeGreaterThanOrEqual(office.workstations.length);
    expect(office.workstations.length).toBeGreaterThanOrEqual(20);
  });

  it('every workstation and rest spot is reachable from the corridor', () => {
    for (const ws of office.workstations) expect(findPath(office, { x: 23, y: 16 }, ws.seat), ws.label).not.toBeNull();
    for (const r of office.restSpots) expect(findPath(office, { x: 23, y: 16 }, r.pos), r.id).not.toBeNull();
  });
});

describe('agent state machine', () => {
  it('rejects invalid transitions', () => {
    expect(canTransition('SLEEPING', 'WORKING')).toBe(false);
    expect(canTransition('IDLE', 'COMPLETED')).toBe(false);
    const { sim, agent } = newSim();
    agent.state = 'SLEEPING';
    expect(transition(agent, 'WORKING', sim.state.clock)).toBe(false);
    expect(agent.state).toBe('SLEEPING');
  });

  it('runs the full loop: think → walk → work → complete → walk → sleep', () => {
    const { sim, agent } = newSim();
    const r = sim.createTask({ title: 'Write docs', description: '', agentId: agent.id }, { simulated: true });
    expect(r.ok).toBe(true);
    const task = r.ok ? r.value : null!;
    task.failAt = null;
    const states = runUntil(sim, agent, () => agent.state === 'SLEEPING');
    expect(states).toEqual(['IDLE', 'THINKING', 'WALKING', 'WORKING', 'COMPLETED', 'WALKING', 'SLEEPING']);
    expect(task.status).toBe('completed');
    expect(task.progress).toBe(1);
    expect(task.output).toContain('Simulated');
    const spot = office.restSpots.find((s) => s.id === agent.restSpotId)!;
    expect(agent.pos).toEqual(spot.pos);
  });

  it('wakes a sleeping agent when a new task arrives', () => {
    const { sim, agent } = newSim();
    const t1 = sim.createTask({ title: 'One', description: '', agentId: agent.id });
    if (t1.ok) t1.value.failAt = null;
    runUntil(sim, agent, () => agent.state === 'SLEEPING');
    sim.createTask({ title: 'Two', description: '', agentId: agent.id });
    sim.tick(50);
    expect(agent.state).toBe('THINKING');
    expect(agent.restSpotId).toBeNull();
  });

  it('queues a second task instead of double-assigning', () => {
    const { sim, agent } = newSim();
    const a = sim.createTask({ title: 'A', description: '', agentId: agent.id });
    sim.tick(50);
    const b = sim.createTask({ title: 'B', description: '', agentId: agent.id });
    expect(a.ok && b.ok).toBe(true);
    expect(agent.currentTaskId).toBe(a.ok ? a.value.id : '');
    expect(b.ok ? b.value.status : '').toBe('queued');
  });

  it('fails [fail] demo tasks once, and retry succeeds', () => {
    const { sim, agent } = newSim();
    const r = sim.createTask({ title: 'Check [fail]', description: '', agentId: agent.id });
    const task = r.ok ? r.value : null!;
    runUntil(sim, agent, () => agent.state === 'ERROR');
    expect(task.status).toBe('failed');
    expect(sim.retryTask(task.id).ok).toBe(true);
    runUntil(sim, agent, () => task.status === 'completed');
    expect(task.attempt).toBe(2);
  });

  it('cancelling a running task frees the agent without teleporting', () => {
    const { sim, agent } = newSim();
    const r = sim.createTask({ title: 'Long job', description: '', agentId: agent.id });
    sim.tick(THINK_MS + 100);
    sim.tick(100);
    const before = { ...agent.pos };
    expect(sim.cancelTask(r.ok ? r.value.id : '').ok).toBe(true);
    expect(agent.state).toBe('IDLE');
    expect(agent.path.length).toBeLessThanOrEqual(1);
    sim.tick(50);
    expect(Math.abs(agent.pos.x - before.x) + Math.abs(agent.pos.y - before.y)).toBeLessThan(0.5);
  });

  it('gives completed agents separate rest spots', () => {
    const sim = new Simulation(emptyState(), office);
    const agents = [0, 1, 2, 3, 4].map((i) => {
      const r = sim.addAgent({ name: `A${i}`, role: 'Writer', appearance: appearanceFor(String(i)) });
      if (!r.ok) throw new Error(r.error);
      r.value.nextWanderAt = Infinity;
      const t = sim.createTask({ title: `t${i}`, description: '', agentId: r.value.id });
      if (t.ok) t.value.failAt = null;
      return r.value;
    });
    for (let t = 0; t < 120_000 && agents.some((a) => a.state !== 'SLEEPING'); t += 50) sim.tick(50);
    const spots = agents.map((a) => a.restSpotId);
    expect(new Set(spots).size).toBe(agents.length);
    expect(spots.every(Boolean)).toBe(true);
  });

  it('stays responsive with a full office (21 agents)', () => {
    const sim = new Simulation(emptyState(), office);
    for (let i = 0; i < office.workstations.length; i++) {
      const r = sim.addAgent({ name: `N${i}`, role: 'Tester', appearance: appearanceFor(String(i)) });
      expect(r.ok).toBe(true);
      if (r.ok) sim.createTask({ title: `job ${i}`, description: '', agentId: r.value.id });
    }
    expect(sim.addAgent({ name: 'Extra', role: 'Tester', appearance: appearanceFor('x') }).ok).toBe(false);
    const start = performance.now();
    for (let i = 0; i < 1200; i++) sim.tick(50); // one simulated minute
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('refuses tasks for disabled agents', () => {
    const { sim, agent } = newSim();
    expect(sim.setEnabled(agent.id, false).ok).toBe(true);
    expect(sim.createTask({ title: 'x', description: '', agentId: agent.id }).ok).toBe(false);
  });

  it('real-mode tasks follow backend status but still walk the full loop', () => {
    const { sim, agent } = newSim();
    const r = sim.createTask({ title: 'Remote job', description: '', agentId: agent.id }, { simulated: false, id: 'r1' });
    expect(r.ok).toBe(true);
    sim.applyRemoteTask({ id: 'r1', status: 'running', progress: 0.2 });
    const before = runUntil(sim, agent, () => agent.state === 'WORKING');
    expect(before).toEqual(['IDLE', 'THINKING', 'WALKING', 'WORKING']);
    // no simulated progress in real mode
    for (let i = 0; i < 100; i++) sim.tick(50);
    expect(sim.state.tasks.r1.progress).toBe(0.2);
    sim.applyRemoteTask({ id: 'r1', status: 'completed', progress: 1, output: 'done' });
    runUntil(sim, agent, () => agent.state === 'SLEEPING');
    expect(sim.state.tasks.r1.status).toBe('completed');
    expect(sim.state.tasks.r1.finishedAt).toBeDefined();
    expect(sim.state.tasks.r1.output).toBe('done');
  });

  it('walks around an agent standing in the way instead of through it', () => {
    const sim = new Simulation(emptyState(), office);
    const mk = (name: string, deskId: string) => {
      const r = sim.addAgent({ name, role: 'Tester', appearance: appearanceFor(name), deskId });
      if (!r.ok) throw new Error(r.error);
      r.value.nextWanderAt = Infinity;
      return r.value;
    };
    const walker = mk('Walker', 'ws-A01');
    const blocker = mk('Blocker', 'ws-A02');
    walker.pos = { x: 1, y: 10 };
    blocker.pos = { x: 4, y: 10 };
    expect((sim as unknown as { walkTo: (a: Agent, p: { x: number; y: number }, i: string) => boolean }).walkTo(walker, { x: 7, y: 10 }, 'wander')).toBe(true);
    walker.state = 'WALKING';
    let overlapped = false;
    for (let t = 0; t < 10_000 && walker.path.length; t += 50) {
      sim.tick(50);
      if (Math.round(walker.pos.x) === 4 && Math.round(walker.pos.y) === 10) overlapped = true;
    }
    expect(walker.path.length).toBe(0);
    expect(overlapped).toBe(false);
    expect(blocker.pos).toEqual({ x: 4, y: 10 });
  });

  it('squeezes past when there is no way around (no deadlock)', () => {
    const grid = { width: 5, height: 1, blocked: new Uint8Array(5) };
    const sim = new Simulation(emptyState(), office);
    const a = sim.addAgent({ name: 'A', role: 'Tester', appearance: appearanceFor('a') });
    const b = sim.addAgent({ name: 'B', role: 'Tester', appearance: appearanceFor('b') });
    if (!a.ok || !b.ok) throw new Error('setup');
    // swap in a one-tile-wide corridor where neither agent can step aside
    (sim as unknown as { map: typeof office }).map = { ...office, ...grid, walkable: [] };
    Object.assign(a.value, { pos: { x: 0, y: 0 }, path: [1, 2, 3, 4].map((x) => ({ x, y: 0 })), state: 'WALKING', intent: 'wander', nextWanderAt: Infinity });
    Object.assign(b.value, { pos: { x: 4, y: 0 }, path: [3, 2, 1, 0].map((x) => ({ x, y: 0 })), state: 'WALKING', intent: 'wander', nextWanderAt: Infinity });
    for (let t = 0; t < 20_000 && (a.value.path.length || b.value.path.length); t += 50) sim.tick(50);
    expect(a.value.pos).toEqual({ x: 4, y: 0 });
    expect(b.value.pos).toEqual({ x: 0, y: 0 });
  });

  it('imports backend activity once, in time order', () => {
    const sim = new Simulation(emptyState(), office);
    const entries = [
      { t: 2000, level: 'info' as const, msg: 'second' },
      { t: 1000, level: 'success' as const, msg: 'first' },
    ];
    expect(sim.importActivity(entries)).toBe(2);
    expect(sim.importActivity(entries)).toBe(0);
    expect(sim.state.activity.map((a) => a.msg)).toEqual(['first', 'second']);
  });

  it('shows the backend error reason when a real task fails', () => {
    const { sim, agent } = newSim();
    sim.createTask({ title: 'salom', description: '', agentId: agent.id }, { simulated: false, id: 'r2' });
    sim.applyRemoteTask({ id: 'r2', status: 'running', logs: [{ t: 1, level: 'info', msg: 'Accepted' }] });
    sim.applyRemoteTask({
      id: 'r2',
      status: 'failed',
      output: '[error] Gemini error: API key not valid',
      logs: [
        { t: 1, level: 'info', msg: 'Accepted' },
        { t: 2, level: 'error', msg: 'Gemini error: API key not valid' },
      ],
    });
    runUntil(sim, agent, () => agent.state === 'ERROR');
    const task = sim.state.tasks.r2;
    expect(task.logs.filter((l) => l.msg.startsWith('[backend]')).map((l) => l.msg)).toEqual(['[backend] Accepted', '[backend] Gemini error: API key not valid']);
    expect(sim.state.activity[sim.state.activity.length - 1].msg).toBe('Test failed “salom”: Gemini error: API key not valid');
  });

  it('linger timings are sane', () => {
    expect(COMPLETED_LINGER_MS).toBeGreaterThan(1000);
  });
});
