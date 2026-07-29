export const LYRICS_STYLE_PRESETS = [
  {
    id: 'noir-card',
    name: 'Noir Card',
    properties: {
      fontFamily: 'Montserrat SemiBold',
      fontSize: 54,
      color: '#F5F0EA',
      align: 'center',
      lineHeight: 1.18,
      maxLines: 2,
      backgroundColor: '#05070A',
      backgroundOpacity: 0.55,
      padding: 28,
      radius: 10,
      strokeColor: '#000000',
      strokeWidth: 5,
      glowColor: '#000000',
      glowBlur: 18,
      glowIntensity: 0.65,
      shadowColor: '#000000',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0
    }
  },
  {
    id: 'club-neon',
    name: 'Club Neon',
    properties: {
      fontFamily: 'Montserrat ExtraBold',
      fontSize: 62,
      color: '#F8FCFF',
      align: 'center',
      lineHeight: 1.08,
      maxLines: 2,
      backgroundColor: '#12151C',
      backgroundOpacity: 0.18,
      padding: 18,
      radius: 4,
      strokeColor: '#B50F1D',
      strokeWidth: 3,
      glowColor: '#B50F1D',
      glowBlur: 28,
      glowIntensity: 1,
      shadowColor: '#B50F1D',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0
    }
  },
  {
    id: 'cinematic-subtitle',
    name: 'Cinematic Subtitle',
    properties: {
      fontFamily: 'Georgia',
      fontSize: 46,
      color: '#F2E6D0',
      align: 'center',
      lineHeight: 1.22,
      maxLines: 2,
      backgroundColor: '#000000',
      backgroundOpacity: 0.68,
      padding: 24,
      radius: 2,
      strokeColor: '#000000',
      strokeWidth: 2,
      glowColor: '#000000',
      glowBlur: 14,
      glowIntensity: 0.5,
      shadowColor: '#000000',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0
    }
  }
];

export const LYRICS_STYLE_PROPERTY_KEYS = [
  'fontFamily',
  'fontSize',
  'color',
  'align',
  'lineHeight',
  'maxLines',
  'backgroundColor',
  'backgroundOpacity',
  'padding',
  'radius',
  'strokeColor',
  'strokeWidth',
  'glowColor',
  'glowBlur',
  'glowIntensity',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'transition'
];

export function getLyricsStylePreset(styleId) {
  return LYRICS_STYLE_PRESETS.find((preset) => preset.id === styleId) || LYRICS_STYLE_PRESETS[0];
}

export function applyLyricsStylePreset(layer, styleId) {
  const preset = getLyricsStylePreset(styleId);
  return {
    ...layer,
    properties: {
      ...(layer.properties || {}),
      styleId: preset.id,
      ...preset.properties
    }
  };
}

export function ensureProjectLyricsStylePresets(project) {
  const existing = Array.isArray(project?.metadata?.lyricsStylePresets)
    ? project.metadata.lyricsStylePresets
    : [];
  const byId = new Map(existing.map((preset) => [preset.id, preset]));
  for (const preset of LYRICS_STYLE_PRESETS) {
    if (!byId.has(preset.id)) byId.set(preset.id, structuredClone(preset));
  }
  return {
    ...project,
    metadata: {
      ...(project.metadata || {}),
      lyricsStylePresets: [...byId.values()]
    }
  };
}

export function createLyricsStylePresetFromLayer(layer, options = {}) {
  if (!layer || layer.type !== 'lyrics') {
    throw new Error('createLyricsStylePresetFromLayer requires a lyrics layer.');
  }
  const name = String(options.name || layer.name || 'Lyrics Style').trim();
  if (!name) throw new Error('Lyrics style preset name is required.');
  return sanitizeLyricsStylePreset({
    id: options.id || `custom-${slugify(name)}`,
    name,
    custom: true,
    scope: options.scope || 'global',
    createdAt: options.createdAt || new Date().toISOString(),
    properties: layer.properties || {}
  });
}

export function sanitizeLyricsStylePreset(preset) {
  if (!preset || typeof preset !== 'object') {
    throw new Error('Lyrics style preset must be an object.');
  }
  const id = String(preset.id || '').trim();
  const name = String(preset.name || '').trim();
  if (!id || !name) throw new Error('Lyrics style preset requires id and name.');
  return {
    id,
    name,
    custom: preset.custom === true,
    ...(preset.scope ? { scope: String(preset.scope) } : {}),
    ...(preset.createdAt ? { createdAt: String(preset.createdAt) } : {}),
    properties: sanitizeLyricsStyleProperties(preset.properties || {})
  };
}

export function sanitizeLyricsStyleProperties(properties) {
  const sanitized = {};
  for (const key of LYRICS_STYLE_PROPERTY_KEYS) {
    if (properties[key] !== undefined) sanitized[key] = structuredClone(properties[key]);
  }
  return sanitized;
}

export function upsertProjectLyricsStylePreset(project, preset) {
  const current = ensureProjectLyricsStylePresets(project);
  const sanitized = sanitizeLyricsStylePreset(preset);
  const presets = current.metadata.lyricsStylePresets || [];
  return {
    ...current,
    metadata: {
      ...(current.metadata || {}),
      lyricsStylePresets: [
        ...presets.filter((item) => item.id !== sanitized.id),
        sanitized
      ]
    }
  };
}

export function removeProjectLyricsStylePreset(project, presetId) {
  const current = ensureProjectLyricsStylePresets(project);
  return {
    ...current,
    metadata: {
      ...(current.metadata || {}),
      lyricsStylePresets: (current.metadata.lyricsStylePresets || [])
        .filter((preset) => preset.id !== presetId)
    }
  };
}

export function isBuiltInLyricsStylePreset(presetId) {
  return LYRICS_STYLE_PRESETS.some((preset) => preset.id === presetId);
}

export function calculateLyricsTransitionOpacity(cue, time, transition = {}) {
  if (!cue) return 1;
  if (transition.enabled === false) return 1;

  const mode = transition.type || 'fade';
  if (mode === 'none') return 1;

  const currentTime = Number(time || 0);
  const start = Number(cue.start || 0);
  const end = Number(cue.end || start);
  const fadeIn = Math.max(0, Number(transition.fadeIn ?? 0.14));
  const fadeOut = Math.max(0, Number(transition.fadeOut ?? 0.18));
  let opacity = 1;

  if (fadeIn > 0 && currentTime < start + fadeIn) {
    opacity = Math.min(opacity, clamp01((currentTime - start) / fadeIn));
  }

  if (fadeOut > 0 && currentTime > end - fadeOut) {
    opacity = Math.min(opacity, clamp01((end - currentTime) / fadeOut));
  }

  return clamp01(easeOut(opacity));
}

function easeOut(value) {
  const t = clamp01(value);
  return 1 - (1 - t) * (1 - t);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function slugify(value) {
  return String(value || 'lyrics-style')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'lyrics-style';
}
