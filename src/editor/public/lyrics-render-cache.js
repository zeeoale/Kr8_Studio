const CACHE_PROPERTY_KEYS = [
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
  'strokeWidth'
];

export function createLyricsRenderCache(options = {}) {
  const maxLayers = Math.max(1, Math.round(Number(options.maxLayers || 4)));
  const entries = new Map();
  let hits = 0;
  let misses = 0;

  return {
    getOrCreate(layerId, key, factory) {
      const id = String(layerId || 'lyrics');
      const current = entries.get(id);
      if (current?.key === key) {
        hits += 1;
        entries.delete(id);
        entries.set(id, current);
        return current.value;
      }

      misses += 1;
      const value = factory();
      entries.delete(id);
      entries.set(id, { key, value });
      while (entries.size > maxLayers) {
        entries.delete(entries.keys().next().value);
      }
      return value;
    },

    delete(layerId) {
      return entries.delete(String(layerId || 'lyrics'));
    },

    clear() {
      entries.clear();
    },

    stats() {
      return { size: entries.size, hits, misses };
    }
  };
}

export function buildLyricsRenderCacheKey(options = {}) {
  const properties = {};
  for (const key of CACHE_PROPERTY_KEYS) {
    properties[key] = options.properties?.[key] ?? null;
  }
  return JSON.stringify({
    text: String(options.text || ''),
    width: finiteNumber(options.width),
    height: finiteNumber(options.height),
    originX: finiteNumber(options.originX),
    properties,
    glow: normalizeEffect(options.glow),
    shadow: normalizeEffect(options.shadow)
  });
}

export function calculateLyricsEffectPadding(options = {}) {
  const strokeWidth = Math.max(0, finiteNumber(options.strokeWidth));
  const glow = normalizeEffect(options.glow);
  const shadow = normalizeEffect(options.shadow);
  const glowExtent = glow.blur > 0 && glow.intensity > 0
    ? glow.blur * 2 + strokeWidth
    : 0;
  const shadowExtent = shadow.blur > 0 || shadow.offsetX !== 0 || shadow.offsetY !== 0
    ? shadow.blur * 2 + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) + strokeWidth
    : 0;
  return Math.ceil(Math.max(2, strokeWidth + 2, glowExtent, shadowExtent) + 2);
}

function normalizeEffect(effect = {}) {
  return {
    color: String(effect.color || '#000000'),
    blur: Math.max(0, finiteNumber(effect.blur)),
    intensity: Math.max(0, finiteNumber(effect.intensity)),
    offsetX: finiteNumber(effect.offsetX),
    offsetY: finiteNumber(effect.offsetY)
  };
}

function finiteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
