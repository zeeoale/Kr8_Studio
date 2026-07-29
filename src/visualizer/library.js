import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createVisualizerPresetFromLayer,
  sanitizeVisualizerPreset
} from './styles.js';

export const VISUALIZER_LIBRARY_VERSION = 1;

export async function loadVisualizerPresetLibrary(libraryPath) {
  try {
    const payload = JSON.parse(await readFile(libraryPath, 'utf8'));
    return normalizeLibrary(payload);
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyLibrary();
    throw error;
  }
}

export async function saveVisualizerPresetLibrary(libraryPath, library) {
  const normalized = normalizeLibrary(library);
  await mkdir(path.dirname(libraryPath), { recursive: true });
  await writeFile(libraryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function upsertVisualizerPresetInLibrary(libraryPath, preset) {
  const library = await loadVisualizerPresetLibrary(libraryPath);
  const sanitized = sanitizePreset(preset);
  const next = {
    ...library,
    presets: [
      ...library.presets.filter((item) => item.id !== sanitized.id),
      sanitized
    ]
  };
  return saveVisualizerPresetLibrary(libraryPath, next);
}

export function createLibraryPresetFromLayer(layer, options = {}) {
  return sanitizePreset(createVisualizerPresetFromLayer(layer, {
    ...options,
    scope: 'global'
  }));
}

export function normalizeLibrary(payload = {}) {
  const presets = Array.isArray(payload.presets) ? payload.presets : [];
  return {
    version: VISUALIZER_LIBRARY_VERSION,
    presets: presets.map(sanitizePreset)
  };
}

function createEmptyLibrary() {
  return {
    version: VISUALIZER_LIBRARY_VERSION,
    presets: []
  };
}

function sanitizePreset(preset) {
  if (!preset || typeof preset !== 'object') {
    throw new Error('Visualizer preset must be an object.');
  }
  if (!preset.id || !preset.name) {
    throw new Error('Visualizer preset requires id and name.');
  }
  const sanitized = sanitizeVisualizerPreset(preset);
  return {
    id: sanitized.id,
    name: sanitized.name,
    custom: sanitized.custom !== false,
    scope: sanitized.scope || 'global',
    createdAt: sanitized.createdAt || new Date().toISOString(),
    properties: sanitized.properties,
    ...(sanitized.transform ? { transform: sanitized.transform } : {})
  };
}
