#!/usr/bin/env node
// Agent Office PC runner.
// Connects to the server over an outbound SSE stream (no open ports needed),
// receives tool calls, runs them STRICTLY inside one work folder, and posts
// results back. Deletes go to the Recycle Bin, never a permanent erase.
//
// Usage (PowerShell or CMD):
//   node runner.mjs
// Configuration comes from runner.config.json beside this file, or env vars:
//   SERVER_URL    e.g. https://office.snapeld.com   (required)
//   RUNNER_TOKEN  must match the server's RUNNER_TOKEN (recommended)
//   WORK_DIR      folder the agent may touch (required)
//   DEVICE_NAME   label shown in the app (default: hostname)
//   BASIC_AUTH    "user:pass" if the site is behind basic auth
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------- config
function loadConfig() {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'runner.config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const get = (k, d) => process.env[k] ?? cfg[k] ?? d;
  const serverUrl = (get('SERVER_URL', '') || '').replace(/\/$/, '');
  const workDir = get('WORK_DIR', '');
  return {
    serverUrl,
    token: get('RUNNER_TOKEN', ''),
    workDir: workDir ? path.resolve(workDir) : '',
    deviceName: get('DEVICE_NAME', os.hostname()),
    basicAuth: get('BASIC_AUTH', ''),
    deviceId: get('DEVICE_ID', ''),
  };
}
const cfg = loadConfig();

function fail(msg) {
  console.error(`\n[runner] ${msg}\n`);
  process.exit(1);
}
if (!cfg.serverUrl) fail('SERVER_URL is not set. Edit runner.config.json.');
if (!cfg.workDir) fail('WORK_DIR is not set. Edit runner.config.json.');
if (!fs.existsSync(cfg.workDir) || !fs.statSync(cfg.workDir).isDirectory()) fail(`WORK_DIR does not exist: ${cfg.workDir}`);

// A stable device id so the same PC keeps its identity across restarts.
const idFile = path.join(cfg.workDir, '.agent-office-device-id');
if (!cfg.deviceId) {
  try {
    cfg.deviceId = fs.readFileSync(idFile, 'utf8').trim();
  } catch {}
  if (!cfg.deviceId) {
    cfg.deviceId = `pc_${randomUUID().slice(0, 12)}`;
    try {
      fs.writeFileSync(idFile, cfg.deviceId);
    } catch {}
  }
}

const authHeader = cfg.basicAuth ? { Authorization: 'Basic ' + Buffer.from(cfg.basicAuth).toString('base64') } : {};

// ---------------------------------------------------------------- safety
const MAX_READ = 2 * 1024 * 1024; // 2 MB per file read
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', '.venv', 'venv', '__pycache__', '.vs', '.idea', '.next', '.trash']);
const CAPABILITIES = ['list_dir', 'list_tree', 'search_files', 'read_file', 'read_file_lines', 'write_file', 'edit_file', 'delete_file', 'run_command'];
const CMD_TIMEOUT = 5 * 60 * 1000;

/** Resolve a user-supplied relative path and refuse anything outside workDir. */
function safePath(rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('Invalid path');
  // Treat both slash kinds as separators on every OS so the guard is identical.
  rel = rel.replace(/\\/g, '/');
  if (path.isAbsolute(rel)) throw new Error('Path must be relative to the work folder');
  const full = path.resolve(cfg.workDir, rel);
  const root = path.resolve(cfg.workDir);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Path is outside the work folder');
  return full;
}

// ---------------------------------------------------------------- tools
const tools = {
  async list_dir({ path: rel = '.' }) {
    const dir = safePath(rel);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return {
      path: rel,
      entries: entries.slice(0, 500).map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
    };
  },

  async read_file({ path: rel, start_line, end_line }) {
    const file = safePath(rel);
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) throw new Error('That path is a folder, not a file');
    if (stat.size > MAX_READ) throw new Error(`File is too large to read (${(stat.size / 1e6).toFixed(1)} MB, limit 2 MB)`);
    const content = await fsp.readFile(file, 'utf8');
    if (!start_line && !end_line) return { path: rel, content };
    const lines = content.split(/\r?\n/);
    const from = Math.max(1, Number(start_line) || 1);
    const to = Math.min(lines.length, Number(end_line) || lines.length);
    const numbered = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n');
    return { path: rel, start_line: from, end_line: to, total_lines: lines.length, content: numbered };
  },

  async list_tree({ path: rel = '.', depth = 4 }) {
    const root = safePath(rel);
    const maxDepth = Math.min(6, Math.max(1, Number(depth) || 4));
    const lines = [];
    let count = 0;
    async function walk(dir, prefix, level) {
      if (level > maxDepth || count >= 2000) return;
      let entries = await fsp.readdir(dir, { withFileTypes: true });
      entries = entries.filter((e) => !SKIP_DIRS.has(e.name) && !e.isSymbolicLink()).sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      for (const e of entries) {
        if (count++ >= 2000) { lines.push(`${prefix}… (truncated)`); return; }
        lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
        if (e.isDirectory()) await walk(path.join(dir, e.name), prefix + '  ', level + 1);
      }
    }
    await walk(root, '', 1);
    return { path: rel, tree: lines.join('\n'), entries: count };
  },

  async search_files({ query, path: rel = '.', glob }) {
    if (!query) throw new Error('query is required');
    const root = safePath(rel);
    const needle = String(query).toLowerCase();
    const globRe = glob ? new RegExp('^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
    const matches = [];
    async function walk(dir) {
      if (matches.length >= 200) return;
      for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue; // never follow links out of the folder
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(full); continue; }
        if (globRe && !globRe.test(e.name)) continue;
        const st = await fsp.stat(full);
        if (st.size > 1024 * 1024) continue;
        const text = await fsp.readFile(full, 'utf8').catch(() => '');
        if (text.includes('\0')) continue; // binary
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < 200; i++)
          if (lines[i].toLowerCase().includes(needle))
            matches.push({ file: path.relative(cfg.workDir, full).replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 300) });
      }
    }
    await walk(root);
    return { query, matches, truncated: matches.length >= 200 };
  },

  async edit_file({ path: rel, old_text, new_text }) {
    const file = safePath(rel);
    if (typeof old_text !== 'string' || !old_text) throw new Error('old_text is required');
    const content = await fsp.readFile(file, 'utf8');
    const first = content.indexOf(old_text);
    if (first < 0) throw new Error('old_text was not found in the file (read the file again and copy the exact text)');
    if (content.indexOf(old_text, first + 1) >= 0) throw new Error('old_text appears more than once; include more surrounding lines to make it unique');
    const next = content.slice(0, first) + String(new_text ?? '') + content.slice(first + old_text.length);
    await fsp.writeFile(file, next, 'utf8');
    return { path: rel, ok: true, replaced: 1 };
  },

  async write_file({ path: rel, content }) {
    const file = safePath(rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, String(content ?? ''), 'utf8');
    return { path: rel, bytes: Buffer.byteLength(String(content ?? '')), ok: true };
  },

  async delete_file({ path: rel }) {
    const target = safePath(rel);
    if (target === path.resolve(cfg.workDir)) throw new Error('Refusing to delete the work folder itself');
    await recycle(target);
    return { path: rel, recycled: true };
  },

  run_command({ command }) {
    return runCommand(String(command ?? ''));
  },
};

/** Move a path to the Windows Recycle Bin via PowerShell. Falls back to rename. */
async function recycle(fullPath) {
  if (process.platform === 'win32') {
    const ps =
      `Add-Type -AssemblyName Microsoft.VisualBasic;` +
      (fs.statSync(fullPath).isDirectory()
        ? `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${fullPath.replace(/'/g, "''")}','OnlyErrorDialogs','SendToRecycleBin')`
        : `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${fullPath.replace(/'/g, "''")}','OnlyErrorDialogs','SendToRecycleBin')`);
    await new Promise((resolve, reject) => {
      const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `recycle failed (${code})`))));
      p.on('error', reject);
    });
  } else {
    // Non-Windows fallback for testing: move into a .trash folder in workDir.
    const trash = path.join(cfg.workDir, '.trash');
    await fsp.mkdir(trash, { recursive: true });
    await fsp.rename(fullPath, path.join(trash, `${Date.now()}-${path.basename(fullPath)}`));
  }
}

function runCommand(command) {
  return new Promise((resolve) => {
    if (!command.trim()) return resolve({ error: 'Empty command' });
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-lc', command];
    const child = spawn(shell, args, { cwd: cfg.workDir, windowsHide: true });
    let out = '';
    let err = '';
    const cap = (s, chunk) => (s.length < 100_000 ? s + chunk : s);
    child.stdout.on('data', (d) => (out = cap(out, d.toString())));
    child.stderr.on('data', (d) => (err = cap(err, d.toString())));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: null, stdout: out, stderr: err + '\n[runner] command timed out', timedOut: true });
    }, CMD_TIMEOUT);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout: out.slice(-20_000), stderr: err.slice(-20_000) });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ error: e.message });
    });
  });
}

async function handleTool(call) {
  const fn = tools[call.name];
  if (!fn) return { error: `Unknown tool: ${call.name}` };
  try {
    return await fn(call.args ?? {});
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------- transport
async function post(route, body) {
  const res = await fetch(`${cfg.serverUrl}/api/runner/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ ...body, deviceId: cfg.deviceId, token: cfg.token }),
  });
  if (!res.ok) throw new Error(`${route} -> ${res.status}`);
  return res.json().catch(() => ({}));
}

async function sendResult(callId, result) {
  try {
    await post('result', { callId, result });
  } catch (e) {
    console.error(`[runner] couldn't send result: ${e.message}`);
  }
}

/** Connect the SSE stream and process tool events until it drops. */
async function connectOnce() {
  const qs = new URLSearchParams({ deviceId: cfg.deviceId, name: cfg.deviceName, token: cfg.token });
  const res = await fetch(`${cfg.serverUrl}/api/runner/connect?${qs}`, { headers: { Accept: 'text/event-stream', ...authHeader } });
  if (res.status === 401) fail('Server rejected the runner token. Check RUNNER_TOKEN.');
  if (!res.ok) throw new Error(`connect -> ${res.status}`);
  console.log(`[runner] connected as "${cfg.deviceName}" (${cfg.deviceId})`);
  console.log(`[runner] work folder: ${cfg.workDir}`);
  await post('info', { workDir: cfg.workDir, capabilities: CAPABILITIES, version: 'node-runner-0.2' }).catch(() => {});

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream closed');
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'tool' && data) {
        const call = JSON.parse(data);
        console.log(`[runner] ${call.name} ${JSON.stringify(call.args ?? {})}`);
        handleTool(call).then((result) => sendResult(call.callId, result));
      }
    }
  }
}

async function main() {
  console.log(`[runner] Agent Office runner starting`);
  console.log(`[runner] server: ${cfg.serverUrl}`);
  for (;;) {
    try {
      await connectOnce();
    } catch (e) {
      console.error(`[runner] disconnected: ${e.message}. Retrying in 5s…`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main();
