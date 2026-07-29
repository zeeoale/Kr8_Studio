export function evaluateLayerAnimations(layer, time) {
  const animations = Array.isArray(layer?.animations) ? layer.animations : [];
  if (!animations.some((track) => track?.enabled !== false && track.keyframes?.length)) return layer;
  const evaluated = structuredClone(layer);
  for (const track of animations) {
    if (!track || track.enabled === false || !track.targetProperty || !track.keyframes?.length) continue;
    const value = evaluateKeyframes(track.keyframes, time);
    if (value !== undefined) writePath(evaluated, track.targetProperty, value);
  }
  return evaluated;
}

export function evaluateKeyframes(keyframes, time) {
  const frames = [...keyframes]
    .filter((frame) => Number.isFinite(Number(frame?.time)))
    .sort((left, right) => Number(left.time) - Number(right.time));
  if (!frames.length) return undefined;
  if (time <= Number(frames[0].time)) return structuredClone(frames[0].value);
  if (time >= Number(frames.at(-1).time)) return structuredClone(frames.at(-1).value);
  const rightIndex = frames.findIndex((frame) => Number(frame.time) >= time);
  const left = frames[Math.max(0, rightIndex - 1)];
  const right = frames[rightIndex];
  const span = Math.max(0.000001, Number(right.time) - Number(left.time));
  const progress = applyEasing((time - Number(left.time)) / span, right.easing || left.easing || 'linear');
  return interpolateValue(left.value, right.value, progress);
}

export function interpolateValue(left, right, progress) {
  if (Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return Number(left) + (Number(right) - Number(left)) * progress;
  }
  return progress < 1 ? structuredClone(left) : structuredClone(right);
}

function writePath(target, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  if (!parts.length) return;
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = /^\d+$/.test(parts[index]) ? Number(parts[index]) : parts[index];
    if (current[part] === undefined || current[part] === null) {
      current[part] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    }
    current = current[part];
  }
  const last = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
  current[last] = value;
}

function applyEasing(progress, easing) {
  const value = Math.min(1, Math.max(0, progress));
  if (easing === 'ease-in') return value * value;
  if (easing === 'ease-out') return 1 - (1 - value) * (1 - value);
  if (easing === 'ease-in-out') {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }
  return value;
}
