export const DEPRECATED_VISUALIZER_TYPES = new Map([
  ['pulse-dots', 'radial-spectrum']
]);

export const VISUALIZER_STYLE_PRESETS = [
  {
    id: 'noir-bars',
    name: 'Noir Bars',
    properties: {
      visualizerType: 'bars',
      bars: 192,
      minFrequency: 40,
      maxFrequency: 16000,
      gain: 1,
      sensitivity: 1.08,
      floor: 0.04,
      highFrequencyBoost: 0.75,
      lowFrequencyDamping: 0.38,
      midFrequencyDamping: 0.16,
      noiseGate: 0.025,
      color: '#EDEDED',
      accentColor: '#B50F1D'
    }
  },
  {
    id: 'radial-pulse',
    name: 'Radial Pulse',
    properties: {
      visualizerType: 'radial-spectrum',
      bars: 128,
      minFrequency: 35,
      maxFrequency: 15000,
      gain: 0.78,
      sensitivity: 1.24,
      floor: 0.025,
      highFrequencyBoost: 0.9,
      lowFrequencyDamping: 0.55,
      midFrequencyDamping: 0.26,
      noiseGate: 0.04,
      innerRadius: 92,
      outerRadius: 260,
      barThickness: 4,
      startAngle: -90,
      arc: 360,
      rotationSpeed: 0,
      mirror: true,
      shadowLength: 0.35,
      color: '#F4F1EA',
      accentColor: '#B50F1D',
      shadowColor: '#3D1117'
    }
  },
  {
    id: 'cinematic-halo',
    name: 'Cinematic Halo',
    properties: {
      visualizerType: 'radial-spectrum',
      bars: 192,
      minFrequency: 45,
      maxFrequency: 18000,
      gain: 0.9,
      sensitivity: 1.16,
      floor: 0.025,
      highFrequencyBoost: 0.95,
      lowFrequencyDamping: 0.46,
      midFrequencyDamping: 0.2,
      noiseGate: 0.03,
      innerRadius: 120,
      outerRadius: 300,
      barThickness: 3,
      startAngle: -88,
      arc: 360,
      rotationSpeed: 0.015,
      mirror: false,
      shadowLength: 0.22,
      color: '#F2E6D0',
      accentColor: '#7FA34A',
      shadowColor: '#101820'
    }
  },
  {
    id: 'bass-tunnel',
    name: 'Bass Tunnel',
    properties: {
      visualizerType: 'center-bars',
      bars: 160,
      minFrequency: 28,
      maxFrequency: 9000,
      gain: 0.82,
      sensitivity: 1.24,
      floor: 0.03,
      highFrequencyBoost: 0.45,
      lowFrequencyDamping: 0.28,
      midFrequencyDamping: 0.12,
      noiseGate: 0.035,
      color: '#D7DEE7',
      accentColor: '#D1162A'
    }
  }
];

export const VISUALIZER_PRESET_PROPERTY_KEYS = [
  'visualizerType',
  'bars',
  'minFrequency',
  'maxFrequency',
  'gain',
  'sensitivity',
  'floor',
  'highFrequencyBoost',
  'lowFrequencyDamping',
  'midFrequencyDamping',
  'noiseGate',
  'color',
  'accentColor',
  'innerRadius',
  'outerRadius',
  'barThickness',
  'startAngle',
  'arc',
  'rotationSpeed',
  'mirror',
  'shadowLength',
  'shadowColor',
  'sceneVisualizerEnabled'
];

export const VISUALIZER_PRESET_TRANSFORM_KEYS = [
  'width',
  'height',
  'scaleX',
  'scaleY'
];

export function normalizeVisualizerType(type) {
  const value = String(type || 'bars');
  return DEPRECATED_VISUALIZER_TYPES.get(value) || value;
}

export function getVisualizerStylePreset(styleId) {
  return VISUALIZER_STYLE_PRESETS.find((preset) => preset.id === styleId) || VISUALIZER_STYLE_PRESETS[0];
}

export function applyVisualizerStylePreset(layer, styleId) {
  const preset = getVisualizerStylePreset(styleId);
  return applyVisualizerPresetObject(layer, preset);
}

export function applyVisualizerPresetObject(layer, preset) {
  if (!preset) return layer;
  const transform = sanitizeVisualizerPresetTransform(preset.transform || {});
  const hasTransform = Object.keys(transform).length > 0;
  return {
    ...layer,
    ...(hasTransform
      ? {
          transform: {
            ...(layer.transform || {}),
            ...transform
          }
        }
      : {}),
    properties: {
      ...(layer.properties || {}),
      visualizerStyleId: preset.id,
      ...sanitizeVisualizerPresetProperties(preset.properties || {})
    }
  };
}

export function createVisualizerPresetFromLayer(layer, options = {}) {
  if (!layer || layer.type !== 'visualizer') {
    throw new Error('createVisualizerPresetFromLayer requires a visualizer layer.');
  }
  const name = String(options.name || layer.name || 'Visualizer Preset').trim();
  if (!name) {
    throw new Error('Visualizer preset name is required.');
  }
  const id = options.id || `custom-${slugify(name)}`;
  const transform = sanitizeVisualizerPresetTransform(layer.transform || {});
  return {
    id,
    name,
    custom: true,
    ...(options.scope ? { scope: options.scope } : {}),
    createdAt: options.createdAt || new Date().toISOString(),
    properties: sanitizeVisualizerPresetProperties(layer.properties || {}),
    ...(Object.keys(transform).length ? { transform } : {})
  };
}

export function upsertProjectVisualizerStylePreset(project, preset) {
  const current = ensureProjectVisualizerStylePresets(project);
  const sanitized = sanitizeVisualizerPreset(preset);
  const presets = current.metadata.visualizerStylePresets || [];
  const nextPresets = presets.filter((item) => item.id !== sanitized.id);
  nextPresets.push(sanitized);
  return {
    ...current,
    metadata: {
      ...(current.metadata || {}),
      visualizerStylePresets: nextPresets
    }
  };
}

export function sanitizeVisualizerPresetProperties(properties) {
  const sanitized = {};
  for (const key of VISUALIZER_PRESET_PROPERTY_KEYS) {
    if (properties[key] !== undefined) sanitized[key] = structuredClone(properties[key]);
  }
  if (sanitized.visualizerType) {
    sanitized.visualizerType = normalizeVisualizerType(sanitized.visualizerType);
  }
  return sanitized;
}

export function sanitizeVisualizerPresetTransform(transform) {
  const sanitized = {};
  for (const key of VISUALIZER_PRESET_TRANSFORM_KEYS) {
    if (transform[key] === undefined || transform[key] === null || transform[key] === '') continue;
    const value = Number(transform[key]);
    if (Number.isFinite(value)) sanitized[key] = value;
  }
  return sanitized;
}

export function sanitizeVisualizerPreset(preset) {
  if (!preset || typeof preset !== 'object') {
    throw new Error('Visualizer preset must be an object.');
  }
  if (!preset.id || !preset.name) {
    throw new Error('Visualizer preset requires id and name.');
  }
  const transform = sanitizeVisualizerPresetTransform(preset.transform || {});
  return {
    id: String(preset.id),
    name: String(preset.name),
    ...(preset.custom !== undefined ? { custom: preset.custom !== false } : {}),
    ...(preset.scope ? { scope: String(preset.scope) } : {}),
    ...(preset.createdAt ? { createdAt: String(preset.createdAt) } : {}),
    properties: sanitizeVisualizerPresetProperties(preset.properties || {}),
    ...(Object.keys(transform).length ? { transform } : {})
  };
}

export function ensureProjectVisualizerStylePresets(project) {
  const existing = Array.isArray(project?.metadata?.visualizerStylePresets)
    ? project.metadata.visualizerStylePresets
    : [];
  const byId = new Map(existing.map((preset) => [preset.id, preset]));
  for (const preset of VISUALIZER_STYLE_PRESETS) {
    if (!byId.has(preset.id)) byId.set(preset.id, structuredClone(preset));
  }
  return {
    ...project,
    metadata: {
      ...(project.metadata || {}),
      visualizerStylePresets: [...byId.values()]
    }
  };
}

function slugify(value) {
  return String(value || 'visualizer-preset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'visualizer-preset';
}
