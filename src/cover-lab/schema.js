export const COVER_LAB_VERSION = 1;

export const COVER_LAB_RATIOS = Object.freeze([
  { id: 'square', name: 'Square 1:1', width: 1024, height: 1024 },
  { id: 'portrait', name: 'Portrait 4:5', width: 1024, height: 1280 },
  { id: 'vertical', name: 'Vertical 9:16', width: 720, height: 1280 },
  { id: 'landscape', name: 'Landscape 16:9', width: 1280, height: 720 },
  { id: 'tk-wide', name: 'TK Wide 9:8', width: 1152, height: 1024 }
]);

export const DEFAULT_NEGATIVE_PROMPT = [
  'readable text',
  'letters',
  'typography',
  'song title',
  'logo',
  'watermark',
  'signature',
  'low quality',
  'blurry',
  'deformed'
].join(', ');

export function createDefaultCoverLabSettings(input = {}) {
  const ratio = findRatio(input.generation?.ratio || input.ratio || 'square');
  return normalizeCoverLabSettings({
    version: COVER_LAB_VERSION,
    context: {
      title: '',
      artist: '',
      lyrics: '',
      sunoPrompt: '',
      mood: '',
      visualDirection: '',
      ...(input.context || {})
    },
    ollama: {
      endpoint: 'http://127.0.0.1:11434',
      model: '',
      ...(input.ollama || {})
    },
    prompts: {
      positive: '',
      negative: DEFAULT_NEGATIVE_PROMPT,
      ...(input.prompts || {})
    },
    identity: {
      presetId: 'takara',
      preserve: true,
      useLora: true,
      loraStrength: 1.2,
      notes: '',
      customDna: '',
      ...(input.identity || {})
    },
    generation: {
      ratio: ratio.id,
      width: ratio.width,
      height: ratio.height,
      seed: 1,
      randomizeSeed: true,
      batchSize: 1,
      generateUpscaled: true,
      ...(input.generation || {})
    },
    comfy: {
      endpoint: 'http://127.0.0.1:8188',
      ...(input.comfy || {})
    },
    loras: Array.isArray(input.loras) ? input.loras : [],
    selectedAssetId: String(input.selectedAssetId || '')
  });
}

export function normalizeCoverLabSettings(input = {}) {
  const ratio = findRatio(input.generation?.ratio || 'square');
  const width = boundedInteger(input.generation?.width, ratio.width, 64, 4096);
  const height = boundedInteger(input.generation?.height, ratio.height, 64, 4096);
  const seed = boundedInteger(input.generation?.seed, 1, 0, Number.MAX_SAFE_INTEGER);
  const batchSize = boundedInteger(input.generation?.batchSize, 1, 1, 8);
  return {
    version: COVER_LAB_VERSION,
    context: {
      title: cleanText(input.context?.title),
      artist: cleanText(input.context?.artist),
      lyrics: cleanText(input.context?.lyrics),
      sunoPrompt: cleanText(input.context?.sunoPrompt),
      mood: cleanText(input.context?.mood),
      visualDirection: cleanText(input.context?.visualDirection)
    },
    ollama: {
      endpoint: normalizeHttpEndpoint(input.ollama?.endpoint || 'http://127.0.0.1:11434', 'Ollama endpoint'),
      model: cleanText(input.ollama?.model)
    },
    prompts: {
      positive: cleanText(input.prompts?.positive),
      negative: cleanText(input.prompts?.negative || DEFAULT_NEGATIVE_PROMPT)
    },
    identity: normalizeIdentity(input.identity),
    generation: {
      ratio: ratio.id,
      width,
      height,
      seed,
      randomizeSeed: input.generation?.randomizeSeed !== false,
      batchSize,
      generateUpscaled: input.generation?.generateUpscaled !== false
    },
    comfy: {
      endpoint: normalizeHttpEndpoint(input.comfy?.endpoint || 'http://127.0.0.1:8188', 'ComfyUI endpoint')
    },
    loras: normalizeLoras(input.loras),
    selectedAssetId: cleanText(input.selectedAssetId)
  };
}

export function mergeCoverLabContext(settings, context = {}) {
  const current = createDefaultCoverLabSettings(settings);
  return normalizeCoverLabSettings({
    ...current,
    context: {
      ...current.context,
      title: current.context.title || cleanText(context.title),
      artist: current.context.artist || cleanText(context.artist),
      lyrics: current.context.lyrics || cleanText(context.lyrics)
    }
  });
}

export function normalizeHttpEndpoint(value, label = 'Endpoint') {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain embedded credentials.`);
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function validateCoverLabSettings(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['coverLab must be an object.'];
  if (input.version !== COVER_LAB_VERSION) errors.push(`coverLab.version must be ${COVER_LAB_VERSION}.`);
  try {
    normalizeCoverLabSettings(input);
  } catch (error) {
    errors.push(error.message || String(error));
  }
  if (input.loras !== undefined && !Array.isArray(input.loras)) {
    errors.push('coverLab.loras must be an array.');
  }
  if (input.identity !== undefined && (!input.identity || typeof input.identity !== 'object' || Array.isArray(input.identity))) {
    errors.push('coverLab.identity must be an object.');
  }
  return errors;
}

export function findRatio(id) {
  return COVER_LAB_RATIOS.find((ratio) => ratio.id === id) || COVER_LAB_RATIOS[0];
}

export function createRandomSeed(random = Math.random) {
  return Math.floor(Math.max(0, Math.min(0.999999999999, Number(random()))) * 1_000_000_000_000_000);
}

export function sanitizeOutputSegment(value, fallback = 'cover') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();
  return (normalized || fallback).slice(0, 80);
}

function normalizeLoras(loras) {
  if (!Array.isArray(loras)) return [];
  return loras.slice(0, 6).map((lora, index) => ({
    slot: String(lora?.slot || `lora_${index + 1}`),
    enabled: lora?.enabled === true || lora?.on === true,
    filename: cleanText(lora?.filename || lora?.lora),
    strength: boundedNumber(lora?.strength, 1, -4, 4)
  }));
}

function normalizeIdentity(identity = {}) {
  const requestedPreset = cleanText(identity?.presetId || 'takara').toLowerCase();
  const presetId = ['takara', 'none', 'custom'].includes(requestedPreset) ? requestedPreset : 'takara';
  return {
    presetId,
    preserve: identity?.preserve !== false,
    useLora: presetId === 'takara' && identity?.useLora !== false,
    loraStrength: boundedNumber(identity?.loraStrength, 1.2, -4, 4),
    notes: cleanText(identity?.notes),
    customDna: cleanText(identity?.customDna)
  };
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
