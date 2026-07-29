import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createLibraryPresetFromLayer,
  loadVisualizerPresetLibrary,
  upsertVisualizerPresetInLibrary
} from '../src/visualizer/library.js';

test('visualizer preset library starts empty when file is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-visualizer-library-'));
  const library = await loadVisualizerPresetLibrary(path.join(dir, 'library.json'));

  assert.equal(library.version, 1);
  assert.deepEqual(library.presets, []);
});

test('visualizer preset library stores reusable global presets only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-visualizer-library-'));
  const libraryPath = path.join(dir, 'library.json');
  const preset = createLibraryPresetFromLayer({
    id: 'layer_visualizer',
    type: 'visualizer',
    name: 'TK - Dubstep',
    transform: {
      x: 960,
      y: 600,
      width: 1920,
      height: 420,
      scaleX: 1.5,
      scaleY: 2,
      rotation: 12
    },
    properties: {
      visualizerType: 'bars',
      gain: 1,
      lowFrequencyDamping: 0.1,
      audioBindings: [{ id: 'song_specific' }]
    }
  }, {
    name: 'TK - Dubstep',
    id: 'custom-tk-dubstep',
    createdAt: '2026-07-12T00:00:00.000Z'
  });

  await upsertVisualizerPresetInLibrary(libraryPath, preset);
  const loaded = await loadVisualizerPresetLibrary(libraryPath);

  assert.equal(loaded.presets.length, 1);
  assert.equal(loaded.presets[0].id, 'custom-tk-dubstep');
  assert.equal(loaded.presets[0].scope, 'global');
  assert.equal(loaded.presets[0].properties.gain, 1);
  assert.equal(loaded.presets[0].properties.audioBindings, undefined);
  assert.deepEqual(loaded.presets[0].transform, {
    width: 1920,
    height: 420,
    scaleX: 1.5,
    scaleY: 2
  });
  assert.equal(loaded.presets[0].transform.x, undefined);
  assert.equal(loaded.presets[0].transform.y, undefined);
  assert.equal(loaded.presets[0].transform.rotation, undefined);
});
