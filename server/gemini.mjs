// One place that talks to Gemini. Two entry points share the same parsing:
//   streamText  — stream a plain answer, calling onDelta as text arrives
//   generate    — one non-streamed call that may return function calls (tools)
const V = 'v1beta';

// Thinking: GEMINI_THINKING = high (default) | low | off | <token budget number>.
// Models that reject the setting are remembered and called without it.
const THINKING = (process.env.GEMINI_THINKING || 'high').toLowerCase();
const noThinking = new Set();

function thinkingConfig(model) {
  if (THINKING === 'off' || noThinking.has(model)) return undefined;
  if (/^-?\d+$/.test(THINKING)) return { thinkingBudget: Number(THINKING) };
  return { thinkingLevel: THINKING === 'low' ? 'low' : 'high' };
}

/** POST with retries; if the model rejects thinkingConfig, retry once without it. */
async function postModel(url, model, body, signal, onRetry) {
  const { __key: apiKey, ...payload } = body; // the key goes in a header only, never in the body
  const build = () => {
    const cfg = { ...(payload.generationConfig || {}) };
    const t = thinkingConfig(model);
    if (t) cfg.thinkingConfig = t;
    else delete cfg.thinkingConfig;
    return JSON.stringify({ ...payload, generationConfig: cfg });
  };
  const send = () =>
    fetchWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: build(), signal }, onRetry);
  let res = await send();
  if (res.status === 400 && thinkingConfig(model)) {
    const text = await res.clone().text();
    if (/thinking/i.test(text)) {
      noThinking.add(model);
      res = await send();
    }
  }
  return res;
}

function endpoint(base, model, method) {
  return `${base}/${V}/models/${encodeURIComponent(model)}:${method}`;
}

// Gemini answers 429/5xx when overloaded ("high demand"). Those are usually
// temporary, so retry a few times with growing pauses before giving up.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = (process.env.GEMINI_RETRY_DELAYS_MS || '3000,8000,20000').split(',').map(Number);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')); }, { once: true });
  });
}

async function fetchWithRetry(url, init, onRetry) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || !RETRY_STATUS.has(res.status) || attempt >= RETRY_DELAYS_MS.length) return res;
    let detail = `${res.status}`;
    try { detail = (await res.json()).error?.message ?? detail; } catch {}
    const wait = RETRY_DELAYS_MS[attempt];
    onRetry?.({ status: res.status, detail, waitMs: wait, attempt: attempt + 1 });
    await sleep(wait, init.signal);
  }
}

async function readError(res) {
  let detail = `${res.status}`;
  try {
    detail = (await res.json()).error?.message ?? detail;
  } catch {}
  return `Gemini error: ${detail}`;
}

/**
 * Stream a plain text answer. Calls onDelta(textChunk) as it arrives.
 * Returns { text, finishReason }. Throws on HTTP or block errors.
 */
export async function streamText({ base, apiKey, model, systemText, contents, maxTokens, signal, onDelta, onRetry }) {
  const res = await postModel(
    endpoint(base, model, 'streamGenerateContent') + '?alt=sse',
    model,
    {
      __key: apiKey,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    },
    signal,
    onRetry,
  );
  if (!res.ok) throw new Error(await readError(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let finishReason = null;
  let blockReason = null;

  const handle = (event) => {
    for (const line of event.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const json = JSON.parse(payload);
      if (json.error) throw new Error(`Gemini error: ${json.error.message ?? json.error.status ?? 'unknown'}`);
      blockReason = json.promptFeedback?.blockReason ?? blockReason;
      const cand = json.candidates?.[0];
      const chunk = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
      if (chunk) {
        text += chunk;
        onDelta?.(chunk);
      }
      finishReason = cand?.finishReason ?? finishReason;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    buf = buf.replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, cut));
      buf = buf.slice(cut + 2);
    }
    if (done) {
      if (buf.trim()) handle(buf);
      break;
    }
  }
  if (blockReason) throw new Error(`Gemini blocked the prompt (${blockReason})`);
  return { text, finishReason };
}

/**
 * One non-streamed call that may return function calls.
 * Returns { text, functionCalls: [{name, args}], parts (raw model turn), finishReason }.
 */
export async function generate({ base, apiKey, model, systemText, contents, tools, maxTokens, signal, onRetry }) {
  const res = await postModel(
    endpoint(base, model, 'generateContent'),
    model,
    {
      __key: apiKey,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents,
      tools,
      generationConfig: { maxOutputTokens: maxTokens },
    },
    signal,
    onRetry,
  );
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${json.promptFeedback.blockReason})`);
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const functionCalls = parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {} }));
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  // `parts` is the model turn exactly as received. It must be echoed back
  // unchanged on the next request: newer models attach a thoughtSignature to
  // functionCall parts and reject the conversation if it is missing.
  return { text, functionCalls, parts, finishReason: cand?.finishReason ?? null };
}

/** Lightweight check that a model is usable with this key. */
export async function checkModel({ base, apiKey, model }) {
  const res = await fetch(`${base}/${V}/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': apiKey } });
  if (res.ok) return { ok: true };
  return { ok: false, detail: await readError(res) };
}
