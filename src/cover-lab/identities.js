export const TAKARA_LORA_FILENAME = 'Takara_LoRa_800_Step.safetensors';

export const TAKARA_IDENTITY_PRESET = deepFreeze({
  id: 'takara',
  name: 'Takara',
  version: 1,
  parts: {
    age: 'mid 20s',
    face_type: 'heart-shaped face, high cheekbones, narrow jaw',
    eyes: 'almond eyes, heavy lashes',
    eyes_color: 'icy gray eyes',
    eye_makeup: 'blackened burgundy smoky eye, velvety blend, heavy lashes',
    nose: 'straight delicate nose',
    mouth: 'soft full lips, slight cupid bow',
    lip_makeup: 'dark burgundy matte lipstick',
    hair: 'long, perfectly straight hair with sharp center part, smooth surface tension, no waves, no curls, controlled silhouette',
    hair_color: 'soft black hair',
    skin: 'very fair skin with smooth porcelain-like texture and cool-to-neutral undertone',
    body_type: '',
    expression_base: 'calm observational gaze, relaxed facial tension',
    ethnicity: 'East Asian, Japanese/Korean features',
    nails: '',
    nail_color: ''
  },
  loraFilename: TAKARA_LORA_FILENAME,
  summary: [
    'icy gray almond eyes',
    'long straight soft-black hair',
    'very fair porcelain skin',
    'heart-shaped face',
    'burgundy makeup',
    'calm observational gaze'
  ]
});

const IDENTITY_PRESETS = new Map([
  [TAKARA_IDENTITY_PRESET.id, TAKARA_IDENTITY_PRESET]
]);

const TAKARA_NEGATIVE_TERMS = Object.freeze([
  'different woman',
  'identity change',
  'face shape change',
  'round face',
  'wide jaw',
  'brown eyes',
  'blue eyes',
  'blonde hair',
  'curly hair',
  'wavy hair',
  'short hair',
  'side part',
  'warm tan skin',
  'smiling expression',
  'generic fashion model',
  'Western facial features',
  'inconsistent character'
]);

export function listIdentityPresets() {
  return [...IDENTITY_PRESETS.values()].map((preset) => ({
    id: preset.id,
    name: preset.name,
    version: preset.version,
    dna: buildIdentityPrompt(preset),
    summary: [...preset.summary],
    loraFilename: preset.loraFilename
  }));
}

export function getIdentityPreset(id) {
  return IDENTITY_PRESETS.get(String(id || '').trim().toLowerCase()) || null;
}

export function resolveIdentity(identity = {}) {
  const presetId = String(identity.presetId || 'takara').trim().toLowerCase();
  if (presetId === 'none') return null;
  if (presetId === 'custom') {
    const dna = String(identity.customDna || '').trim();
    return dna
      ? { id: 'custom', name: 'Custom', version: 1, customDna: dna, summary: [], loraFilename: '' }
      : null;
  }
  return getIdentityPreset(presetId);
}

export function buildIdentityPrompt(preset, notes = '') {
  if (!preset) return '';
  if (preset.id === 'custom') {
    return appendIdentityNotes(String(preset.customDna || '').trim(), notes);
  }
  const parts = preset.parts || {};
  const age = String(parts.age || '').replace(/^mid 20s$/i, 'mid twenties');
  const lead = [
    `${preset.name}, an East Asian woman in her ${age}`,
    `with a ${parts.face_type}`,
    'icy gray almond eyes with blackened burgundy smoky eye makeup and heavy lashes',
    `a ${parts.nose}`,
    'soft full cupid-bowed lips with dark burgundy matte lipstick',
    'long perfectly straight soft-black hair with a sharp center part and a smooth controlled silhouette, no waves or curls',
    'very fair porcelain-like skin with a cool-to-neutral undertone',
    'Japanese/Korean facial features',
    'and a calm observational gaze with relaxed facial tension'
  ].filter(Boolean).join(', ');
  return appendIdentityNotes(lead, notes);
}

export function buildIdentityNegativePrompt(preset) {
  return preset?.id === TAKARA_IDENTITY_PRESET.id ? TAKARA_NEGATIVE_TERMS.join(', ') : '';
}

export function mergeNegativePrompt(base, addition) {
  const terms = [];
  const seen = new Set();
  for (const source of [base, addition]) {
    for (const value of String(source || '').split(',')) {
      const term = value.trim();
      const key = term.toLocaleLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms.join(', ');
}

export function applyIdentityNegativePrompt(base, preset, identity = {}) {
  if (!preset || identity.preserve === false) return String(base || '').trim();
  return mergeNegativePrompt(base, buildIdentityNegativePrompt(preset));
}

export function insertIdentityIntoPrompt(prompt, preset, identity = {}) {
  const identityBlock = buildIdentityPrompt(preset, identity.notes);
  if (!identityBlock) return String(prompt || '').trim();
  let concept = String(prompt || '').trim();
  if (concept.startsWith(identityBlock)) {
    concept = concept.slice(identityBlock.length).replace(/^[\s.,;:-]*(?:Concept:\s*)?/i, '').trim();
  } else if (preset?.name && new RegExp(`^${escapeRegExp(preset.name)}\\b`, 'i').test(concept)) {
    const conceptIndex = concept.search(/\bConcept:\s*/i);
    concept = conceptIndex >= 0 ? concept.slice(conceptIndex).replace(/^\bConcept:\s*/i, '').trim() : '';
  }
  return concept ? `${identityBlock}. Concept: ${concept}` : `${identityBlock}.`;
}

export function applyIdentityLora(workflow, preset, identity = {}, options = {}) {
  if (!preset?.loraFilename) return workflow;
  const loraNodeId = String(options.loraNodeId || '70');
  const inputs = workflow?.[loraNodeId]?.inputs;
  const match = Object.entries(inputs || {}).find(([, value]) => (
    value && typeof value === 'object'
    && String(value.lora || '').toLocaleLowerCase() === preset.loraFilename.toLocaleLowerCase()
  ));
  if (!match) {
    if (identity.useLora !== false) {
      throw new Error(`Character Identity requires LoRA "${preset.loraFilename}", but it is not present in the Cover Lab workflow.`);
    }
    return workflow;
  }
  const [, slot] = match;
  slot.on = identity.useLora !== false;
  slot.strength = boundedNumber(identity.loraStrength, 1.2, -4, 4);
  return workflow;
}

function appendIdentityNotes(prompt, notes) {
  const cleanPrompt = String(prompt || '').trim();
  const cleanNotes = String(notes || '').trim();
  return cleanNotes ? `${cleanPrompt}, identity notes: ${cleanNotes}` : cleanPrompt;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
