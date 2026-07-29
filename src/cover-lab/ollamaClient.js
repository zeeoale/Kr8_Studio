import { normalizeHttpEndpoint } from './schema.js';
import { buildIdentityPrompt, insertIdentityIntoPrompt } from './identities.js';

const SYSTEM_PROMPT = [
  'You are a cinematic photography art director creating one single production-ready image prompt inspired by a song.',
  'Describe only the photographed scene itself: subject, environment, wardrobe, pose, expression, lighting, color palette, lens, camera angle, framing, depth of field and visible atmosphere.',
  'Create one coherent and physically achievable scene, not a collage, poster, album layout, promotional graphic or graphic-design composition.',
  'Do not mention or request any text, typography, lettering, words, captions, titles, labels, logos, symbols, signage, posters, screens, printed material, album artwork, cover design, editorial layout or branding.',
  'Do not describe empty space as being reserved for text, titles, lyrics or overlays. Instead describe it only as clean uncluttered background, open darkness, atmospheric negative space or simple environmental space.',
  'Avoid objects that naturally contain writing, including books, magazines, newspapers, signs, billboards, packaging, clothing prints, tattoos with lettering, computer screens, phone screens and wall posters.',
  'Never repeat the song title or any lyric inside the final prompt.',
  'When a character identity is supplied, preserve that identity exactly while allowing the setting, wardrobe, pose, lighting and atmosphere to reflect the song.',
  'Compose specifically for the requested aspect ratio using photographic framing and balanced subject placement.',
  'Return only one continuous image-generation prompt describing the visible photograph.',
  'Do not explain your choices. Do not use JSON, Markdown, headings, bullet points, quotation marks or meta-commentary.'
].join(' ');

export async function listOllamaModels(options = {}) {
  const endpoint = normalizeHttpEndpoint(options.endpoint || 'http://127.0.0.1:11434', 'Ollama endpoint');
  const payload = await requestJson(`${endpoint}/api/tags`, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || 5_000,
    offlineMessage: 'Ollama is not reachable. Start Ollama and refresh the model list.'
  });
  const models = Array.isArray(payload?.models)
    ? payload.models.map((model) => String(model?.name || model?.model || '').trim()).filter(Boolean)
    : [];
  return [...new Set(models)].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export async function createOllamaCoverPrompt(options = {}) {
  const endpoint = normalizeHttpEndpoint(options.endpoint || 'http://127.0.0.1:11434', 'Ollama endpoint');
  const model = String(options.model || '').trim();
  if (!model) throw new Error('Choose an installed Ollama model.');
  const context = options.context || {};
  const ratio = options.ratio || {};
  const identityPreset = options.identityPreset || null;
  const identity = options.identity || {};
  const identityPrompt = buildIdentityPrompt(identityPreset, identity.notes);
  const userPrompt = [
    `Song title: ${context.title || 'Untitled'}`,
    `Artist: ${context.artist || 'Unknown artist'}`,
    `Lyrics:\n${truncate(context.lyrics, 6_000) || '(not available)'}`,
    `Suno/style prompt: ${context.sunoPrompt || '(not provided)'}`,
    `Mood: ${context.mood || '(not provided)'}`,
    `Visual direction: ${context.visualDirection || '(not provided)'}`,
    `Output composition: ${ratio.name || ratio.id || 'custom'}, ${ratio.width || '?'}x${ratio.height || '?'}`,
    identityPrompt ? `Canonical character DNA: ${identityPrompt}` : ''
  ].filter(Boolean).join('\n\n');
  const payload = await requestJson(`${endpoint}/api/chat`, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || 90_000,
    offlineMessage: 'Ollama is not reachable or did not answer before the timeout.',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: 0,
        messages: [
          { role: 'system', content: buildSystemPrompt(identityPreset, identity) },
          { role: 'user', content: userPrompt }
        ],
        options: {
          temperature: 0.72,
          num_predict: 450
        }
      })
    }
  });
  const prompt = String(payload?.message?.content || payload?.response || '').trim();
  if (!prompt) throw new Error('Ollama returned an empty prompt.');
  const cleanPrompt = prompt.replace(/^```(?:text)?\s*|\s*```$/gi, '').trim();
  return identityPreset
    ? insertIdentityIntoPrompt(cleanPrompt, identityPreset, identity)
    : cleanPrompt;
}

function buildSystemPrompt(identityPreset, identity) {
  if (!identityPreset) return SYSTEM_PROMPT;
  const identityPrompt = buildIdentityPrompt(identityPreset, identity.notes);
  const rules = [
    SYSTEM_PROMPT,
    `The canonical protagonist is ${identityPreset.name}.`,
    `Your response must begin with this canonical identity before the song concept: "${identityPrompt}."`,
    'Never replace the character with a generic woman, female model or a person with incompatible features.',
    'The song may change only outfit, location, lighting, pose, camera, atmosphere and symbolic elements.'
  ];
  if (identityPreset.id === 'takara') {
    rules.push(
      'Preserve her heart-shaped face, high cheekbones, narrow jaw, icy gray almond eyes, heavy lashes, long perfectly straight soft-black hair with a sharp center part, very fair porcelain-like skin, burgundy lips, calm observational expression and East Asian Japanese/Korean features.',
      'Do not give her wavy or curly hair, blonde hair, brown eyes, tanned skin, a round face, a different ethnicity or a broad smile unless the user explicitly requests the expression.'
    );
  }
  return rules.join(' ');
}

async function requestJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
  try {
    let response;
    try {
      response = await fetchImpl(url, { ...(options.init || {}), signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(options.offlineMessage || 'Request timed out.');
      throw new Error(options.offlineMessage || `Request failed: ${error.message || error}`);
    }
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Ollama returned malformed JSON.');
    }
    if (!response.ok) {
      const detail = String(payload?.error || payload?.message || '').trim();
      if (response.status === 404) throw new Error(detail || 'The selected Ollama model does not exist.');
      throw new Error(detail || `Ollama request failed with HTTP ${response.status}.`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[lyrics truncated]` : text;
}
