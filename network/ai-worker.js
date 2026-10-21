/* Rootwork's fallback model, in a worker of its own.

   It only runs when the browser has no built-in model. A worker has no page,
   no localStorage and no sync keys, so the most it is ever handed is the text
   of one doc. Its code is fetched at a pinned version and checked against a
   fixed SHA-384 before a line of it runs; a changed file is refused. The model
   weights are data, cached by the browser after the first download. */

const LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';
const LIB_SHA384 = 'sha384-rfElDdXnNkSgbLTTGiKHTrsetCVAYzzLZBD96/rZdD9XYvryEyShqz3ph8j+x7HH';
const MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';   // about 0.9 GB, downloaded once

let engine = null;
let loading = null;

async function loadLib() {
  // fetch() checks the integrity itself and rejects on any mismatch
  const res = await fetch(LIB, { integrity: LIB_SHA384, cache: 'force-cache', credentials: 'omit' });
  if (!res.ok) throw new Error('Could not fetch the model runtime (' + res.status + ')');
  const src = await res.text();
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}

function load(id) {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  loading = (async () => {
    if (!self.navigator.gpu) throw new Error('This browser has no WebGPU, so the model cannot run here.');
    const lib = await loadLib();
    const e = new lib.MLCEngine({
      initProgressCallback: (r) => postMessage({ id, type: 'progress', progress: r.progress || 0, text: r.text || '' })
    });
    await e.reload(MODEL);
    engine = e;
    return e;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  try {
    if (m.op === 'load') {
      await load(m.id);
      postMessage({ id: m.id, type: 'done', text: '' });
      return;
    }
    if (m.op === 'chat') {
      const e = await load(m.id);
      const r = await e.chat.completions.create({
        messages: m.messages,
        temperature: 0.2,
        max_tokens: m.maxTokens || 900,
        response_format: m.schema ? { type: 'json_object', schema: JSON.stringify(m.schema) } : undefined
      });
      postMessage({ id: m.id, type: 'done', text: (r.choices[0] && r.choices[0].message.content) || '' });
    }
  } catch (err) {
    postMessage({ id: m.id, type: 'error', text: String((err && err.message) || err) });
  }
};
