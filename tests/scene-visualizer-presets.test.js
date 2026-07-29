import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySceneVisualizerPreset,
  ensureProjectSceneVisualizerPresets,
  findSceneVisualizerPreset
} from '../src/visualizer/scenePresets.js';

test('scene visualizer presets are stored in project metadata', () => {
  const project = ensureProjectSceneVisualizerPresets({ metadata: { title: 'Song' } });

  assert.equal(project.metadata.title, 'Song');
  assert.ok(project.metadata.sceneVisualizerPresets.some((preset) => preset.id === 'chorus'));
});

test('findSceneVisualizerPreset matches common section names', () => {
  const project = ensureProjectSceneVisualizerPresets({ metadata: {} });

  assert.equal(findSceneVisualizerPreset(project, 'Verse 2')?.id, 'verse');
  assert.equal(findSceneVisualizerPreset(project, 'Instrumental Synth Solo')?.id, 'bridge');
  assert.equal(findSceneVisualizerPreset(project, 'Final Chorus')?.id, 'chorus');
});

test('applySceneVisualizerPreset is opt-in and preserves manual visualizer settings by default', () => {
  const project = ensureProjectSceneVisualizerPresets({
    metadata: {},
    layers: [
      { id: 'visualizer', type: 'visualizer', properties: { gain: 0.1 } },
      { id: 'title', type: 'text', properties: { text: 'Title' } }
    ]
  });

  const result = applySceneVisualizerPreset(project, { name: 'Chorus', start: 10, end: 20 });
  const visualizer = result.layers.find((layer) => layer.id === 'visualizer');

  assert.equal(visualizer.properties.sceneVisualizerPresetId, undefined);
  assert.equal(visualizer.properties.gain, 0.1);
});

test('applySceneVisualizerPreset only patches opted-in visualizer layers', () => {
  const project = ensureProjectSceneVisualizerPresets({
    metadata: {},
    layers: [
      { id: 'visualizer', type: 'visualizer', properties: { gain: 0.1, sceneVisualizerEnabled: true } },
      { id: 'title', type: 'text', properties: { text: 'Title' } }
    ]
  });

  const result = applySceneVisualizerPreset(project, { name: 'Chorus', start: 10, end: 20 });
  const visualizer = result.layers.find((layer) => layer.id === 'visualizer');
  const title = result.layers.find((layer) => layer.id === 'title');

  assert.equal(visualizer.properties.sceneVisualizerPresetId, 'chorus');
  assert.ok(visualizer.properties.gain > 0.1);
  assert.equal(title.properties.text, 'Title');
});
