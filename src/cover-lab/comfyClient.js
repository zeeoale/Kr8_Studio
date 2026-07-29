import { normalizeHttpEndpoint } from './schema.js';
import { COVER_WORKFLOW_NODE_MAP } from './workflow.js';

export async function queueComfyWorkflow(options = {}) {
  const endpoint = normalizeHttpEndpoint(options.endpoint || 'http://127.0.0.1:8188', 'ComfyUI endpoint');
  const payload = await comfyJson(`${endpoint}/prompt`, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || 15_000,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: options.workflow,
        client_id: String(options.clientId || 'kr8-cover-lab')
      })
    }
  });
  const promptId = String(payload?.prompt_id || '').trim();
  if (!promptId) throw new Error('ComfyUI accepted no prompt_id.');
  return promptId;
}

export async function waitForComfyWorkflow(options = {}) {
  const endpoint = normalizeHttpEndpoint(options.endpoint || 'http://127.0.0.1:8188', 'ComfyUI endpoint');
  const promptId = String(options.promptId || '').trim();
  if (!promptId) throw new Error('ComfyUI prompt_id is required.');
  const timeoutMs = Number(options.timeoutMs || 600_000);
  const pollMs = Number(options.pollMs || 850);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await comfyJson(`${endpoint}/history/${encodeURIComponent(promptId)}`, {
      fetchImpl: options.fetchImpl,
      timeoutMs: Math.min(15_000, timeoutMs)
    });
    const job = history?.[promptId] || history;
    if (job?.status?.status_str === 'error' || hasExecutionError(job?.status?.messages)) {
      throw new Error(readExecutionError(job?.status?.messages) || 'ComfyUI reported a failed Cover Lab job.');
    }
    if (job?.outputs && Object.keys(job.outputs).length) {
      return {
        promptId,
        results: extractComfyResults(job.outputs, options.manifest || {})
      };
    }
    await delay(pollMs, options.signal);
  }
  throw new Error('ComfyUI Cover Lab job timed out before completion.');
}

export async function generateComfyCover(options = {}) {
  const promptId = await queueComfyWorkflow(options);
  return waitForComfyWorkflow({ ...options, promptId });
}

export function extractComfyResults(outputs = {}, manifest = {}) {
  const resultGroups = [
    [COVER_WORKFLOW_NODE_MAP.nativeOutput, 'native'],
    [COVER_WORKFLOW_NODE_MAP.upscaledOutput, 'upscaled']
  ];
  const results = [];
  for (const [nodeId, variant] of resultGroups) {
    for (const image of outputs?.[nodeId]?.images || []) {
      if (!image?.filename) continue;
      results.push({
        variant,
        filename: String(image.filename),
        subfolder: String(image.subfolder || ''),
        type: String(image.type || 'output'),
        seed: Number(manifest.seed || 0),
        width: Number(image.width || manifest.width || 0),
        height: Number(image.height || manifest.height || 0)
      });
    }
  }
  if (!results.length) throw new Error('ComfyUI completed the job but returned no Cover Lab images.');
  return results;
}

export async function fetchComfyImage(options = {}) {
  const endpoint = normalizeHttpEndpoint(options.endpoint || 'http://127.0.0.1:8188', 'ComfyUI endpoint');
  const result = options.result || {};
  const url = new URL(`${endpoint}/view`);
  url.searchParams.set('filename', String(result.filename || ''));
  url.searchParams.set('subfolder', String(result.subfolder || ''));
  url.searchParams.set('type', String(result.type || 'output'));
  if (!result.filename) throw new Error('ComfyUI result filename is required.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`ComfyUI image download failed with HTTP ${response.status}.`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length) throw new Error('ComfyUI returned an empty image.');
    return {
      data,
      contentType: String(response.headers.get('content-type') || 'application/octet-stream')
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('ComfyUI image download timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function comfyJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
  try {
    let response;
    try {
      response = await (options.fetchImpl || globalThis.fetch)(url, {
        ...(options.init || {}),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('ComfyUI request timed out.');
      throw new Error(`ComfyUI is not reachable: ${error.message || error}`);
    }
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('ComfyUI returned malformed JSON.');
    }
    if (!response.ok) {
      throw new Error(String(payload?.error?.message || payload?.error || payload?.message || `ComfyUI request failed with HTTP ${response.status}.`));
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function hasExecutionError(messages) {
  return Array.isArray(messages) && messages.some((message) => String(message?.[0] || '').includes('execution_error'));
}

function readExecutionError(messages) {
  const match = Array.isArray(messages)
    ? messages.find((message) => String(message?.[0] || '').includes('execution_error'))
    : null;
  return String(match?.[1]?.exception_message || match?.[1]?.exception_type || '').trim();
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('ComfyUI job cancelled.'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('ComfyUI job cancelled.'));
    }, { once: true });
  });
}
