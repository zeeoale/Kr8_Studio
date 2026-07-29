export const TEXT_STYLE_PRESETS = [
  {
    id: 'bright-on-dark',
    name: 'Bright on Dark',
    description: 'Clean ivory text for dark covers and noir backgrounds.',
    properties: {
      fontFamily: 'Montserrat SemiBold',
      color: '#F5F0EA',
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowColor: '#000000',
      shadowBlur: 18,
      shadowOffsetX: 0,
      shadowOffsetY: 3,
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      padding: 0,
      radius: 0
    }
  },
  {
    id: 'dark-on-light',
    name: 'Dark on Light',
    description: 'Charcoal text with a pale lift for bright cover art.',
    properties: {
      fontFamily: 'Montserrat SemiBold',
      color: '#15181E',
      strokeColor: '#FFFFFF',
      strokeWidth: 3,
      shadowColor: '#FFFFFF',
      shadowBlur: 10,
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      backgroundColor: '#FFFFFF',
      backgroundOpacity: 0,
      padding: 0,
      radius: 0
    }
  },
  {
    id: 'cinematic-shadow',
    name: 'Cinematic Shadow',
    description: 'White title text with strong black separation.',
    properties: {
      fontFamily: 'Montserrat ExtraBold',
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 4,
      shadowColor: '#000000',
      shadowBlur: 24,
      shadowOffsetX: 0,
      shadowOffsetY: 5,
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      padding: 0,
      radius: 0
    }
  },
  {
    id: 'soft-caption-card',
    name: 'Soft Caption Card',
    description: 'Readable card treatment for busy images.',
    properties: {
      fontFamily: 'Montserrat SemiBold',
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowColor: '#000000',
      shadowBlur: 12,
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      backgroundColor: '#000000',
      backgroundOpacity: 0.42,
      padding: 18,
      radius: 8
    }
  },
  {
    id: 'red-accent-glow',
    name: 'Red Accent Glow',
    description: 'TK red glow for dramatic titles on dark material.',
    properties: {
      fontFamily: 'Montserrat ExtraBold',
      color: '#FFFFFF',
      strokeColor: '#B50F1D',
      strokeWidth: 1,
      shadowColor: '#B50F1D',
      shadowBlur: 24,
      shadowOffsetX: 0,
      shadowOffsetY: 3,
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      padding: 0,
      radius: 0
    }
  }
];

export function findTextStylePreset(styleId) {
  return TEXT_STYLE_PRESETS.find((preset) => preset.id === styleId) || TEXT_STYLE_PRESETS[0];
}

export function applyTextStylePreset(layer, styleId) {
  const preset = findTextStylePreset(styleId);
  return {
    ...layer,
    properties: {
      ...(layer.properties || {}),
      textStyleId: preset.id,
      ...preset.properties
    }
  };
}

export function ensureProjectTextStylePresets(project) {
  const current = project || {};
  const existing = Array.isArray(current.metadata?.textStylePresets)
    ? current.metadata.textStylePresets
    : [];
  const byId = new Map(existing.map((preset) => [preset.id, preset]));
  for (const preset of TEXT_STYLE_PRESETS) {
    if (!byId.has(preset.id)) byId.set(preset.id, preset);
  }
  return {
    ...current,
    metadata: {
      ...(current.metadata || {}),
      textStylePresets: [...byId.values()]
    }
  };
}
