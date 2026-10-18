import type { Backend, BackendHandlers, RemoteActivity, RemoteAgent, RemoteAgentInput, RemoteDevice, RemoteTask } from './adapter';

/** Real mode: talks to a backend implementing the contract in adapter.ts. */
export class HttpBackend implements Backend {
  readonly mode = 'real' as const;
  constructor(private base: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  connect(h: BackendHandlers) {
    let closed = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    h.onStatus('connecting');

    const startPolling = () => {
      if (poll || closed) return;
      poll = setInterval(async () => {
        try {
          const tasks = await this.listTasks();
          if (closed) return;
          h.onStatus('connected');
          tasks.forEach(h.onTask);
        } catch (e) {
          if (!closed) h.onStatus('disconnected', (e as Error).message);
        }
      }, 3000);
    };

    this.listTasks()
      .then((tasks) => {
        if (closed) return;
        h.onStatus('connected');
        tasks.forEach(h.onTask);
        if (typeof EventSource === 'undefined') return startPolling();
        es = new EventSource(`${this.base}/api/events`);
        es.addEventListener('task', (ev) => {
          try {
            h.onTask(JSON.parse((ev as MessageEvent).data));
          } catch {
            /* ignore malformed event */
          }
        });
        es.onerror = () => {
          es?.close();
          es = null;
          startPolling(); // fall back to polling when SSE is unavailable
        };
      })
      .catch((e) => {
        if (closed) return;
        h.onStatus('disconnected', (e as Error).message);
        startPolling();
      });

    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }

  listAgents() {
    return this.req<RemoteAgent[]>('/api/agents');
  }
  createAgent(input: RemoteAgentInput) {
    return this.req<RemoteAgent>('/api/agents', { method: 'POST', body: JSON.stringify(input) });
  }
  listTasks() {
    return this.req<RemoteTask[]>('/api/tasks');
  }
  createTask(input: { title: string; description: string; agentId: string; deviceId?: string }) {
    return this.req<RemoteTask>('/api/tasks', { method: 'POST', body: JSON.stringify(input) });
  }
  getTask(id: string) {
    return this.req<RemoteTask>(`/api/tasks/${encodeURIComponent(id)}`);
  }
  cancelTask(id: string) {
    return this.req<RemoteTask>(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }
  listActivity() {
    return this.req<RemoteActivity[]>('/api/activity');
  }
  listDevices() {
    return this.req<RemoteDevice[]>('/api/devices');
  }
  respondApproval(approvalId: string, approve: boolean) {
    return this.req<void>(`/api/approvals/${encodeURIComponent(approvalId)}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
  }
}
