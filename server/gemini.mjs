// One place that talks to Gemini. Two entry points share the same parsing:
//   streamText  — stream a plain answer, calling onDelta as text arrives
//   generate    — one non-streamed call that may return function calls (tools)
const V = 'v1beta';

function endpoint(base, model, method) {
  return `${base}/${V}/models/${encodeURIComponent(model)}:${method}`;
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
export async function streamText({ base, apiKey, model, systemText, contents, maxTokens, signal, onDelta }) {
  const res = await fetch(endpoint(base, model, 'streamGenerateContent') + '?alt=sse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    signal,
  });
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
 * Returns { text, functionCalls: [{name, args}], finishReason }.
 */
export async function generate({ base, apiKey, model, systemText, contents, tools, maxTokens, signal }) {
  const res = await fetch(endpoint(base, model, 'generateContent'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents,
      tools,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    signal,
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${json.promptFeedback.blockReason})`);
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const functionCalls = parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {} }));
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  return { text, functionCalls, finishReason: cand?.finishReason ?? null };
}

/** Lightweight check that a model is usable with this key. */
export async function checkModel({ base, apiKey, model }) {
  const res = await fetch(`${base}/${V}/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': apiKey } });
  if (res.ok) return { ok: true };
  return { ok: false, detail: await readError(res) };
}
