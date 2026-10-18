// Reference backend for Real mode. It implements the HTTP contract from
// src/api/adapter.ts with an in-memory store and FAKE progress: it does NOT
// call any AI provider. Replace runTask() with real provider calls (keeping
// keys server-side) to turn this into a working agent backend.
//
//   node server/mock-backend.mjs        # listens on http://localhost:8787
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
const agents = [
  { id: 'srv-ana', name: 'Ana', role: 'Researcher', provider: 'mock', model: 'mock-1', enabled: true },
  { id: 'srv-bo', name: 'Bo', role: 'Developer', provider: 'mock', model: 'mock-1', enabled: true },
  { id: 'srv-cy', name: 'Cy', role: 'Writer', provider: 'mock', model: 'mock-1', enabled: true },
];
const tasks = new Map();
const activity = [];
const streams = new Set();

const now = () => Date.now();
const log = (task, level, msg) => {
  const entry = { t: now(), level, msg };
  task.logs.push(entry);
  activity.push({ ...entry, agentId: task.agentId, taskId: task.id });
};
const publish = (task) => {
  for (const res of streams) res.write(`event: task\ndata: ${JSON.stringify(task)}\n\n`);
};

function runTask(task) {
  // Placeholder worker: replace with a real model call.
  const timer = setInterval(() => {
    if (task.status !== 'running') return clearInterval(timer);
    task.progress = Math.min(1, task.progress + 0.08);
    if (task.progress >= 1) {
      task.status = 'completed';
      task.output = `[mock backend] No model was called. Replace runTask() in server/mock-backend.mjs.\nTask: ${task.title}`;
      log(task, 'success', 'Mock run finished');
      clearInterval(timer);
    }
    publish(task);
  }, 1000);
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts[0] !== 'api') return send(res, 404, { error: 'not found' });

    if (parts[1] === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (parts[1] === 'agents' && req.method === 'GET') return send(res, 200, agents);
    if (parts[1] === 'agents' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body?.name || !body?.role) return send(res, 400, { error: 'name and role are required' });
      const agent = { id: `srv-${randomUUID().slice(0, 8)}`, enabled: true, ...body };
      agents.push(agent);
      return send(res, 201, agent);
    }
    if (parts[1] === 'activity') return send(res, 200, activity.slice(-200));
    if (parts[1] === 'tasks' && !parts[2] && req.method === 'GET') return send(res, 200, [...tasks.values()]);
    if (parts[1] === 'tasks' && !parts[2] && req.method === 'POST') {
      const body = await readBody(req);
      if (!body?.title || !agents.some((a) => a.id === body.agentId)) return send(res, 400, { error: 'title and a known agentId are required' });
      const task = { id: randomUUID(), title: body.title, description: body.description ?? '', agentId: body.agentId, status: 'running', progress: 0, logs: [] };
      tasks.set(task.id, task);
      log(task, 'info', 'Accepted by mock backend');
      runTask(task);
      return send(res, 201, task);
    }
    const task = parts[2] && tasks.get(parts[2]);
    if (parts[1] === 'tasks' && !task) return send(res, 404, { error: 'task not found' });
    if (parts[1] === 'tasks' && parts[3] === 'cancel' && req.method === 'POST') {
      if (task.status === 'running' || task.status === 'queued') {
        task.status = 'cancelled';
        log(task, 'warn', 'Cancelled');
        publish(task);
      }
      return send(res, 200, task);
    }
    if (parts[1] === 'tasks' && req.method === 'GET') return send(res, 200, task);
    send(res, 404, { error: 'not found' });
  })
  .listen(PORT, () => console.log(`Mock agent backend (no AI) on http://localhost:${PORT}`));
