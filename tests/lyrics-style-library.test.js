import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  deleteLyricsStylePresetFromLibrary,
  loadLyricsStylePresetLibrary,
  upsertLyricsStylePresetInLibrary
} from '../src/lyrics/library.js';
import {
  LYRICS_STYLE_PRESETS,
  createLyricsStylePresetFromLayer,
  isBuiltInLyricsStylePreset,
  sanitizeLyricsStylePreset,
  upsertProjectLyricsStylePreset
} from '../src/lyrics/styles.js';

function createLyricsLayer() {
  return {
    id: 'layer_lyrics',
    type: 'lyrics',
    name: 'Lyrics Overlay',
    properties: {
      styleId: 'noir-card',
      source: 'currentCue',
      fontFamily: 'Problem in Wisconsin',
      fontSize: 72,
      color: '#ffffff',
      strokeColor: '#101010',
      strokeWidth: 4,
      glowColor: '#dc143c',
      glowBlur: 24,
      glowIntensity: 1.2,
      shadowColor: '#000000',
      shadowBlur: 8,
      shadowOffsetX: 4,
      shadowOffsetY: 6,
      unsupportedSongData: 'must not leak into a style preset'
    }
  };
}

test('built-in lyrics styles are identifiable and include explicit glow settings', () => {
  assert.equal(isBuiltInLyricsStylePreset('club-neon'), true);
  assert.equal(isBuiltInLyricsStylePreset('custom-club-neon'), false);
  assert.ok(LYRICS_STYLE_PRESETS.every((preset) => preset.custom !== true));
  assert.ok(LYRICS_STYLE_PRESETS.every((preset) => Number.isFinite(preset.properties.glowBlur)));
});

test('lyrics style preset captures appearance without editor or song-specific properties', () => {
  const preset = createLyricsStylePresetFromLayer(createLyricsLayer(), {
    name: 'Crimson Display',
    createdAt: '2026-07-29T00:00:00.000Z'
  });

  assert.equal(preset.id, 'custom-crimson-display');
  assert.equal(preset.custom, true);
  assert.equal(preset.properties.glowIntensity, 1.2);
  assert.equal(preset.properties.shadowOffsetY, 6);
  assert.equal(preset.properties.styleId, undefined);
  assert.equal(preset.properties.source, undefined);
  assert.equal(preset.properties.unsupportedSongData, undefined);
});

test('lyrics style library supports create, update and delete', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-lyrics-style-library-'));
  const libraryPath = path.join(dir, 'library.json');
  const initial = await loadLyricsStylePresetLibrary(libraryPath);
  assert.deepEqual(initial, { version: 1, presets: [] });

  const preset = createLyricsStylePresetFromLayer(createLyricsLayer(), {
    id: 'custom-crimson',
    name: 'Crimson',
    createdAt: '2026-07-29T00:00:00.000Z'
  });
  await upsertLyricsStylePresetInLibrary(libraryPath, preset);
  await upsertLyricsStylePresetInLibrary(libraryPath, {
    ...preset,
    properties: { ...preset.properties, glowBlur: 40 }
  });

  const updated = await loadLyricsStylePresetLibrary(libraryPath);
  assert.equal(updated.presets.length, 1);
  assert.equal(updated.presets[0].properties.glowBlur, 40);
  assert.equal(updated.presets[0].scope, 'global');

  const deleted = await deleteLyricsStylePresetFromLibrary(libraryPath, preset.id);
  assert.deepEqual(deleted.presets, []);
});

test('project embeds a sanitized custom lyrics style for portable save/load', () => {
  const preset = sanitizeLyricsStylePreset({
    id: 'custom-portable',
    name: 'Portable',
    custom: true,
    scope: 'global',
    properties: {
      fontFamily: 'Arial',
      glowBlur: 16,
      unknown: 'discard'
    }
  });
  const project = upsertProjectLyricsStylePreset({ metadata: {} }, preset);
  const embedded = project.metadata.lyricsStylePresets.find((item) => item.id === preset.id);

  assert.equal(embedded.properties.glowBlur, 16);
  assert.equal(embedded.properties.unknown, undefined);
  assert.ok(project.metadata.lyricsStylePresets.some((item) => item.id === 'noir-card'));
});
