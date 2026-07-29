import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VISUALIZER_STYLE_PRESETS,
  applyVisualizerStylePreset,
  createVisualizerPresetFromLayer,
  ensureProjectVisualizerStylePresets,
  normalizeVisualizerType,
  upsertProjectVisualizerStylePreset
} from '../src/visualizer/styles.js';

test('normalizeVisualizerType maps deprecated pulse-dots to radial-spectrum', () => {
  assert.equal(normalizeVisualizerType('pulse-dots'), 'radial-spectrum');
  assert.equal(normalizeVisualizerType('bars'), 'bars');
  assert.equal(normalizeVisualizerType(undefined), 'bars');
});

test('visualizer presets do not expose deprecated pulse-dots', () => {
  assert.ok(VISUALIZER_STYLE_PRESETS.length >= 4);
  assert.equal(VISUALIZER_STYLE_PRESETS.some((preset) => preset.properties.visualizerType === 'pulse-dots'), false);
  assert.ok(VISUALIZER_STYLE_PRESETS.some((preset) => preset.properties.visualizerType === 'radial-spectrum'));
});

test('applyVisualizerStylePreset updates visualizer settings while preserving layer identity', () => {
  const layer = {
    id: 'layer_visualizer',
    type: 'visualizer',
    name: 'Visualizer',
    transform: {
      x: 120,
      y: 240,
      width: 320,
      height: 180,
      scaleX: 1,
      scaleY: 1,
      rotation: 12
    },
    properties: {
      visualizerType: 'bars',
      bars: 64,
      audioBindings: [{ id: 'binding_keep' }]
    }
  };

  const styled = applyVisualizerStylePreset(layer, 'radial-pulse');

  assert.equal(styled.id, layer.id);
  assert.equal(styled.type, 'visualizer');
  assert.deepEqual(styled.transform, layer.transform);
  assert.equal(styled.properties.visualizerStyleId, 'radial-pulse');
  assert.equal(styled.properties.visualizerType, 'radial-spectrum');
  assert.equal(styled.properties.mirror, true);
  assert.deepEqual(styled.properties.audioBindings, [{ id: 'binding_keep' }]);
  assert.equal(layer.properties.visualizerType, 'bars');
});

test('ensureProjectVisualizerStylePresets stores reusable presets in metadata without losing existing metadata', () => {
  const project = ensureProjectVisualizerStylePresets({
    metadata: {
      title: 'Track',
      visualizerStylePresets: [
        {
          id: 'custom',
          name: 'Custom',
          properties: { visualizerType: 'waveform' }
        }
      ]
    }
  });

  assert.equal(project.metadata.title, 'Track');
  assert.ok(project.metadata.visualizerStylePresets.some((preset) => preset.id === 'custom'));
  assert.ok(project.metadata.visualizerStylePresets.some((preset) => preset.id === 'cinematic-halo'));
});

test('createVisualizerPresetFromLayer captures only reusable visualizer properties', () => {
  const layer = {
    id: 'layer_song_specific',
    type: 'visualizer',
    name: 'Dubstep Radial',
    transform: {
      x: 960,
      y: 720,
      width: 1180,
      height: 320,
      scaleX: 2,
      scaleY: 1.5,
      rotation: 15
    },
    properties: {
      visualizerType: 'radial-spectrum',
      bars: 128,
      gain: 1,
      sensitivity: 1,
      lowFrequencyDamping: 0.1,
      midFrequencyDamping: 0.16,
      noiseGate: 0.025,
      color: '#ffffff',
      assetId: 'asset_should_not_copy',
      audioBindings: [{ id: 'binding_should_not_copy' }]
    }
  };

  const preset = createVisualizerPresetFromLayer(layer, {
    name: 'Dubstep Radial',
    createdAt: '2026-07-12T00:00:00.000Z'
  });

  assert.equal(preset.id, 'custom-dubstep-radial');
  assert.equal(preset.custom, true);
  assert.equal(preset.properties.visualizerType, 'radial-spectrum');
  assert.equal(preset.properties.gain, 1);
  assert.equal(preset.properties.assetId, undefined);
  assert.equal(preset.properties.audioBindings, undefined);
  assert.deepEqual(preset.transform, {
    width: 1180,
    height: 320,
    scaleX: 2,
    scaleY: 1.5
  });
  assert.equal(preset.transform.x, undefined);
  assert.equal(preset.transform.y, undefined);
  assert.equal(preset.transform.rotation, undefined);
});

test('applyVisualizerPresetObject applies reusable visualizer dimensions without moving the layer', async () => {
  const { applyVisualizerPresetObject } = await import('../src/visualizer/styles.js');
  const layer = {
    id: 'layer_visualizer',
    type: 'visualizer',
    name: 'Visualizer',
    transform: {
      x: 100,
      y: 200,
      width: 400,
      height: 180,
      scaleX: 1,
      scaleY: 1,
      rotation: 30
    },
    properties: {
      visualizerType: 'bars',
      gain: 0.5
    }
  };

  const styled = applyVisualizerPresetObject(layer, {
    id: 'custom-layout',
    name: 'Custom Layout',
    transform: {
      x: 999,
      y: 999,
      width: 1180,
      height: 360,
      scaleX: 2,
      scaleY: 1.25,
      rotation: 180
    },
    properties: {
      gain: 1.1
    }
  });

  assert.equal(styled.transform.x, 100);
  assert.equal(styled.transform.y, 200);
  assert.equal(styled.transform.rotation, 30);
  assert.equal(styled.transform.width, 1180);
  assert.equal(styled.transform.height, 360);
  assert.equal(styled.transform.scaleX, 2);
  assert.equal(styled.transform.scaleY, 1.25);
  assert.equal(styled.properties.gain, 1.1);
});

test('upsertProjectVisualizerStylePreset adds and replaces custom presets by id', () => {
  const project = ensureProjectVisualizerStylePresets({ metadata: { title: 'Song' } });
  const first = {
    id: 'custom-dubstep-radial',
    name: 'Dubstep Radial',
    custom: true,
    properties: { gain: 1 }
  };
  const second = {
    id: 'custom-dubstep-radial',
    name: 'Dubstep Radial v2',
    custom: true,
    properties: { gain: 0.8 }
  };

  const withFirst = upsertProjectVisualizerStylePreset(project, first);
  const withSecond = upsertProjectVisualizerStylePreset(withFirst, second);
  const matches = withSecond.metadata.visualizerStylePresets.filter((preset) => preset.id === first.id);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'Dubstep Radial v2');
  assert.equal(matches[0].properties.gain, 0.8);
  assert.equal(withSecond.metadata.title, 'Song');
});
