// Bridges one task to a connected PC runner. Holds the model↔tool loop:
// the model asks to call a tool, we classify it, auto-run safe ones or wait
// for the user's approval, forward the call to the PC, feed the result back
// to the model, and repeat until the model gives a final text answer.
import { classify, declarationsFor, describe } from './tools.mjs';

// Cap model turns per task so a loop can't run forever. Deep work needs room.
const MAX_STEPS = Math.max(5, Number(process.env.MAX_TOOL_STEPS || 60));

/**
 * A registry of PC runners connected over SSE, keyed by device id. Each runner
 * has a writable SSE response and a map of pending tool calls awaiting results.
 */
export class RunnerHub {
  constructor() {
    this.runners = new Map(); // deviceId -> { res, name, workDir, pending: Map, lastSeen }
  }

  connect(deviceId, name, res) {
    const existing = this.runners.get(deviceId);
    if (existing) existing.res.end(); // one connection per device
    const runner = { res, name: name || deviceId, workDir: null, capabilities: [], version: '', pending: new Map(), lastSeen: Date.now() };
    this.runners.set(deviceId, runner);
    this.sendTo(deviceId, 'hello', { ok: true });
    return () => {
      if (this.runners.get(deviceId) === runner) this.runners.delete(deviceId);
      for (const { reject } of runner.pending.values()) reject(new Error('Runner disconnected'));
    };
  }

  setInfo(deviceId, info) {
    const r = this.runners.get(deviceId);
    if (r) {
      r.workDir = info.workDir ?? r.workDir;
      if (Array.isArray(info.capabilities)) r.capabilities = info.capabilities.filter((c) => typeof c === 'string').slice(0, 50);
      if (typeof info.version === 'string') r.version = info.version.slice(0, 40);
      r.lastSeen = Date.now();
    }
  }

  list() {
    return [...this.runners.entries()].map(([id, r]) => ({ id, name: r.name, workDir: r.workDir, version: r.version, capabilities: r.capabilities, online: true }));
  }

  capabilities(deviceId) {
    return this.runners.get(deviceId)?.capabilities ?? [];
  }

  isOnline(deviceId) {
    return this.runners.has(deviceId);
  }

  sendTo(deviceId, event, data) {
    const r = this.runners.get(deviceId);
    if (!r) return false;
    r.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }

  /** Called when the PC posts a tool result back. */
  resolveCall(deviceId, callId, result) {
    const r = this.runners.get(deviceId);
    const pending = r?.pending.get(callId);
    if (!pending) return false;
    r.pending.delete(callId);
    pending.resolve(result);
    return true;
  }

  /** Ask the PC to execute one tool call; resolves with its result. */
  execute(deviceId, call, timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const r = this.runners.get(deviceId);
      if (!r) return reject(new Error('Runner is offline'));
      const timer = setTimeout(() => {
        r.pending.delete(call.callId);
        reject(new Error('The PC did not respond in time'));
      }, timeoutMs);
      r.pending.set(call.callId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.sendTo(deviceId, 'tool', call);
    });
  }
}

let callSeq = 0;
const nextCallId = () => `call_${Date.now().toString(36)}_${(callSeq = (callSeq + 1) % 1e6).toString(36)}`;

/**
 * Run the model↔tool loop for a task bound to a device.
 * `deps` provides: callGemini(contents, tools) -> { text, functionCalls, finishReason },
 * onLog(level,msg), onProgress(0..1), requestApproval(call) -> Promise<boolean>,
 * isCancelled() -> boolean.
 */
export async function runWithTools({ task, agent, systemText, deviceId, hub, deps }) {
  const contents = [{ role: 'user', parts: [{ text: task.description ? `${task.title}\n\n${task.description}` : task.title }] }];
  const tools = [{ functionDeclarations: declarationsFor(hub.capabilities(deviceId)) }];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (deps.isCancelled()) throw new Error('Cancelled');
    if (!hub.isOnline(deviceId)) throw new Error('The PC runner went offline');

    const reply = await deps.callGemini(contents, tools, systemText);
    const calls = reply.functionCalls ?? [];

    if (!calls.length) {
      const text = (reply.text ?? '').trim();
      if (!text) throw new Error(`Gemini returned no text (finish reason: ${reply.finishReason ?? 'unknown'})`);
      return text; // final answer
    }

    // Echo the model's turn back exactly as received (keeps thoughtSignature,
    // which Gemini requires for tool use). Fall back to rebuilt parts only if
    // the raw turn is unavailable (e.g. older test doubles).
    contents.push({
      role: 'model',
      parts: reply.parts?.length ? reply.parts : calls.map((c) => ({ functionCall: { name: c.name, args: c.args ?? {} } })),
    });

    const responseParts = [];
    for (const call of calls) {
      if (deps.isCancelled()) throw new Error('Cancelled');
      const { risky, reason } = classify(call.name, call.args);
      const label = describe(call.name, call.args);

      if (risky) {
        deps.onLog('info', `Needs approval — ${label}${reason ? ` (${reason})` : ''}`);
        const approved = await deps.requestApproval({ callId: nextCallId(), name: call.name, args: call.args ?? {}, label, reason });
        if (!approved) {
          deps.onLog('warn', `Denied — ${label}`);
          responseParts.push(fnResult(call.name, { error: 'The user denied this action.' }));
          continue;
        }
        deps.onLog('info', `Approved — ${label}`);
      } else {
        deps.onLog('info', label);
      }

      try {
        const result = await hub.execute(deviceId, {
          callId: nextCallId(),
          name: call.name,
          args: call.args ?? {},
          // Display-only context for the PC app ("Jasur is working on …"). Runners may ignore it.
          agentName: agent?.name,
          taskTitle: task.title,
          agent: agent ? { id: agent.id, name: agent.name, role: agent.role, appearance: agent.appearance } : undefined,
        });
        if (result?.error) deps.onLog('warn', `${call.name}: ${result.error}`);
        responseParts.push(fnResult(call.name, result ?? {}));
      } catch (e) {
        deps.onLog('error', `${call.name} failed: ${e.message}`);
        responseParts.push(fnResult(call.name, { error: e.message }));
      }
      deps.onProgress(Math.min(0.9, 0.1 + (step + 1) / MAX_STEPS));
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  throw new Error(`Stopped after ${MAX_STEPS} tool steps without finishing`);
}

function fnResult(name, obj) {
  return { functionResponse: { name, response: obj } };
}
