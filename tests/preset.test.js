import assert from 'node:assert/strict';
import test from 'node:test';

import { createTkNoirPulsePreset, TK_NOIR_PULSE_PRESET_ID } from '../src/presets/tk-noir-pulse.js';

test('TK Noir Pulse contains required foundation layers and bass binding', () => {
  const preset = createTkNoirPulsePreset({
    seed: 'required-layers',
    title: 'Required Layers',
    artist: 'TKMusic',
    coverAssetId: 'cover_asset'
  });

  assert.equal(preset.id, TK_NOIR_PULSE_PRESET_ID);
  assert.equal(preset.composition.width, 1920);
  assert.equal(preset.composition.height, 1080);
  assert.equal(preset.composition.fps, 30);

  const layerNames = preset.layers.map((layer) => layer.name);
  assert.ok(layerNames.includes('Background'));
  assert.ok(layerNames.includes('Cover'));
  assert.ok(layerNames.includes('Bass Spectrum'));
  assert.ok(layerNames.includes('Song Title'));
  assert.ok(layerNames.includes('Artist'));

  const cover = preset.layers.find((layer) => layer.name === 'Cover');
  assert.ok(cover.audioBindings.some((binding) => binding.source === 'bass' && binding.targetProperty === 'transform.scaleX'));

  const artist = preset.layers.find((layer) => layer.name === 'Artist');
  assert.equal(artist.transform.y, 175);
  assert.equal(artist.properties.color, '#FAFAFA');
});
