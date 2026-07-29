import assert from 'node:assert/strict';
import test from 'node:test';

import { addLayer } from '../src/layers/operations.js';
import { createLyricsOverlayLayer } from '../src/lyrics/layer.js';
import {
  LYRICS_STYLE_PRESETS,
  applyLyricsStylePreset,
  calculateLyricsTransitionOpacity,
  ensureProjectLyricsStylePresets
} from '../src/lyrics/styles.js';
import { validateProject } from '../src/project/schema.js';

test('createLyricsOverlayLayer creates a valid renderer-independent lyrics layer', () => {
  const layer = createLyricsOverlayLayer({
    id: 'layer_lyrics_test',
    composition: { width: 1920, height: 1080, duration: 147 }
  });

  assert.equal(layer.type, 'lyrics');
  assert.equal(layer.id, 'layer_lyrics_test');
  assert.equal(layer.end, 147);
  assert.equal(layer.properties.source, 'currentCue');
  assert.equal(layer.properties.styleId, 'noir-card');
  assert.equal(Object.hasOwn(layer.properties, 'previewText'), false);
  assert.equal(layer.properties.transition.type, 'fade');
  assert.equal(layer.transform.x, 960);
  assert.equal(layer.transform.y, 842);
});

test('applyLyricsStylePreset updates lyrics style while preserving layer identity', () => {
  const layer = createLyricsOverlayLayer({ id: 'layer_lyrics_style' });
  const styled = applyLyricsStylePreset(layer, 'club-neon');

  assert.equal(styled.id, layer.id);
  assert.equal(styled.type, 'lyrics');
  assert.equal(styled.properties.styleId, 'club-neon');
  assert.equal(styled.properties.color, '#F8FCFF');
  assert.equal(layer.properties.styleId, 'noir-card');
  assert.ok(LYRICS_STYLE_PRESETS.length >= 3);
});

test('calculateLyricsTransitionOpacity fades lyric cue in and out', () => {
  const cue = { start: 10, end: 12, text: 'Line' };
  const transition = { type: 'fade', enabled: true, fadeIn: 0.5, fadeOut: 0.5 };

  assert.equal(calculateLyricsTransitionOpacity(cue, 10, transition), 0);
  assert.equal(calculateLyricsTransitionOpacity(cue, 11, transition), 1);
  assert.equal(calculateLyricsTransitionOpacity(cue, 12, transition), 0);
  assert.equal(calculateLyricsTransitionOpacity(cue, 10, { type: 'none' }), 1);
});

test('ensureProjectLyricsStylePresets stores reusable lyrics presets in project metadata', () => {
  const project = ensureProjectLyricsStylePresets({ metadata: { title: 'Song' } });

  assert.equal(project.metadata.title, 'Song');
  assert.ok(project.metadata.lyricsStylePresets.length >= 3);
  assert.ok(project.metadata.lyricsStylePresets.some((preset) => preset.id === 'cinematic-subtitle'));
});

test('addLayer appends lyrics overlay and keeps project valid', () => {
  const now = '2026-07-11T00:00:00.000Z';
  const project = {
    schemaVersion: 1,
    id: 'kr8_lyrics_layer_project',
    name: 'Lyrics Layer Test',
    createdAt: now,
    updatedAt: now,
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 120,
      backgroundColor: '#05070A',
      pixelAspectRatio: 1
    },
    assets: [],
    layers: [
      {
        id: 'layer_background',
        type: 'shape',
        name: 'Background',
        visible: true,
        locked: false,
        order: 0,
        start: 0,
        end: 120,
        transform: { x: 960, y: 540, width: 1920, height: 1080, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
        opacity: 1,
        blendMode: 'normal',
        properties: { fill: '#05070A' },
        effects: [],
        audioBindings: [],
        animations: []
      }
    ],
    scenes: [{ id: 'scene_main', name: 'Main', start: 0, end: 120, overrides: [] }],
    presets: [],
    migrations: [],
    metadata: {}
  };

  const layer = createLyricsOverlayLayer({ id: 'layer_lyrics', composition: project.composition });
  const result = addLayer(project, layer);

  assert.equal(result.addedLayerId, 'layer_lyrics');
  assert.equal(result.project.layers.length, 2);
  assert.equal(result.project.layers.at(-1).type, 'lyrics');
  assert.equal(validateProject(result.project).valid, true);
});
