import type { Backend, BackendHandlers, RemoteActivity, RemoteAgent, RemoteAgentInput, RemoteTask } from './adapter';

/**
 * Demo mode: all work runs in the in-browser simulation and is labelled as
 * simulated. This adapter exists so the store can treat both modes alike.
 */
export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  connect(h: BackendHandlers) {
    h.onStatus('demo');
    return () => {};
  }
  async listAgents(): Promise<RemoteAgent[]> {
    return [];
  }
  async createAgent(input: RemoteAgentInput): Promise<RemoteAgent> {
    return { id: '', ...input };
  }
  async listTasks(): Promise<RemoteTask[]> {
    return [];
  }
  async createTask(): Promise<RemoteTask> {
    throw new Error('Demo tasks are created locally');
  }
  async getTask(): Promise<RemoteTask> {
    throw new Error('Demo tasks live in the browser');
  }
  async cancelTask(): Promise<RemoteTask> {
    throw new Error('Demo tasks are cancelled locally');
  }
  async listActivity(): Promise<RemoteActivity[]> {
    return [];
  }
}
