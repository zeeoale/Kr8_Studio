import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLayerAudioBindings, resolveProjectAudioBindings } from '../src/audio/bindings.js';
import { createSilentAudioFrame } from '../src/audio/audioFrame.js';

test('bass audio binding resolves cover scale using min and max', () => {
  const layer = {
    id: 'cover',
    type: 'image',
    name: 'Cover',
    visible: true,
    locked: false,
    order: 0,
    start: 0,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      width: 100,
      height: 100
    },
    opacity: 1,
    blendMode: 'normal',
    properties: {},
    effects: [],
    audioBindings: [
      {
        id: 'binding',
        source: 'bass',
        targetProperty: 'transform.scaleX',
        amount: 0.08,
        min: 1,
        max: 1.08,
        curve: 'linear'
      }
    ],
    animations: []
  };

  const frame = createSilentAudioFrame();
  frame.bass = 0.5;
  const resolved = resolveLayerAudioBindings(layer, frame);
  assert.equal(resolved.transform.scaleX, 1.04);
  assert.equal(layer.transform.scaleX, 1);
});

test('project audio binding resolution preserves project metadata and layer ids', () => {
  const project = {
    schemaVersion: 1,
    id: 'project',
    name: 'Project',
    metadata: { title: 'Song' },
    composition: { width: 1920, height: 1080, fps: 30, duration: 100, backgroundColor: '#000000', pixelAspectRatio: 1 },
    assets: [],
    layers: [
      {
        id: 'visualizer',
        type: 'visualizer',
        name: 'Visualizer',
        visible: true,
        locked: false,
        order: 0,
        start: 0,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
        opacity: 1,
        blendMode: 'normal',
        properties: {},
        effects: [],
        audioBindings: [{ id: 'energy-opacity', source: 'energy', targetProperty: 'opacity', amount: 1, min: 0.2, max: 1 }],
        animations: []
      }
    ],
    scenes: [],
    presets: [],
    migrations: []
  };
  const frame = createSilentAudioFrame();
  frame.energy = 0.25;
  const resolved = resolveProjectAudioBindings(project, frame);
  assert.equal(resolved.metadata.title, 'Song');
  assert.equal(resolved.layers[0].id, 'visualizer');
  assert.equal(resolved.layers[0].opacity, 0.4);
  assert.equal(project.layers[0].opacity, 1);
});
