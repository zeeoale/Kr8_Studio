import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sanitizeLyricsStylePreset } from './styles.js';

export const LYRICS_STYLE_LIBRARY_VERSION = 1;

export async function loadLyricsStylePresetLibrary(libraryPath) {
  try {
    return normalizeLyricsStyleLibrary(JSON.parse(await readFile(libraryPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyLibrary();
    throw error;
  }
}

export async function saveLyricsStylePresetLibrary(libraryPath, library) {
  const normalized = normalizeLyricsStyleLibrary(library);
  await mkdir(path.dirname(libraryPath), { recursive: true });
  await writeFile(libraryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function upsertLyricsStylePresetInLibrary(libraryPath, preset) {
  const library = await loadLyricsStylePresetLibrary(libraryPath);
  const sanitized = sanitizeGlobalPreset(preset);
  return saveLyricsStylePresetLibrary(libraryPath, {
    ...library,
    presets: [
      ...library.presets.filter((item) => item.id !== sanitized.id),
      sanitized
    ]
  });
}

export async function deleteLyricsStylePresetFromLibrary(libraryPath, presetId) {
  const id = String(presetId || '').trim();
  if (!id) throw new Error('Lyrics style preset id is required.');
  const library = await loadLyricsStylePresetLibrary(libraryPath);
  return saveLyricsStylePresetLibrary(libraryPath, {
    ...library,
    presets: library.presets.filter((preset) => preset.id !== id)
  });
}

export function normalizeLyricsStyleLibrary(payload = {}) {
  const presets = Array.isArray(payload.presets) ? payload.presets : [];
  return {
    version: LYRICS_STYLE_LIBRARY_VERSION,
    presets: presets.map(sanitizeGlobalPreset)
  };
}

function createEmptyLibrary() {
  return {
    version: LYRICS_STYLE_LIBRARY_VERSION,
    presets: []
  };
}

function sanitizeGlobalPreset(preset) {
  const sanitized = sanitizeLyricsStylePreset(preset);
  return {
    ...sanitized,
    custom: true,
    scope: 'global',
    createdAt: sanitized.createdAt || new Date().toISOString()
  };
}
