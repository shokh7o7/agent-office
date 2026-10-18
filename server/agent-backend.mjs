// Agent Office backend powered by Google Gemini (AI Studio API key).
// Implements the HTTP contract in src/api/adapter.ts. No npm dependencies;
// needs Node 18+ (global fetch).
//
// Configuration (environment variables):
//   GEMINI_API_KEY      required. Never put this in frontend code.
//   GEMINI_MODEL        model id from AI Studio (default: gemini-flash-latest, an alias
//                       Google keeps pointing at the current Flash model)
//   GEMINI_MAX_TOKENS   max output tokens per task, thinking included (default: 8192)
//   PORT / HOST         listen address (default: 127.0.0.1:8787, i.e. behind nginx)
//   ALLOWED_ORIGIN      CORS origin, e.g. http://18.225.82.97 (default: same-origin only)
//   MAX_CONCURRENCY     tasks sent to Gemini at once (default: 2, protects your quota)
//   DATA_FILE           where agents/tasks are saved (default: ./data/state.json)
//   GEMINI_BASE_URL     override for testing (default: Google's endpoint)
//   STATIC_DIR          if set, also serves the built frontend from this folder
//   RUNNER_TOKEN        if set, PC runners must present it to connect (recommended)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { streamText, generate, checkModel } from './gemini.mjs';
import { RunnerHub, runWithTools } from './runner/session.mjs';

const env = process.env;
const API_KEY = env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set. Put it in /etc/agent-office.env (see README).');
  process.exit(1);
}
const MODEL = env.GEMINI_MODEL || 'gemini-flash-latest';
const MAX_TOKENS = Number(env.GEMINI_MAX_TOKENS || 8192);
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || '127.0.0.1';
const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '';
const MAX_CONCURRENCY = Math.max(1, Number(env.MAX_CONCURRENCY || 2));
const DATA_FILE = path.resolve(env.DATA_FILE || './data/state.json');
const STATIC_DIR = env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : '';
const GEMINI_BASE = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const RUNNER_TOKEN = env.RUNNER_TOKEN || '';
const hub = new RunnerHub();
const pendingApprovals = new Map(); // approvalId -> { resolve, taskId }

/** Log a Gemini overload retry on the task so the user sees it is waiting, not stuck. */
function retryLogger(task) {
  return ({ status, waitMs, attempt }) => {
    log(task, 'warn', `Gemini band (${status}), ${Math.round(waitMs / 1000)} s dan keyin qayta urinadi (${attempt}-urinish)`);
    publish(task);
  };
}

const ROLE_PROMPTS = {
  Developer: 'You are a senior software developer. Give working code and brief, precise explanations.',
  Researcher: 'You are a careful researcher. Structure findings clearly and say when something is uncertain.',
  Designer: 'You are a product designer. Give concrete, actionable design recommendations.',
  Writer: 'You are a professional writer. Produce clear, polished text ready to use.',
  Tester: 'You are a QA engineer. Produce test cases, edge cases and clear reproduction steps.',
  Analyst: 'You are a data analyst. Show your reasoning, assumptions and the key numbers.',
  Manager: 'You are a project manager. Break work into steps with owners, risks and next actions.',
};

function systemFor(agent, withTools) {
  const base = `${ROLE_PROMPTS[agent?.role] ?? ''} Your name is ${agent?.name ?? 'Agent'}.`;
  if (!withTools) return base;
  return (
    base +
    ' You can act on the user\'s PC through the provided tools, but only inside their chosen work folder. ' +
    'Work in small steps: inspect files before changing them, make one change at a time, and run tests when relevant. ' +
    'Deletions move files to the Recycle Bin. When the task is done, reply with a short summary of what you changed.'
  );
}

// ---------------------------------------------------------------- state
const DEFAULT_AGENTS = [
  { id: 'gm-dilnoza', name: 'Dilnoza', role: 'Researcher', enabled: true },
  { id: 'gm-jasur', name: 'Jasur', role: 'Developer', enabled: true },
  { id: 'gm-malika', name: 'Malika', role: 'Writer', enabled: true },
  { id: 'gm-sardor', name: 'Sardor', role: 'Analyst', enabled: true },
];

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { agents: s.agents ?? DEFAULT_AGENTS, tasks: s.tasks ?? [], activity: s.activity ?? [] };
  } catch {
    return { agents: DEFAULT_AGENTS.map((a) => ({ ...a })), tasks: [], activity: [] };
  }
}
const state = load();
// Agents follow GEMINI_MODEL unless one was set explicitly for that agent
// (modelOverride). Older state files stored the default as `model`; drop it.
for (const a of state.agents) Object.assign(a, { provider: 'google', model: a.modelOverride || MODEL });
// Anything left running by a previous process can't be resumed.
for (const t of state.tasks) if (t.status === 'running' || t.status === 'queued') Object.assign(t, { status: 'failed', output: 'Server restarted before this task finished. Assign it again.' });
const tasks = new Map(state.tasks.map((t) => [t.id, t]));

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const recent = [...tasks.values()].slice(-500);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ agents: state.agents, tasks: recent, activity: state.activity.slice(-500) }));
  }, 500);
}

const streams = new Set();
const lastPublish = new Map();
function publish(task, force = true) {
  const now = Date.now();
  if (!force && now - (lastPublish.get(task.id) ?? 0) < 500) return;
  lastPublish.set(task.id, now);
  const data = `event: task\ndata: ${JSON.stringify(task)}\n\n`;
  for (const res of streams) res.write(data);
  save();
}
function log(task, level, msg) {
  const entry = { t: Date.now(), level, msg };
  task.logs.push(entry);
  state.activity.push({ ...entry, agentId: task.agentId, taskId: task.id });
  if (state.activity.length > 1000) state.activity.splice(0, 500);
}

// ---------------------------------------------------------------- Gemini worker
const queue = [];
const running = new Map(); // taskId -> AbortController

function pump() {
  while (running.size < MAX_CONCURRENCY && queue.length) {
    const task = queue.shift();
    if (task.status !== 'queued') continue;
    void runTask(task);
  }
}

async function runTask(task) {
  const agent = state.agents.find((a) => a.id === task.agentId);
  const ctrl = new AbortController();
  running.set(task.id, ctrl);
  task.status = 'running';
  task.progress = 0.05;
  task.output = '';
  const model = agent?.model || MODEL;
  const onDevice = task.deviceId && hub.isOnline(task.deviceId);
  log(task, 'info', onDevice ? `Working on PC “${deviceName(task.deviceId)}” via ${model}` : `Sent to ${model}`);
  publish(task);

  try {
    if (task.deviceId && !onDevice) throw new Error('The selected PC runner is offline');

    if (onDevice) {
      // Tool mode: let the model act on the PC through the runner.
      const summary = await runWithTools({
        task,
        agent,
        systemText: systemFor(agent, true),
        deviceId: task.deviceId,
        hub,
        deps: {
          callGemini: (contents, tools, systemText) =>
            generate({ base: GEMINI_BASE, apiKey: API_KEY, model, systemText, contents, tools, maxTokens: MAX_TOKENS, signal: ctrl.signal, onRetry: retryLogger(task) }),
          onLog: (level, msg) => {
            log(task, level, msg);
            publish(task, false);
          },
          onProgress: (p) => {
            task.progress = p;
            publish(task, false);
          },
          requestApproval: (call) => askApproval(task, call),
          isCancelled: () => task.status !== 'running',
        },
      });
      task.output = summary;
    } else {
      // Plain mode: stream a text answer.
      const { finishReason } = await streamText({
        base: GEMINI_BASE,
        apiKey: API_KEY,
        model,
        systemText: systemFor(agent, false),
        contents: [{ role: 'user', parts: [{ text: task.description ? `${task.title}\n\n${task.description}` : task.title }] }],
        maxTokens: MAX_TOKENS,
        signal: ctrl.signal,
        onRetry: retryLogger(task),
        onDelta: (chunk) => {
          task.output += chunk;
          task.progress = Math.min(0.95, 0.1 + 0.85 * (1 - Math.exp(-task.output.length / 2500)));
          publish(task, false);
        },
      });
      if (task.status !== 'running') return;
      if (!task.output.trim()) throw new Error(`Gemini returned no text (finish reason: ${finishReason ?? 'unknown'})`);
      if (finishReason === 'MAX_TOKENS') log(task, 'warn', 'Answer was cut at the token limit');
    }
    if (task.status !== 'running') return; // cancelled meanwhile
    task.status = 'completed';
    task.progress = 1;
    log(task, 'success', 'Finished');
  } catch (e) {
    if (task.status === 'cancelled') return;
    task.status = 'failed';
    task.output = (task.output ? `${task.output}\n\n` : '') + `[error] ${e.message}`;
    log(task, 'error', e.message);
  } finally {
    running.delete(task.id);
    // Drop any approval still waiting for this task.
    for (const [id, a] of pendingApprovals) if (a.taskId === task.id) { a.resolve(false); pendingApprovals.delete(id); }
    publish(task);
    pump();
  }
}

function deviceName(deviceId) {
  return hub.list().find((d) => d.id === deviceId)?.name ?? deviceId;
}

/** Ask the browser to approve a risky tool call; resolves true/false. */
function askApproval(task, call) {
  return new Promise((resolve) => {
    const approvalId = `ap_${randomUUID().slice(0, 8)}`;
    pendingApprovals.set(approvalId, { resolve, taskId: task.id });
    task.pendingApproval = { approvalId, label: call.label, reason: call.reason, name: call.name };
    publish(task);
    log(task, 'warn', `Waiting for your approval: ${call.label}`);
  });
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
function serveStatic(pathname, res) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = path.join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html'); // SPA fallback
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
const ROLES = Object.keys(ROLE_PROMPTS);

const server = http.createServer(async (req, res) => {
  if (ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return STATIC_DIR && req.method === 'GET' ? serveStatic(url.pathname, res) : send(res, 404, { error: 'not found' });

  try {
    if (parts[1] === 'health') return send(res, 200, { ok: true, model: MODEL, running: running.size, queued: queue.length });

    // ---- PC runner endpoints ----
    // Runner opens an SSE stream; tool calls are pushed to it as events.
    if (parts[1] === 'runner' && parts[2] === 'connect') {
      const deviceId = url.searchParams.get('deviceId');
      const token = url.searchParams.get('token') || req.headers['x-runner-token'];
      const name = url.searchParams.get('name') || '';
      if (RUNNER_TOKEN && token !== RUNNER_TOKEN) return send(res, 401, { error: 'bad runner token' });
      if (!deviceId) return send(res, 400, { error: 'deviceId required' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      const dispose = hub.connect(deviceId, name, res);
      req.on('close', () => { clearInterval(ping); dispose(); });
      return;
    }
    // Runner reports its work folder and status.
    if (parts[1] === 'runner' && parts[2] === 'info' && req.method === 'POST') {
      const b = await readBody(req);
      if (RUNNER_TOKEN && (b?.token !== RUNNER_TOKEN)) return send(res, 401, { error: 'bad runner token' });
      hub.setInfo(b?.deviceId, { workDir: b?.workDir });
      return send(res, 200, { ok: true });
    }
    // Runner posts the result of a tool call back.
    if (parts[1] === 'runner' && parts[2] === 'result' && req.method === 'POST') {
      const b = await readBody(req);
      if (RUNNER_TOKEN && (b?.token !== RUNNER_TOKEN)) return send(res, 401, { error: 'bad runner token' });
      const ok = hub.resolveCall(b?.deviceId, b?.callId, b?.result);
      return send(res, ok ? 200 : 404, { ok });
    }
    // Browser lists connected PCs.
    if (parts[1] === 'devices' && req.method === 'GET') return send(res, 200, hub.list());
    // Browser approves or denies a risky tool call.
    if (parts[1] === 'approvals' && parts[3] && req.method === 'POST') {
      const approval = pendingApprovals.get(parts[2]);
      if (!approval) return send(res, 404, { error: 'approval not found or already answered' });
      pendingApprovals.delete(parts[2]);
      const task = tasks.get(approval.taskId);
      if (task) { delete task.pendingApproval; publish(task); }
      approval.resolve(parts[3] === 'approve');
      return send(res, 200, { ok: true });
    }

    if (parts[1] === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      streams.add(res);
      req.on('close', () => {
        clearInterval(ping);
        streams.delete(res);
      });
      return;
    }

    if (parts[1] === 'agents' && req.method === 'GET') return send(res, 200, state.agents);
    if (parts[1] === 'agents' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b?.name || !ROLES.includes(b.role)) return send(res, 400, { error: `name and role (${ROLES.join(', ')}) are required` });
      const override = b.model ? String(b.model).slice(0, 80) : undefined;
      const agent = { id: `gm-${randomUUID().slice(0, 8)}`, name: String(b.name).slice(0, 40), role: b.role, provider: 'google', model: override || MODEL, modelOverride: override, enabled: true };
      state.agents.push(agent);
      save();
      return send(res, 201, agent);
    }

    if (parts[1] === 'activity') return send(res, 200, state.activity.slice(-200));

    if (parts[1] === 'tasks' && !parts[2]) {
      if (req.method === 'GET') return send(res, 200, [...tasks.values()]);
      if (req.method === 'POST') {
        const b = await readBody(req);
        const agent = state.agents.find((a) => a.id === b?.agentId);
        if (!b?.title?.trim() || !agent) return send(res, 400, { error: 'title and a known agentId are required' });
        const task = {
          id: randomUUID(),
          title: String(b.title).slice(0, 200),
          description: String(b.description ?? '').slice(0, 20_000),
          agentId: agent.id,
          deviceId: b.deviceId && hub.isOnline(b.deviceId) ? String(b.deviceId) : undefined,
          status: 'queued',
          progress: 0,
          logs: [],
        };
        tasks.set(task.id, task);
        log(task, 'info', 'Accepted');
        queue.push(task);
        publish(task);
        pump();
        return send(res, 201, task);
      }
    }

    const task = parts[2] && tasks.get(parts[2]);
    if (parts[1] === 'tasks' && !task) return send(res, 404, { error: 'task not found' });
    if (parts[1] === 'tasks' && parts[3] === 'cancel' && req.method === 'POST') {
      if (task.status === 'running' || task.status === 'queued') {
        task.status = 'cancelled';
        running.get(task.id)?.abort();
        log(task, 'warn', 'Cancelled');
        publish(task);
      }
      return send(res, 200, task);
    }
    if (parts[1] === 'tasks' && req.method === 'GET') return send(res, 200, task);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Office backend on http://${HOST}:${PORT} using ${MODEL}`);
  // Fail loudly at startup if the configured model can't be used with this key.
  checkModel({ base: GEMINI_BASE, apiKey: API_KEY, model: MODEL })
    .then((r) => console.log(r.ok ? `Model check OK: ${MODEL}` : `Model check FAILED for ${MODEL}: ${r.detail}`))
    .catch((e) => console.error(`Model check could not reach Gemini: ${e.message}`));

});
