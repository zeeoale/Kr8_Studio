export function resolveLayerAudioBindings(layer, audioFrame) {
  const nextLayer = structuredClone(layer);

  for (const binding of nextLayer.audioBindings || []) {
    const sourceValue = readAudioSource(audioFrame, binding.source);
    const normalized = binding.invert ? 1 - sourceValue : sourceValue;
    const curved = applyCurve(normalized, binding.curve);
    const value = binding.min !== undefined && binding.max !== undefined
      ? Number(binding.min) + (Number(binding.max) - Number(binding.min)) * curved
      : readTargetValue(nextLayer, binding.targetProperty) + Number(binding.amount || 0) * curved;

    writeTargetValue(nextLayer, binding.targetProperty, value);
  }

  return nextLayer;
}

export function resolveProjectAudioBindings(project, audioFrame) {
  return {
    ...project,
    layers: project.layers.map((layer) => resolveLayerAudioBindings(layer, audioFrame))
  };
}

export function readAudioSource(audioFrame, source) {
  if (!audioFrame) return 0;
  if (source === 'beat') return audioFrame.beat ? 1 : 0;
  if (source === 'frequencyBins') {
    const bins = audioFrame.frequencyBins || [];
    if (!bins.length) return 0;
    return Array.from(bins).reduce((sum, value) => sum + Number(value || 0), 0) / bins.length;
  }
  return clamp01(Number(audioFrame[source] || 0));
}

export function readTargetValue(target, propertyPath) {
  const parts = String(propertyPath || '').split('.').filter(Boolean);
  let cursor = target;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return 0;
    cursor = cursor[part];
  }
  return Number(cursor || 0);
}

export function writeTargetValue(target, propertyPath, value) {
  const parts = String(propertyPath || '').split('.').filter(Boolean);
  if (parts.length === 0) return target;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
  return target;
}

function applyCurve(value, curve = 'linear') {
  const x = clamp01(value);
  if (curve === 'ease-in') return x * x;
  if (curve === 'ease-out') return 1 - (1 - x) * (1 - x);
  if (curve === 'ease-in-out') return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
  return x;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
