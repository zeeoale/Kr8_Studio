import {
  deleteLayer,
  duplicateLayer,
  normalizeLayerOrder,
  reorderLayer,
  toggleLayerLock,
  toggleLayerVisibility,
  updateLayer
} from '../layers/operations.js';

export const MOBILE_COMPOSITION = Object.freeze({
  id: 'vertical-1080p',
  width: 1080,
  height: 1920,
  outputTarget: '9:16'
});

const TRANSFORM_KEYS = new Set(['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotation', 'anchorX', 'anchorY']);
const PROPERTY_KEYS = new Set([
  'text', 'fontFamily', 'fontSize', 'color', 'align', 'fill', 'backgroundColor', 'backgroundOpacity',
  'padding', 'radius', 'strokeColor', 'strokeWidth', 'shadowColor', 'shadowBlur', 'fit', 'bars',
  'visualizerType', 'accentColor', 'minFrequency', 'maxFrequency', 'gain', 'sensitivity', 'floor',
  'highFrequencyBoost', 'lowFrequencyDamping', 'midFrequencyDamping', 'noiseGate', 'innerRadius',
  'outerRadius', 'barThickness', 'arc', 'startAngle', 'mirror', 'loop', 'startOffset', 'playbackRate',
  'typographyPresetId', 'typography', 'lineEditing', 'textEffects', 'textureMask'
]);
const ADVANCED_TEXT_PROPERTY_KEYS = new Set(['typography', 'lineEditing', 'textEffects', 'textureMask']);
const BLEND_MODES = new Set(['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'add', 'subtract']);

export function applyMobileVerticalFormat(project) {
  const composition = project?.composition || {};
  const previousWidth = Math.max(1, Number(composition.width || MOBILE_COMPOSITION.width));
  const previousHeight = Math.max(1, Number(composition.height || MOBILE_COMPOSITION.height));
  const scaleX = MOBILE_COMPOSITION.width / previousWidth;
  const scaleY = MOBILE_COMPOSITION.height / previousHeight;
  return {
    ...project,
    composition: {
      ...composition,
      width: MOBILE_COMPOSITION.width,
      height: MOBILE_COMPOSITION.height,
      fps: Math.max(1, Math.round(Number(composition.fps || 30))),
      outputTarget: MOBILE_COMPOSITION.outputTarget,
      formatId: MOBILE_COMPOSITION.id
    },
    layers: normalizeLayerOrder((project.layers || []).map((layer) => ({
      ...layer,
      transform: scaleTransform(layer.transform, scaleX, scaleY)
    }))),
    metadata: {
      ...(project.metadata || {}),
      outputTargets: [MOBILE_COMPOSITION.outputTarget],
      compositionFormatId: MOBILE_COMPOSITION.id
    }
  };
}

export function patchMobileLayer(project, layerId, patch = {}) {
  const layer = (project.layers || []).find((entry) => entry.id === layerId);
  if (!layer) throw new Error('Layer not found.');
  if (layer.locked && !('locked' in patch) && !('visible' in patch)) throw new Error('Unlock the layer before editing it.');

  return updateLayer(project, layerId, (current) => {
    const next = { ...current };
    if ('name' in patch) {
      const name = String(patch.name || '').trim();
      if (name) next.name = name.slice(0, 120);
    }
    if ('visible' in patch) next.visible = Boolean(patch.visible);
    if ('locked' in patch) next.locked = Boolean(patch.locked);
    if ('opacity' in patch) next.opacity = clamp(patch.opacity, 0, 1);
    if ('blendMode' in patch && BLEND_MODES.has(patch.blendMode)) next.blendMode = patch.blendMode;
    if (patch.transform && typeof patch.transform === 'object') {
      next.transform = { ...(current.transform || {}) };
      for (const [key, value] of Object.entries(patch.transform)) {
        if (TRANSFORM_KEYS.has(key) && Number.isFinite(Number(value))) next.transform[key] = Number(value);
      }
    }
    if (patch.properties && typeof patch.properties === 'object') {
      next.properties = { ...(current.properties || {}) };
      for (const [key, value] of Object.entries(patch.properties)) {
        if (!PROPERTY_KEYS.has(key)) continue;
        next.properties[key] = ADVANCED_TEXT_PROPERTY_KEYS.has(key)
          ? sanitizeStructuredProperty(value)
          : sanitizeProperty(value);
      }
    }
    return next;
  });
}

export function applyMobileLayerAction(project, layerId, action) {
  if (action === 'visibility') return { project: toggleLayerVisibility(project, layerId), selectedLayerId: layerId };
  if (action === 'lock') return { project: toggleLayerLock(project, layerId), selectedLayerId: layerId };
  if (action === 'up') return { project: reorderLayer(project, layerId, -1), selectedLayerId: layerId };
  if (action === 'down') return { project: reorderLayer(project, layerId, 1), selectedLayerId: layerId };
  if (action === 'duplicate') {
    const result = duplicateLayer(project, layerId);
    return { project: result.project, selectedLayerId: result.duplicatedLayerId || layerId };
  }
  if (action === 'delete') {
    const next = deleteLayer(project, layerId);
    return { project: next, selectedLayerId: next.layers[0]?.id || '' };
  }
  throw new Error('Unsupported mobile layer action.');
}

function scaleTransform(transform = {}, scaleX, scaleY) {
  const next = { ...transform };
  for (const key of ['x', 'width']) if (typeof next[key] === 'number') next[key] *= scaleX;
  for (const key of ['y', 'height']) if (typeof next[key] === 'number') next[key] *= scaleY;
  return next;
}

function sanitizeProperty(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return String(value ?? '').slice(0, 5000);
}

function sanitizeStructuredProperty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return structuredClone(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value || 0)));
}
