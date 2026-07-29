export const ADVANCED_TYPOGRAPHY_VERSION = 1;

export const TYPOGRAPHY_PRESETS = [
  typographyPreset('clean-editorial', 'Clean Editorial', {
    typography: {
      fontFamily: 'Montserrat SemiBold',
      fontWeight: 600,
      lineHeight: 1.08,
      letterSpacing: 0,
      align: 'left'
    }
  }),
  typographyPreset('stacked-title', 'Stacked Title', {
    typography: {
      fontFamily: 'Impact',
      fontWeight: 700,
      lineHeight: 0.72,
      letterSpacing: 1,
      align: 'left',
      verticalAlign: 'top'
    },
    lineEditing: { enabled: true }
  }),
  typographyPreset('condensed-poster', 'Condensed Poster', {
    typography: {
      fontFamily: 'Bahnschrift Condensed',
      fontWeight: 700,
      lineHeight: 0.86,
      letterSpacing: 0.5,
      align: 'left',
      scaleX: 0.78
    }
  }),
  typographyPreset('distressed-horror', 'Distressed Horror', {
    typography: {
      fontFamily: 'Impact',
      fontWeight: 700,
      lineHeight: 0.8,
      align: 'left'
    },
    textEffects: {
      distressed: {
        enabled: true,
        amount: 0.28,
        scale: 1,
        seed: 1337,
        threshold: 0.54,
        inverted: false
      }
    }
  }),
  typographyPreset('static-glitch', 'Static Glitch', {
    typography: {
      fontFamily: 'Arial Black',
      fontWeight: 900,
      lineHeight: 0.88,
      align: 'left'
    },
    textEffects: {
      glitch: {
        enabled: true,
        amount: 0.34,
        sliceCount: 9,
        horizontalDisplacement: 16,
        verticalDisplacement: 2,
        rgbSplit: true,
        seed: 808,
        mode: 'static'
      }
    }
  }),
  typographyPreset('noir-jazz', 'Noir Jazz', {
    typography: {
      fontFamily: 'Georgia',
      fontWeight: 700,
      fontStyle: 'italic',
      lineHeight: 0.92,
      letterSpacing: 1.2,
      align: 'left'
    },
    textEffects: {
      shadow: {
        enabled: true,
        color: '#000000',
        blur: 18,
        offsetX: 5,
        offsetY: 8,
        opacity: 0.72
      }
    }
  }),
  typographyPreset('wide-cinematic', 'Wide Cinematic', {
    typography: {
      fontFamily: 'Montserrat ExtraBold',
      fontWeight: 800,
      lineHeight: 0.96,
      letterSpacing: 5,
      align: 'center',
      scaleX: 1.24
    }
  })
];

export function createDefaultTypography(legacy = {}, overrides = {}) {
  const typography = {
    version: ADVANCED_TYPOGRAPHY_VERSION,
    fontFamily: String(legacy.fontFamily || 'Arial'),
    fontSize: finite(legacy.fontSize, 32),
    fontWeight: finite(legacy.fontWeight, 400),
    fontStyle: legacy.fontStyle === 'italic' ? 'italic' : 'normal',
    lineHeight: finite(legacy.lineHeight, 1),
    letterSpacing: finite(legacy.letterSpacing, 0),
    wordSpacing: finite(legacy.wordSpacing, 0),
    align: oneOf(legacy.align, ['left', 'center', 'right'], 'center'),
    verticalAlign: oneOf(legacy.verticalAlign, ['top', 'middle', 'bottom'], 'middle'),
    textTransform: oneOf(legacy.textTransform, ['none', 'uppercase', 'lowercase'], 'none'),
    color: String(legacy.color || '#ffffff'),
    textOpacity: finite(legacy.textOpacity, 1),
    autoWrap: legacy.autoWrap === true,
    boxMode: oneOf(legacy.boxMode, ['auto-size', 'fixed-box'], 'fixed-box'),
    scaleX: finite(legacy.textScaleX, 1),
    scaleY: finite(legacy.textScaleY, 1),
    skewX: finite(legacy.skewX, 0),
    skewY: finite(legacy.skewY, 0),
    rotation: finite(legacy.textRotation, 0),
    stretchX: finite(legacy.horizontalStretch, 1),
    stretchY: finite(legacy.verticalStretch, 1),
    anchorX: finite(legacy.textAnchorX, 0.5),
    anchorY: finite(legacy.textAnchorY, 0.5),
    offsetX: finite(legacy.textOffsetX, 0),
    offsetY: finite(legacy.textOffsetY, 0),
    ...overrides
  };
  const maxWidth = optionalFinite(overrides.maxWidth ?? legacy.maxWidth);
  if (maxWidth === undefined) delete typography.maxWidth;
  else typography.maxWidth = maxWidth;
  return typography;
}

export function createDefaultLineEditing(overrides = {}) {
  return {
    enabled: false,
    lines: [],
    ...overrides,
    lines: Array.isArray(overrides.lines) ? overrides.lines.map(normalizeLineOverride) : []
  };
}

export function createDefaultTextEffects(overrides = {}) {
  return {
    stroke: {
      enabled: false,
      color: '#000000',
      width: 0,
      opacity: 1,
      position: 'center',
      ...(overrides.stroke || {})
    },
    shadow: {
      enabled: false,
      color: '#000000',
      blur: 0,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      ...(overrides.shadow || {})
    },
    glow: {
      enabled: false,
      color: '#ffffff',
      blur: 18,
      intensity: 0.5,
      ...(overrides.glow || {})
    },
    distressed: {
      enabled: false,
      amount: 0.2,
      scale: 1,
      seed: 1,
      threshold: 0.5,
      inverted: false,
      ...(overrides.distressed || {})
    },
    glitch: {
      enabled: false,
      amount: 0.2,
      sliceCount: 8,
      horizontalDisplacement: 12,
      verticalDisplacement: 0,
      rgbSplit: false,
      seed: 1,
      mode: 'static',
      ...(overrides.glitch || {})
    },
    scanlines: {
      enabled: false,
      density: 0.18,
      thickness: 1,
      angle: 0,
      opacity: 0.24,
      seed: 1,
      ...(overrides.scanlines || {})
    }
  };
}

export function createDefaultTextureMask(overrides = {}) {
  return {
    enabled: false,
    assetId: '',
    blendMode: 'source-in',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    invertMask: false,
    contrast: 1,
    threshold: 0,
    ...overrides
  };
}

export function normalizeAdvancedTextProperties(properties = {}) {
  const typography = createDefaultTypography(properties, properties.typography || {});
  const legacyEffects = {
    stroke: {
      enabled: Number(properties.strokeWidth || 0) > 0,
      color: properties.strokeColor || '#000000',
      width: finite(properties.strokeWidth, 0),
      opacity: finite(properties.strokeOpacity, 1)
    },
    shadow: {
      enabled: Number(properties.shadowBlur || 0) > 0 ||
        Number(properties.shadowOffsetX || 0) !== 0 ||
        Number(properties.shadowOffsetY || 0) !== 0,
      color: properties.shadowColor || '#000000',
      blur: finite(properties.shadowBlur, 0),
      offsetX: finite(properties.shadowOffsetX, 0),
      offsetY: finite(properties.shadowOffsetY, 0),
      opacity: finite(properties.shadowOpacity, 1)
    }
  };
  return {
    ...properties,
    typography,
    lineEditing: createDefaultLineEditing(properties.lineEditing || {}),
    textEffects: createDefaultTextEffects({
      ...legacyEffects,
      ...(properties.textEffects || {}),
      stroke: { ...legacyEffects.stroke, ...(properties.textEffects?.stroke || {}) },
      shadow: { ...legacyEffects.shadow, ...(properties.textEffects?.shadow || {}) }
    }),
    textureMask: createDefaultTextureMask(properties.textureMask || {})
  };
}

export function syncLegacyTextProperties(properties = {}) {
  const normalized = normalizeAdvancedTextProperties(properties);
  const typography = normalized.typography;
  const stroke = normalized.textEffects.stroke;
  const shadow = normalized.textEffects.shadow;
  return {
    ...normalized,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    fontWeight: typography.fontWeight,
    fontStyle: typography.fontStyle,
    lineHeight: typography.lineHeight,
    letterSpacing: typography.letterSpacing,
    wordSpacing: typography.wordSpacing,
    align: typography.align,
    verticalAlign: typography.verticalAlign,
    textTransform: typography.textTransform,
    color: typography.color,
    textOpacity: typography.textOpacity,
    autoWrap: typography.autoWrap,
    boxMode: typography.boxMode,
    strokeColor: stroke.color,
    strokeWidth: stroke.enabled ? stroke.width : 0,
    shadowColor: shadow.color,
    shadowBlur: shadow.enabled ? shadow.blur : 0,
    shadowOffsetX: shadow.enabled ? shadow.offsetX : 0,
    shadowOffsetY: shadow.enabled ? shadow.offsetY : 0
  };
}

export function reconcileTextLines(text, currentLineEditing = {}) {
  const sourceLines = splitTextLines(text);
  const current = createDefaultLineEditing(currentLineEditing);
  const unused = new Set(current.lines.map((_, index) => index));
  const matches = sourceLines.map((lineText) => {
    const matchIndex = current.lines.findIndex((line, candidateIndex) =>
      unused.has(candidateIndex) && line.textSnapshot === lineText
    );
    if (matchIndex >= 0) unused.delete(matchIndex);
    return matchIndex;
  });
  const lines = sourceLines.map((lineText, index) => {
    let matchIndex = matches[index];
    if (matchIndex < 0 && unused.has(index)) {
      matchIndex = index;
      unused.delete(index);
    }
    const previous = matchIndex >= 0 ? current.lines[matchIndex] : null;
    return normalizeLineOverride({
      ...previous,
      id: previous?.id || stableLineId(lineText, index),
      textSnapshot: lineText
    });
  });
  return {
    ...current,
    lines
  };
}

export function splitTextLines(text) {
  return String(text ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
}

export function transformText(text, mode = 'none') {
  if (mode === 'uppercase') return String(text ?? '').toLocaleUpperCase();
  if (mode === 'lowercase') return String(text ?? '').toLocaleLowerCase();
  return String(text ?? '');
}

export function createTypographyPresetFromLayer(layer, options = {}) {
  const properties = normalizeAdvancedTextProperties(layer?.properties || {});
  return {
    id: options.id || slugify(options.name || layer?.name || 'Typography Preset'),
    name: options.name || layer?.name || 'Typography Preset',
    version: ADVANCED_TYPOGRAPHY_VERSION,
    description: options.description || '',
    typography: structuredClone(properties.typography),
    lineEditing: structuredClone(properties.lineEditing),
    textEffects: structuredClone(properties.textEffects),
    textureMask: structuredClone(properties.textureMask)
  };
}

export function applyTypographyPreset(layer, preset) {
  const current = normalizeAdvancedTextProperties(layer?.properties || {});
  const text = current.text;
  return {
    ...layer,
    properties: syncLegacyTextProperties({
      ...current,
      text,
      typographyPresetId: preset.id,
      typography: { ...current.typography, ...(preset.typography || {}) },
      lineEditing: createDefaultLineEditing({
        ...current.lineEditing,
        ...(preset.lineEditing || {}),
        lines: reconcilePresetLines(current.lineEditing.lines, preset.lineEditing?.lines)
      }),
      textEffects: createDefaultTextEffects({
        ...current.textEffects,
        ...(preset.textEffects || {})
      }),
      textureMask: createDefaultTextureMask({
        ...current.textureMask,
        ...(preset.textureMask || {})
      })
    })
  };
}

export function ensureProjectTypographyPresets(project) {
  const existing = Array.isArray(project?.metadata?.typographyPresets)
    ? project.metadata.typographyPresets
    : [];
  const byId = new Map(existing.map((preset) => [preset.id, preset]));
  for (const preset of TYPOGRAPHY_PRESETS) {
    if (!byId.has(preset.id)) byId.set(preset.id, preset);
  }
  return {
    ...project,
    metadata: {
      ...(project?.metadata || {}),
      typographyPresets: [...byId.values()]
    }
  };
}

export function upsertProjectTypographyPreset(project, preset) {
  const prepared = ensureProjectTypographyPresets(project);
  const presets = prepared.metadata.typographyPresets.filter((item) => item.id !== preset.id);
  return {
    ...prepared,
    metadata: {
      ...prepared.metadata,
      typographyPresets: [...presets, preset]
    }
  };
}

function typographyPreset(id, name, values) {
  const properties = normalizeAdvancedTextProperties(values);
  return {
    id,
    name,
    version: ADVANCED_TYPOGRAPHY_VERSION,
    description: '',
    typography: properties.typography,
    lineEditing: properties.lineEditing,
    textEffects: properties.textEffects,
    textureMask: properties.textureMask
  };
}

function normalizeLineOverride(line = {}) {
  const normalized = {
    id: String(line.id || ''),
    textSnapshot: String(line.textSnapshot ?? ''),
    offsetX: finite(line.offsetX, 0),
    offsetY: finite(line.offsetY, 0),
    scaleX: finite(line.scaleX, 1),
    scaleY: finite(line.scaleY, 1),
    rotation: finite(line.rotation, 0),
    opacity: finite(line.opacity, 1)
  };
  const fontSize = optionalFinite(line.fontSize);
  const letterSpacing = optionalFinite(line.letterSpacing);
  if (fontSize !== undefined) normalized.fontSize = fontSize;
  if (letterSpacing !== undefined) normalized.letterSpacing = letterSpacing;
  return normalized;
}

function reconcilePresetLines(current = [], preset = []) {
  if (!Array.isArray(preset) || !preset.length) return current || [];
  return preset.map((line, index) => ({
    ...(current?.[index] || {}),
    ...line,
    id: current?.[index]?.id || line.id || stableLineId(line.textSnapshot || '', index)
  }));
}

function stableLineId(text, index) {
  let hash = 2166136261;
  for (const character of `${index}:${text}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `text_line_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function slugify(value) {
  return String(value || 'typography-preset')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `typography-${Date.now().toString(36)}`;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFinite(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function oneOf(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}
