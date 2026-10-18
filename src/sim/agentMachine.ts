import type { Agent, AgentState } from '../types';

/**
 * Allowed agent state transitions. Anything not listed is rejected, which
 * keeps the office animation and the task list consistent.
 */
export const TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE: ['THINKING', 'WALKING', 'SLEEPING'],
  THINKING: ['WALKING', 'WORKING', 'WAITING', 'IDLE'],
  WALKING: ['WORKING', 'SLEEPING', 'IDLE', 'WAITING', 'THINKING'],
  WAITING: ['WALKING', 'WORKING', 'IDLE', 'THINKING'],
  WORKING: ['COMPLETED', 'ERROR', 'IDLE'],
  COMPLETED: ['WALKING', 'THINKING', 'IDLE'],
  ERROR: ['IDLE', 'THINKING', 'WALKING'],
  SLEEPING: ['THINKING', 'WALKING', 'IDLE'],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Apply a transition; returns false (and leaves the agent untouched) if invalid. */
export function transition(agent: Agent, to: AgentState, clock: number): boolean {
  if (!canTransition(agent.state, to)) {
    if (import.meta.env?.DEV) console.warn(`[agent ${agent.name}] invalid transition ${agent.state} → ${to}`);
    return false;
  }
  if (agent.state !== to) {
    agent.state = to;
    agent.stateSince = clock;
  }
  return true;
}

export const STATE_LABEL: Record<AgentState, string> = {
  IDLE: 'Idle',
  THINKING: 'Thinking',
  WORKING: 'Working',
  WALKING: 'Walking',
  WAITING: 'Waiting',
  COMPLETED: 'Completed',
  ERROR: 'Error',
  SLEEPING: 'Sleeping',
};
