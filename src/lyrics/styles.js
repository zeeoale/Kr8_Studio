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
      shadowColor: '#000000',
      shadowBlur: 18
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
      shadowColor: '#B50F1D',
      shadowBlur: 28
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
      shadowColor: '#000000',
      shadowBlur: 14
    }
  }
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
